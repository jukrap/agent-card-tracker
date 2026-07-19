import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fileSystemConstants } from 'node:fs';
import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export const TARGET_REPOSITORY = 'jukrap/agent-card-tracker';
export const DEFAULT_GIT_TIMEOUT_MS = 30_000;
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
export const DEFAULT_SYNC_LOCK_STALE_MS = 30 * 60 * 1_000;

const SAFE_REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/;
const LOCK_TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_LOCK_BYTES = 1024;
const DISABLED_HOOK_EVENTS = Object.freeze([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'pre-auto-gc',
  'post-rewrite',
  'post-index-change',
  'reference-transaction',
  'post-fetch',
]);
const SAFE_GIT_CONFIG_ARGS = Object.freeze([
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.attributesFile=/dev/null',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'push.gpgSign=false',
  '-c',
  'push.pushOption=',
  '-c',
  'merge.verifySignatures=false',
  '-c',
  'submodule.recurse=false',
  '-c',
  'rebase.updateRefs=false',
  '-c',
  'rebase.autoStash=false',
  ...DISABLED_HOOK_EVENTS.flatMap(
    (event) => ['-c', `hook.${event}.enabled=false`],
  ),
]);
const ERROR_MESSAGES = Object.freeze({
  DEDICATED_CLONE_REQUIRED: 'A dedicated repository clone is required',
  DEFAULT_BRANCH_MISMATCH: 'The checked out branch is not the remote default branch',
  GIT_COMMAND_FAILED: 'A Git command failed',
  GIT_COMMAND_TIMEOUT: 'A Git command timed out',
  GIT_INVALID_ARGUMENT: 'Git received an invalid argument',
  GIT_OUTPUT_TOO_LARGE: 'Git output exceeded the safe limit',
  REPOSITORY_IDENTITY_MISMATCH: 'The configured remote is not the target repository',
  SYNC_ALREADY_RUNNING: 'Another synchronization process is already running',
  SYNC_LOCK_FAILED: 'A safe hard-link synchronization lock could not be acquired',
  SYNC_LOCK_INVALID: 'The existing synchronization lock is invalid',
  SYNC_LOCK_MISSING: 'The synchronization lock disappeared during inspection',
  SYNC_LOCK_OWNERSHIP_LOST: 'The synchronization lock ownership changed unexpectedly',
  SYNC_LOCK_RELEASE_FAILED: 'The synchronization lock could not be released',
  SYNC_STALE_LOCK: 'A stale synchronization lock requires manual recovery',
  TRACKED_WORKTREE_DIRTY: 'The tracked worktree must be clean before synchronization',
  UPSTREAM_INVALID: 'The current branch must track a remote branch',
});

export class GitRepositoryError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Git repository validation failed');
    this.name = 'GitRepositoryError';
    this.code = code;
  }
}

function repositoryError(code) {
  return new GitRepositoryError(code);
}

function assertPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function safeArgv(args) {
  if (!Array.isArray(args)
    || args.length === 0
    || args.some((argument) => typeof argument !== 'string'
      || argument.length === 0
      || /[\u0000\r\n]/u.test(argument))) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  return [...args];
}

function outputBytes(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : Infinity;
}

function safeGitEnvironment(environment) {
  const source = environment === undefined ? process.env : environment;
  const result = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (!normalizedKey.startsWith('git_')
      && !['codex_bearer_token', 'lc_all', 'lang'].includes(normalizedKey)
      && typeof value === 'string') {
      result[key] = value;
    }
  }
  result.LC_ALL = 'C';
  result.LANG = 'C';
  result.GIT_ATTR_NOSYSTEM = '1';
  result.GIT_TERMINAL_PROMPT = '0';
  return result;
}

function commandExitCode(error) {
  return Number.isInteger(error?.code) && error.code > 0 ? error.code : null;
}

export function createGitRunner({
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_GIT_MAX_OUTPUT_BYTES,
  execFileImpl = execFile,
  env = process.env,
} = {}) {
  if (!assertPositiveSafeInteger(timeoutMs)
    || !assertPositiveSafeInteger(maxOutputBytes)
    || typeof execFileImpl !== 'function') {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }

  return (args, { cwd } = {}) => new Promise((resolve, reject) => {
    let safeArgs;
    try {
      safeArgs = safeArgv(args);
    } catch (error) {
      reject(error);
      return;
    }

    execFileImpl(
      'git',
      [...SAFE_GIT_CONFIG_ARGS, ...safeArgs],
      {
        cwd,
        encoding: 'utf8',
        env: safeGitEnvironment(env),
        maxBuffer: maxOutputBytes,
        shell: false,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (error, stdout = '', stderr = '') => {
        if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          reject(repositoryError('GIT_OUTPUT_TOO_LARGE'));
          return;
        }
        if (error?.code === 'ETIMEDOUT' || error?.killed === true) {
          reject(repositoryError('GIT_COMMAND_TIMEOUT'));
          return;
        }
        if (outputBytes(stdout) > maxOutputBytes || outputBytes(stderr) > maxOutputBytes) {
          reject(repositoryError('GIT_OUTPUT_TOO_LARGE'));
          return;
        }

        const exitCode = commandExitCode(error);
        if (error && exitCode === null) {
          reject(repositoryError('GIT_COMMAND_FAILED'));
          return;
        }
        resolve({
          exitCode: exitCode ?? 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

function normalizeRunnerResult(value) {
  if (value === null
    || typeof value !== 'object'
    || !Number.isInteger(value.exitCode)
    || value.exitCode < 0
    || typeof value.stdout !== 'string'
    || typeof value.stderr !== 'string') {
    throw repositoryError('GIT_COMMAND_FAILED');
  }
  return value;
}

export async function runGit(
  runner,
  args,
  {
    cwd,
    allowExitCodes = [0],
  } = {},
) {
  const safeArgs = safeArgv(args);
  if (typeof runner !== 'function'
    || !Array.isArray(allowExitCodes)
    || allowExitCodes.some((value) => !Number.isInteger(value) || value < 0)) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }

  let result;
  try {
    result = normalizeRunnerResult(await runner(safeArgs, { cwd }));
  } catch (error) {
    if (error instanceof GitRepositoryError) {
      throw error;
    }
    throw repositoryError('GIT_COMMAND_FAILED');
  }
  if (!allowExitCodes.includes(result.exitCode)) {
    throw repositoryError('GIT_COMMAND_FAILED');
  }
  return result;
}

function trimmed(value) {
  return value.trim();
}

function samePath(left, right) {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  if (process.platform === 'win32') {
    return normalizedLeft.toLowerCase() === normalizedRight.toLowerCase();
  }
  return normalizedLeft === normalizedRight;
}

function parseRemoteIdentity(remoteUrl) {
  if (typeof remoteUrl !== 'string' || /[\u0000\r\n]/u.test(remoteUrl)) {
    return null;
  }
  const value = remoteUrl.trim();
  let pathname;

  if (value.startsWith('https://') || value.startsWith('ssh://')) {
    try {
      const parsed = new URL(value);
      if (parsed.hostname.toLowerCase() !== 'github.com'
        || parsed.search.length > 0
        || parsed.hash.length > 0
        || (parsed.protocol === 'https:' && parsed.username.length > 0)
        || (parsed.protocol === 'ssh:' && parsed.username !== 'git')
        || parsed.password.length > 0) {
        return null;
      }
      pathname = parsed.pathname;
    } catch {
      return null;
    }
  } else {
    const match = /^git@github\.com:(?<pathname>[^?#]+)$/iu.exec(value);
    if (!match) {
      return null;
    }
    pathname = `/${match.groups.pathname}`;
  }

  const segments = pathname
    .replace(/^\/+|\/+$/gu, '')
    .replace(/\.git$/iu, '')
    .split('/');
  if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) {
    return null;
  }
  return `${segments[0]}/${segments[1]}`.toLowerCase();
}

function parseUpstream(value) {
  const separator = value.indexOf('/');
  if (separator <= 0 || separator === value.length - 1) {
    throw repositoryError('UPSTREAM_INVALID');
  }
  const remote = value.slice(0, separator);
  const branch = value.slice(separator + 1);
  if (!SAFE_REF_PATTERN.test(remote)
    || !SAFE_REF_PATTERN.test(branch)
    || remote.includes('..')
    || branch.includes('..')
    || branch.includes('@{')
    || branch.includes('//')) {
    throw repositoryError('UPSTREAM_INVALID');
  }
  return { remote, branch };
}

function parseRemoteDefaultBranch(value) {
  const lines = value.split(/\r?\n/u).filter(Boolean);
  const match = /^ref: refs\/heads\/(?<branch>[^\t]+)\tHEAD$/u.exec(lines[0] ?? '');
  if (!match) {
    throw repositoryError('DEFAULT_BRANCH_MISMATCH');
  }
  const branch = match.groups.branch;
  if (!SAFE_REF_PATTERN.test(branch)
    || branch.includes('..')
    || branch.includes('@{')
    || branch.includes('//')) {
    throw repositoryError('DEFAULT_BRANCH_MISMATCH');
  }
  return branch;
}

export async function inspectDedicatedRepository({
  cwd = process.cwd(),
  runner = createGitRunner(),
  expectedRepository = TARGET_REPOSITORY,
  requireClean = true,
} = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0
    || typeof expectedRepository !== 'string' || expectedRepository.length === 0) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  const root = trimmed((await runGit(runner, ['rev-parse', '--show-toplevel'], { cwd })).stdout);
  const bare = trimmed((await runGit(
    runner,
    ['rev-parse', '--is-bare-repository'],
    { cwd },
  )).stdout);
  const gitDirectory = trimmed((await runGit(
    runner,
    ['rev-parse', '--path-format=absolute', '--git-dir'],
    { cwd },
  )).stdout);

  if (bare !== 'false'
    || !samePath(root, cwd)
    || !samePath(gitDirectory, path.join(root, '.git'))) {
    throw repositoryError('DEDICATED_CLONE_REQUIRED');
  }

  const branch = trimmed((await runGit(
    runner,
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    { cwd },
  )).stdout);
  const upstreamValue = trimmed((await runGit(
    runner,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd },
  )).stdout);
  const { remote, branch: upstreamBranch } = parseUpstream(upstreamValue);
  const remoteUrls = (await runGit(
    runner,
    ['remote', 'get-url', '--all', remote],
    { cwd },
  )).stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  const pushUrls = (await runGit(
    runner,
    ['remote', 'get-url', '--push', '--all', remote],
    { cwd },
  )).stdout.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean);
  if (remoteUrls.length === 0
    || pushUrls.length === 0
    || [...remoteUrls, ...pushUrls].some(
      (remoteUrl) => parseRemoteIdentity(remoteUrl) !== expectedRepository.toLowerCase(),
    )) {
    throw repositoryError('REPOSITORY_IDENTITY_MISMATCH');
  }

  const defaultUpstream = trimmed((await runGit(
    runner,
    ['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`],
    { cwd },
  )).stdout);
  const advertisedDefaultBranch = parseRemoteDefaultBranch((await runGit(
    runner,
    ['ls-remote', '--symref', remote, 'HEAD'],
    { cwd },
  )).stdout);
  const expectedUpstream = `${remote}/${upstreamBranch}`;
  if (branch !== upstreamBranch
    || upstreamBranch !== advertisedDefaultBranch
    || defaultUpstream !== expectedUpstream) {
    throw repositoryError('DEFAULT_BRANCH_MISMATCH');
  }

  if (requireClean) {
    const status = (await runGit(
      runner,
      ['status', '--porcelain=v1', '--untracked-files=no'],
      { cwd },
    )).stdout;
    if (status.trim().length > 0) {
      throw repositoryError('TRACKED_WORKTREE_DIRTY');
    }
  }

  return {
    root,
    gitDirectory,
    branch,
    remote,
    remoteUrl: remoteUrls[0],
    pushUrls,
    remoteRef: `refs/remotes/${remote}/${branch}`,
  };
}

export function normalizePublicationPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  const unique = new Set();
  for (const value of paths) {
    if (typeof value !== 'string'
      || value.length === 0
      || value.startsWith('-')
      || value.startsWith('/')
      || value.includes('\\')
      || /[\u0000\r\n]/u.test(value)) {
      throw repositoryError('GIT_INVALID_ARGUMENT');
    }
    const segments = value.split('/');
    if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
      || segments[0] === '.git') {
      throw repositoryError('GIT_INVALID_ARGUMENT');
    }
    unique.add(value);
  }
  return [...unique];
}

function lockInstant(now) {
  let value;
  try {
    value = now();
  } catch {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  return value;
}

function lockContents(createdAt, token) {
  return `${JSON.stringify({
    version: 1,
    pid: process.pid,
    createdAt: createdAt.toISOString(),
    token,
  })}\n`;
}

function parseLockContents(contents) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    throw repositoryError('SYNC_LOCK_INVALID');
  }
  if (value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'createdAt,pid,token,version'
    || value.version !== 1
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.createdAt !== 'string'
    || typeof value.token !== 'string'
    || !LOCK_TOKEN_PATTERN.test(value.token)) {
    throw repositoryError('SYNC_LOCK_INVALID');
  }
  const createdAt = new Date(value.createdAt);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) {
    throw repositoryError('SYNC_LOCK_INVALID');
  }
  return { ...value, createdAtMs: createdAt.getTime() };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size;
}

async function readLockFile(lockPath, fileSystem) {
  let pathStat;
  let handle;
  try {
    pathStat = await fileSystem.lstat(lockPath);
    if (pathStat.isSymbolicLink()
      || !pathStat.isFile()
      || pathStat.size <= 0
      || pathStat.size > MAX_LOCK_BYTES) {
      throw repositoryError('SYNC_LOCK_INVALID');
    }
    const noFollow = fileSystemConstants.O_NOFOLLOW ?? 0;
    handle = await fileSystem.open(
      lockPath,
      fileSystemConstants.O_RDONLY | noFollow,
    );
    const handleStat = await handle.stat();
    if (!handleStat.isFile() || !sameFileIdentity(pathStat, handleStat)) {
      throw repositoryError('SYNC_LOCK_OWNERSHIP_LOST');
    }
    const contents = await handle.readFile('utf8');
    if (Buffer.byteLength(contents, 'utf8') !== pathStat.size) {
      throw repositoryError('SYNC_LOCK_OWNERSHIP_LOST');
    }
    return { contents, owner: parseLockContents(contents) };
  } catch (error) {
    if (error instanceof GitRepositoryError) {
      throw error;
    }
    if (error?.code === 'ENOENT') {
      throw repositoryError('SYNC_LOCK_MISSING');
    }
    throw repositoryError('SYNC_LOCK_INVALID');
  } finally {
    try {
      await handle?.close();
    } catch {
      // The safe read result is discarded when close fails below.
    }
  }
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function recoverStaleLock({
  lockPath,
  fileSystem,
  now,
  staleAfterMs,
  isProcessAlive,
}) {
  let observed;
  try {
    observed = await readLockFile(lockPath, fileSystem);
  } catch (error) {
    if (error?.code === 'SYNC_LOCK_MISSING') {
      return;
    }
    throw error;
  }

  const currentTime = lockInstant(now).getTime();
  const age = currentTime - observed.owner.createdAtMs;
  let ownerAlive = true;
  try {
    ownerAlive = isProcessAlive(observed.owner.pid) !== false;
  } catch {
    ownerAlive = true;
  }
  if (age < staleAfterMs || ownerAlive) {
    throw repositoryError('SYNC_ALREADY_RUNNING');
  }
  throw repositoryError('SYNC_STALE_LOCK');
}

async function acquireLock({ lockPath, lockValue, fileSystem, recover }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidatePath = `${lockPath}.candidate-${randomUUID()}`;
    let handle;
    let linked = false;
    try {
      handle = await fileSystem.open(candidatePath, 'wx', 0o600);
      await handle.writeFile(lockValue, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      await fileSystem.link(candidatePath, lockPath);
      linked = true;
      await fileSystem.unlink(candidatePath);
      return;
    } catch (error) {
      try {
        await handle?.close();
      } catch {
        // Cleanup continues with a safe error below.
      }
      if (linked) {
        try {
          await releaseLock(lockPath, lockValue, fileSystem);
        } catch {
          throw repositoryError('SYNC_LOCK_OWNERSHIP_LOST');
        }
      }
      try {
        await fileSystem.unlink(candidatePath);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw repositoryError('SYNC_LOCK_FAILED');
        }
      }
      if (linked) {
        throw repositoryError('SYNC_LOCK_FAILED');
      }
      if (error?.code !== 'EEXIST') {
        throw repositoryError('SYNC_LOCK_FAILED');
      }
      await recover();
    }
  }
  throw repositoryError('SYNC_ALREADY_RUNNING');
}

async function releaseLock(lockPath, lockValue, fileSystem) {
  const releasePath = `${lockPath}.release-${randomUUID()}`;
  try {
    await fileSystem.rename(lockPath, releasePath);
    const claimed = await readLockFile(releasePath, fileSystem);
    if (claimed.contents !== lockValue) {
      throw repositoryError('SYNC_LOCK_OWNERSHIP_LOST');
    }
    await fileSystem.unlink(releasePath);
  } catch (error) {
    if (error instanceof GitRepositoryError) {
      throw error;
    }
    throw repositoryError('SYNC_LOCK_RELEASE_FAILED');
  }
}

export async function withRepositoryLock(
  {
    cwd = process.cwd(),
    fileSystem = defaultFileSystem,
    now = () => new Date(),
    staleAfterMs = DEFAULT_SYNC_LOCK_STALE_MS,
    isProcessAlive = defaultIsProcessAlive,
  } = {},
  operation,
) {
  if (typeof operation !== 'function'
    || typeof isProcessAlive !== 'function'
    || !assertPositiveSafeInteger(staleAfterMs)) {
    throw repositoryError('GIT_INVALID_ARGUMENT');
  }
  const lockPath = path.join(path.resolve(cwd), '.git', 'agent-card-sync.lock');
  const createdAt = lockInstant(now);
  const lockValue = lockContents(createdAt, randomUUID());
  await acquireLock({
    lockPath,
    lockValue,
    fileSystem,
    recover: () => recoverStaleLock({
      lockPath,
      fileSystem,
      now,
      staleAfterMs,
      isProcessAlive,
    }),
  });

  let operationError;
  let result;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  let releaseError;
  try {
    await releaseLock(lockPath, lockValue, fileSystem);
  } catch (error) {
    releaseError = error;
  }

  if (operationError) {
    throw operationError;
  }
  if (releaseError) {
    throw releaseError;
  }
  return result;
}
