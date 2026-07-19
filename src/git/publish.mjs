import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  GitRepositoryError,
  TARGET_REPOSITORY,
  createGitRunner,
  inspectDedicatedRepository,
  normalizePublicationPaths,
  runGit,
  withRepositoryLock,
} from './repository.mjs';

export const DEFAULT_PUSH_ATTEMPTS = 3;

const COMMON_EXIT_CODES = Object.freeze(Array.from({ length: 256 }, (_value, index) => index));
const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;
const UNSAFE_ATTRIBUTES = Object.freeze([
  'filter',
  'diff',
  'merge',
  'working-tree-encoding',
  'ident',
]);
const SAFE_REMOTE_CARD_PATHS = new Set([
  'cards/activity.svg',
  'cards/overview.svg',
  'cards/trends.svg',
]);
const SAFE_REMOTE_DATA_PATH_PATTERN = /^data\/(?:devices|profiles)\/device-[0-9a-f]{32}\.json$/u;
const ERROR_MESSAGES = Object.freeze({
  BUILD_FAILED: 'Public artifacts could not be prepared',
  COMMIT_FAILED: 'The publication commit could not be created',
  GIT_STATE_INVALID: 'The Git synchronization state is invalid',
  INVALID_PUBLICATION_PLAN: 'The publication plan is invalid',
  LOCAL_HISTORY_UNSAFE: 'Local commits contain paths outside this publication scope',
  PRE_COMMIT_RECOVERY_FAILED: 'Git could not safely restore publication files after a failed commit',
  PUBLICATION_SCOPE_VIOLATION: 'The publication changed paths outside its allowed scope',
  PUSH_AUTH_FAILED: 'Git authentication failed; the local commit was preserved',
  PUSH_FAILED: 'Git push failed; the local commit was preserved',
  PUSH_RETRY_EXHAUSTED: 'Git push retry limit was reached; the local commit was preserved',
  REBASE_ABORT_FAILED: 'Git could not restore the pre-rebase state',
  REBASE_CONFLICT: 'Git rebase conflicted and was aborted; the local commit was preserved',
  REMOTE_HISTORY_REWRITTEN: 'The remote branch history changed unexpectedly',
  REMOTE_PATH_COLLISION: 'A publication-owned path changed on the remote branch',
  REMOTE_UPDATE_REQUIRES_RESTART: 'Remote code or configuration changed; update the clone and restart synchronization',
  VALIDATION_FAILED: 'Public artifact validation failed',
});

export class GitPublishError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Git publication failed');
    this.name = 'GitPublishError';
    this.code = code;
  }
}

function publishError(code) {
  return new GitPublishError(code);
}

function safeCommitMessage(value) {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > 120
    || /[\u0000\r\n]/u.test(value)
    || /device-[0-9a-f]{32}/iu.test(value)
    || /\b[0-9a-f]{32,}\b/iu.test(value)
    || /\bBearer\b/iu.test(value)
    || /(?:https?:\/\/|[A-Za-z]:\\|\/(?:home|Users)\/)/u.test(value)) {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  return value;
}

function assertAttempts(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_PUSH_ATTEMPTS) {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  return value;
}

function subset(paths, allowed) {
  return paths.every((entry) => allowed.has(entry));
}

function outputLines(value) {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseAheadBehind(value) {
  const match = /^(?<ahead>\d+)\s+(?<behind>\d+)$/u.exec(value.trim());
  if (!match) {
    throw publishError('GIT_STATE_INVALID');
  }
  const ahead = Number(match.groups.ahead);
  const behind = Number(match.groups.behind);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) {
    throw publishError('GIT_STATE_INVALID');
  }
  return { ahead, behind };
}

async function remoteOid(repository, runner, cwd) {
  const result = await runGit(
    runner,
    ['rev-parse', '--verify', repository.remoteRef],
    { cwd },
  );
  const oid = result.stdout.trim();
  if (!OBJECT_ID_PATTERN.test(oid)) {
    throw publishError('GIT_STATE_INVALID');
  }
  return oid;
}

async function branchCounts(repository, runner, cwd) {
  const result = await runGit(
    runner,
    ['rev-list', '--left-right', '--count', `HEAD...${repository.remoteRef}`],
    { cwd },
  );
  return parseAheadBehind(result.stdout);
}

async function mergeBase(repository, runner, cwd) {
  const result = await runGit(
    runner,
    ['merge-base', 'HEAD', repository.remoteRef],
    { cwd },
  );
  const oid = result.stdout.trim();
  if (!OBJECT_ID_PATTERN.test(oid)) {
    throw publishError('GIT_STATE_INVALID');
  }
  return oid;
}

async function changedPaths(runner, cwd, range, paths = []) {
  const args = [
    'log',
    '--format=',
    '--name-only',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--diff-merges=separate',
    '--no-renames',
    '--diff-filter=ACDMRTUXB',
    range,
    '--',
    ...paths,
  ];
  const result = await runGit(runner, args, { cwd });
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

function assertRemoteChangesArePublicationArtifacts(paths) {
  if (paths.some(
    (changedPath) => !SAFE_REMOTE_CARD_PATHS.has(changedPath)
      && !SAFE_REMOTE_DATA_PATH_PATTERN.test(changedPath),
  )) {
    throw publishError('REMOTE_UPDATE_REQUIRES_RESTART');
  }
}

function assertNoRemoteCollision(paths, collisionPaths) {
  const collisions = new Set(collisionPaths);
  if (paths.some((changedPath) => collisions.has(changedPath))) {
    throw publishError('REMOTE_PATH_COLLISION');
  }
}

async function assertPublishedBlobsMatchWorking(runner, cwd, paths) {
  for (const publicationPath of paths) {
    const headOid = (await runGit(
      runner,
      ['rev-parse', '--verify', `HEAD:${publicationPath}`],
      { cwd },
    )).stdout.trim();
    const indexOid = (await runGit(
      runner,
      ['rev-parse', '--verify', `:${publicationPath}`],
      { cwd },
    )).stdout.trim();
    const workingOid = (await runGit(
      runner,
      ['hash-object', '--no-filters', '--', publicationPath],
      { cwd },
    )).stdout.trim();
    if (!OBJECT_ID_PATTERN.test(headOid)
      || !OBJECT_ID_PATTERN.test(indexOid)
      || !OBJECT_ID_PATTERN.test(workingOid)
      || headOid !== indexOid
      || headOid !== workingOid) {
      throw publishError('LOCAL_HISTORY_UNSAFE');
    }
  }
}

async function assertLocalHistoryScope(
  repository,
  runner,
  cwd,
  allowedPaths,
  commitMessage,
) {
  const counts = await branchCounts(repository, runner, cwd);
  if (counts.ahead === 0) {
    return counts;
  }
  if (counts.ahead !== 1) {
    throw publishError('LOCAL_HISTORY_UNSAFE');
  }
  const base = await mergeBase(repository, runner, cwd);
  const parents = (await runGit(
    runner,
    ['rev-list', '--parents', '-n', '1', 'HEAD'],
    { cwd },
  )).stdout.trim().split(/\s+/u);
  if (parents.length !== 2
    || !parents.every((oid) => OBJECT_ID_PATTERN.test(oid))
    || parents[1] !== base) {
    throw publishError('LOCAL_HISTORY_UNSAFE');
  }

  const actualMessage = (await runGit(
    runner,
    ['log', '-1', '--format=%B', 'HEAD'],
    { cwd },
  )).stdout.replaceAll('\r\n', '\n').replace(/\n+$/u, '');
  if (actualMessage !== commitMessage) {
    throw publishError('LOCAL_HISTORY_UNSAFE');
  }

  const rawChanges = (await runGit(
    runner,
    [
      'diff-tree',
      '--no-ext-diff',
      '--no-textconv',
      '--no-commit-id',
      '--name-status',
      '-z',
      '-r',
      'HEAD',
      '--',
    ],
    { cwd },
  )).stdout.split('\0');
  if (rawChanges.at(-1) === '') {
    rawChanges.pop();
  }
  if (rawChanges.length === 0 || rawChanges.length % 2 !== 0) {
    throw publishError('LOCAL_HISTORY_UNSAFE');
  }
  const touched = [];
  for (let index = 0; index < rawChanges.length; index += 2) {
    if (!['A', 'M'].includes(rawChanges[index])) {
      throw publishError('LOCAL_HISTORY_UNSAFE');
    }
    touched.push(rawChanges[index + 1]);
  }
  if (!subset(touched, new Set(allowedPaths))) {
    throw publishError('LOCAL_HISTORY_UNSAFE');
  }
  await assertPublishedBlobsMatchWorking(runner, cwd, touched);
  return { ...counts, pendingPaths: touched };
}

async function abortRebase(runner, cwd) {
  const result = await runGit(
    runner,
    ['rebase', '--abort'],
    { cwd, allowExitCodes: COMMON_EXIT_CODES },
  );
  if (result.exitCode !== 0) {
    throw publishError('REBASE_ABORT_FAILED');
  }
}

async function rebase(repository, runner, cwd) {
  const result = await runGit(
    runner,
    [
      'rebase',
      '--no-update-refs',
      '--no-autostash',
      '--no-rebase-merges',
      '--no-gpg-sign',
      repository.remoteRef,
    ],
    { cwd, allowExitCodes: COMMON_EXIT_CODES },
  );
  if (result.exitCode !== 0) {
    await abortRebase(runner, cwd);
    throw publishError('REBASE_CONFLICT');
  }
}

async function fetchRemote(repository, runner, cwd) {
  await runGit(
    runner,
    [
      'fetch',
      '--no-prune',
      '--no-prune-tags',
      '--no-tags',
      '--recurse-submodules=no',
      repository.remote,
      `+refs/heads/${repository.branch}:${repository.remoteRef}`,
    ],
    { cwd },
  );
  return remoteOid(repository, runner, cwd);
}

async function ensureCleanTrackedState(runner, cwd) {
  const result = await runGit(
    runner,
    ['status', '--porcelain=v1', '--untracked-files=no'],
    { cwd },
  );
  if (result.stdout.trim().length > 0) {
    throw publishError('PUBLICATION_SCOPE_VIOLATION');
  }
}

async function assertSafeAttributes(runner, cwd, paths, source) {
  const uniquePaths = [...new Set(paths)];
  for (let offset = 0; offset < uniquePaths.length; offset += 100) {
    const batch = uniquePaths.slice(offset, offset + 100);
    const result = await runGit(
      runner,
      [
        'check-attr',
        '-z',
        ...(source === undefined ? [] : [`--source=${source}`]),
        ...UNSAFE_ATTRIBUTES,
        '--',
        ...batch,
      ],
      { cwd },
    );
    const fields = result.stdout.split('\0');
    if (fields.at(-1) === '') {
      fields.pop();
    }
    if (fields.length !== batch.length * UNSAFE_ATTRIBUTES.length * 3) {
      throw publishError('GIT_STATE_INVALID');
    }

    const expected = new Set(batch.flatMap(
      (trackedPath) => UNSAFE_ATTRIBUTES.map(
        (attribute) => `${trackedPath}\0${attribute}`,
      ),
    ));
    for (let index = 0; index < fields.length; index += 3) {
      const key = `${fields[index]}\0${fields[index + 1]}`;
      const value = fields[index + 2];
      if (!expected.delete(key) || !['unspecified', 'unset'].includes(value)) {
        throw publishError('GIT_STATE_INVALID');
      }
    }
    if (expected.size !== 0) {
      throw publishError('GIT_STATE_INVALID');
    }
  }
}

async function nulSeparatedPaths(runner, cwd, args) {
  const result = await runGit(runner, args, { cwd });
  const fields = result.stdout.split('\0');
  if (fields.at(-1) === '') {
    fields.pop();
  }
  if (fields.some((entry) => entry.length === 0 || /[\u0000\r\n]/u.test(entry))) {
    throw publishError('GIT_STATE_INVALID');
  }
  return fields;
}

async function assertSafeCurrentTreeAttributes(runner, cwd, extraPaths) {
  const trackedPaths = await nulSeparatedPaths(
    runner,
    cwd,
    ['ls-files', '--cached', '-z'],
  );
  await assertSafeAttributes(runner, cwd, [...trackedPaths, ...extraPaths]);
}

async function assertSafeSourceTreeAttributes(runner, cwd, source, extraPaths) {
  const trackedPaths = await nulSeparatedPaths(
    runner,
    cwd,
    ['ls-tree', '-r', '--name-only', '-z', source],
  );
  await assertSafeAttributes(
    runner,
    cwd,
    [...trackedPaths, ...extraPaths],
    source,
  );
}

async function assertInfoAttributesEmpty(gitDirectory, fileSystem) {
  const attributesPath = path.join(gitDirectory, 'info', 'attributes');
  let stats;
  try {
    stats = await fileSystem.lstat(attributesPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return;
    }
    throw publishError('GIT_STATE_INVALID');
  }
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size !== 0) {
    throw publishError('GIT_STATE_INVALID');
  }
}

async function assertNoConfiguredHooks(runner, cwd) {
  for (const scope of ['--local', '--worktree', '--global', '--system']) {
    const result = await runGit(
      runner,
      ['config', scope, '--get-regexp', '^hook\\.'],
      { cwd, allowExitCodes: [0, 1] },
    );
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      throw publishError('GIT_STATE_INVALID');
    }
  }
}

async function recoverValidatedOwnedWorktreeChanges(
  runner,
  cwd,
  repository,
  plan,
  fileSystem,
) {
  await assertNoConfiguredHooks(runner, cwd);
  await assertInfoAttributesEmpty(repository.gitDirectory, fileSystem);
  await assertSafeCurrentTreeAttributes(runner, cwd, plan.allowedPaths);
  const result = await runGit(
    runner,
    ['status', '--porcelain=v1', '-z', '--untracked-files=no'],
    { cwd },
  );
  const entries = result.stdout.split('\0').filter((entry) => entry.length > 0);
  if (entries.length === 0) {
    return;
  }

  const allowed = new Set(plan.allowedPaths);
  const dirtyPaths = [];
  for (const entry of entries) {
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const publicationPath = entry.slice(3);
    if (entry.length < 4
      || entry[2] !== ' '
      || indexStatus !== ' '
      || worktreeStatus !== 'M'
      || !allowed.has(publicationPath)) {
      throw publishError('PUBLICATION_SCOPE_VIOLATION');
    }
    dirtyPaths.push(publicationPath);
  }

  await validatePlan(plan);
  await runGit(runner, ['restore', '--worktree', '--', ...dirtyPaths], { cwd });
  await ensureCleanTrackedState(runner, cwd);
}

async function updateBeforeBuild({
  repository,
  runner,
  cwd,
  allowedPaths,
  collisionPaths,
  commitMessage,
}) {
  const currentRemoteOid = await fetchRemote(repository, runner, cwd);
  await assertSafeSourceTreeAttributes(
    runner,
    cwd,
    repository.remoteRef,
    allowedPaths,
  );
  const counts = await assertLocalHistoryScope(
    repository,
    runner,
    cwd,
    allowedPaths,
    commitMessage,
  );
  if (counts.behind === 0) {
    return {
      remoteHead: currentRemoteOid,
      pendingCommit: counts.ahead === 1,
      pendingPaths: counts.pendingPaths ?? [],
    };
  }

  const base = await mergeBase(repository, runner, cwd);
  const remoteChanges = await changedPaths(
    runner,
    cwd,
    `${base}..${repository.remoteRef}`,
  );
  assertRemoteChangesArePublicationArtifacts(remoteChanges);

  if (counts.ahead === 0) {
    await runGit(
      runner,
      ['merge', '--no-verify-signatures', '--ff-only', repository.remoteRef],
      { cwd },
    );
  } else {
    assertNoRemoteCollision(remoteChanges, collisionPaths);
    await rebase(repository, runner, cwd);
  }
  await ensureCleanTrackedState(runner, cwd);
  const updatedCounts = await assertLocalHistoryScope(
    repository,
    runner,
    cwd,
    allowedPaths,
    commitMessage,
  );
  return {
    remoteHead: currentRemoteOid,
    pendingCommit: updatedCounts.ahead === 1,
    pendingPaths: updatedCounts.pendingPaths ?? [],
  };
}

function normalizePlan(plan) {
  if (plan === null
    || typeof plan !== 'object'
    || typeof plan.build !== 'function'
    || typeof plan.validate !== 'function') {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  for (const lifecycle of ['rollback', 'complete']) {
    if (plan[lifecycle] !== undefined && typeof plan[lifecycle] !== 'function') {
      throw publishError('INVALID_PUBLICATION_PLAN');
    }
  }
  const allowedPaths = normalizePublicationPaths(plan.allowedPaths);
  const collisionPaths = normalizePublicationPaths(
    plan.collisionPaths ?? allowedPaths,
  );
  const allowed = new Set(allowedPaths);
  if (!subset(collisionPaths, allowed)) {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  return {
    ...plan,
    allowedPaths,
    collisionPaths,
    commitMessage: safeCommitMessage(plan.commitMessage),
    rebuildAfterRebase: plan.rebuildAfterRebase === true,
  };
}

async function validatePlan(plan) {
  try {
    const result = await plan.validate();
    if (result === false) {
      throw publishError('VALIDATION_FAILED');
    }
  } catch (error) {
    if (error instanceof GitPublishError) {
      throw error;
    }
    throw publishError('VALIDATION_FAILED');
  }
}

async function rollbackPlan(plan) {
  if (typeof plan.rollback === 'function') {
    await plan.rollback();
  }
}

async function completePlan(plan) {
  if (typeof plan.complete === 'function') {
    await plan.complete();
  }
}

async function recoverWorkingTree(runner, cwd, plan) {
  try {
    await rollbackPlan(plan);
    await ensureCleanTrackedState(runner, cwd);
  } catch {
    throw publishError('PRE_COMMIT_RECOVERY_FAILED');
  }
}

async function buildPlan(plan, reason) {
  let result;
  try {
    result = await plan.build({ reason });
  } catch (error) {
    if (error instanceof GitRepositoryError || error instanceof GitPublishError) {
      throw error;
    }
    throw publishError('BUILD_FAILED');
  }
  if (result === null || typeof result !== 'object') {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  const stagePaths = normalizePublicationPaths(result.stagePaths);
  if (!subset(stagePaths, new Set(plan.allowedPaths))) {
    throw publishError('PUBLICATION_SCOPE_VIOLATION');
  }
  return { ...result, stagePaths };
}

async function assertTrackedChangesInScope(runner, cwd, allowedPaths) {
  const result = await runGit(
    runner,
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd },
  );
  const allowed = new Set(allowedPaths);
  for (const line of result.stdout.split(/\r?\n/u)) {
    if (line.length === 0 || line.startsWith('?? ')) {
      continue;
    }
    if (line.length < 4
      || line.slice(0, 2).includes('R')
      || line.slice(0, 2).includes('C')
      || !allowed.has(line.slice(3))) {
      throw publishError('PUBLICATION_SCOPE_VIOLATION');
    }
  }
}

async function recoverPreCommit(runner, cwd, plan) {
  try {
    const restored = await runGit(
      runner,
      ['restore', '--staged', '--', ...plan.allowedPaths],
      { cwd, allowExitCodes: COMMON_EXIT_CODES },
    );
    if (restored.exitCode !== 0) {
      throw publishError('PRE_COMMIT_RECOVERY_FAILED');
    }
    await rollbackPlan(plan);
    await ensureCleanTrackedState(runner, cwd);
  } catch {
    throw publishError('PRE_COMMIT_RECOVERY_FAILED');
  }
}

async function stageAndCommit({
  repository,
  runner,
  cwd,
  plan,
  stagePaths,
  amend = false,
}) {
  let commitCreated = false;
  try {
    await assertNoConfiguredHooks(runner, cwd);
    await assertSafeCurrentTreeAttributes(runner, cwd, plan.allowedPaths);
    await assertTrackedChangesInScope(runner, cwd, plan.allowedPaths);
    await runGit(runner, ['add', '--', ...stagePaths], { cwd });

    const unstagedAfterAdd = await runGit(
      runner,
      ['diff', '--no-ext-diff', '--no-textconv', '--quiet', '--', ...stagePaths],
      { cwd, allowExitCodes: [0, 1] },
    );
    if (unstagedAfterAdd.exitCode !== 0) {
      throw publishError('PUBLICATION_SCOPE_VIOLATION');
    }
    await validatePlan(plan);

    const cachedNames = outputLines((await runGit(
      runner,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--cached',
        '--name-only',
        '--',
        ...plan.allowedPaths,
      ],
      { cwd },
    )).stdout);
    if (!subset(cachedNames, new Set(stagePaths))) {
      throw publishError('PUBLICATION_SCOPE_VIOLATION');
    }

    const staged = await runGit(
      runner,
      [
        'diff',
        '--no-ext-diff',
        '--no-textconv',
        '--cached',
        '--quiet',
        '--',
        ...stagePaths,
      ],
      { cwd, allowExitCodes: [0, 1] },
    );
    if (staged.exitCode === 0) {
      await assertPublishedBlobsMatchWorking(runner, cwd, stagePaths);
      await assertLocalHistoryScope(
        repository,
        runner,
        cwd,
        plan.allowedPaths,
        plan.commitMessage,
      );
      return false;
    }

    const args = amend
      ? ['commit', '--no-gpg-sign', '--amend', '--no-edit', '--', ...stagePaths]
      : ['commit', '--no-gpg-sign', '-m', plan.commitMessage, '--', ...stagePaths];
    const commit = await runGit(
      runner,
      args,
      { cwd, allowExitCodes: COMMON_EXIT_CODES },
    );
    if (commit.exitCode !== 0) {
      throw publishError('COMMIT_FAILED');
    }
    commitCreated = true;
  } catch (error) {
    if (!commitCreated) {
      await recoverPreCommit(runner, cwd, plan);
    }
    throw error;
  }

  await validatePlan(plan);
  await ensureCleanTrackedState(runner, cwd);
  await assertLocalHistoryScope(
    repository,
    runner,
    cwd,
    plan.allowedPaths,
    plan.commitMessage,
  );
  return true;
}

function isNonFastForward(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /non-fast-forward|fetch first|\[rejected\].*\((?:stale info|fetch first)\)/iu.test(output);
}

function isAuthenticationFailure(result) {
  const output = `${result.stdout}\n${result.stderr}`;
  return /authentication failed|permission denied|could not read username|http basic: access denied|\b(?:401|403)\b/iu.test(output);
}

async function push(repository, runner, cwd) {
  const result = await runGit(
    runner,
    [
      'push',
      '--porcelain',
      '--no-follow-tags',
      '--no-signed',
      '--recurse-submodules=no',
      '--receive-pack=git-receive-pack',
      repository.remote,
      `HEAD:refs/heads/${repository.branch}`,
    ],
    { cwd, allowExitCodes: COMMON_EXIT_CODES },
  );
  if (result.exitCode === 0) {
    const records = result.stdout
      .split(/\r?\n/u)
      .filter((line) => /^[ +*!\-=]\t/u.test(line));
    if (records.length !== 1) {
      throw publishError('PUSH_FAILED');
    }
    const fields = records[0].split('\t');
    if (fields.length < 3
      || fields[1] !== `HEAD:refs/heads/${repository.branch}`) {
      throw publishError('PUSH_FAILED');
    }
  }
  return result;
}

async function assertRemoteAdvancedLinearly(runner, cwd, previousOid, nextOid) {
  if (previousOid === nextOid) {
    return;
  }
  const result = await runGit(
    runner,
    ['merge-base', '--is-ancestor', previousOid, nextOid],
    { cwd, allowExitCodes: [0, 1] },
  );
  if (result.exitCode !== 0) {
    throw publishError('REMOTE_HISTORY_REWRITTEN');
  }
}

async function isLocalHeadPublished(repository, runner, cwd) {
  const result = await runGit(
    runner,
    ['merge-base', '--is-ancestor', 'HEAD', repository.remoteRef],
    { cwd, allowExitCodes: [0, 1] },
  );
  return result.exitCode === 0;
}

async function publishPrepared({
  repository,
  runner,
  cwd,
  plan,
  remoteHead,
  maxPushAttempts,
}) {
  let latestRemoteHead = remoteHead;
  for (let attempt = 1; attempt <= maxPushAttempts; attempt += 1) {
    const result = await push(repository, runner, cwd);
    if (result.exitCode === 0) {
      return { status: 'pushed', attempts: attempt };
    }
    if (isAuthenticationFailure(result)) {
      throw publishError('PUSH_AUTH_FAILED');
    }

    const nonFastForwardHint = isNonFastForward(result);
    const previousRemoteHead = latestRemoteHead;
    try {
      latestRemoteHead = await fetchRemote(repository, runner, cwd);
    } catch {
      throw publishError('PUSH_FAILED');
    }
    await assertSafeSourceTreeAttributes(
      runner,
      cwd,
      repository.remoteRef,
      plan.allowedPaths,
    );
    const remoteAdvanced = previousRemoteHead !== latestRemoteHead;
    if (!nonFastForwardHint && !remoteAdvanced) {
      throw publishError('PUSH_FAILED');
    }
    if (remoteAdvanced && await isLocalHeadPublished(repository, runner, cwd)) {
      return { status: 'pushed', attempts: attempt };
    }

    await assertRemoteAdvancedLinearly(
      runner,
      cwd,
      previousRemoteHead,
      latestRemoteHead,
    );
    const remoteChanges = await changedPaths(
      runner,
      cwd,
      `${previousRemoteHead}..${latestRemoteHead}`,
    );
    assertRemoteChangesArePublicationArtifacts(remoteChanges);
    assertNoRemoteCollision(remoteChanges, plan.collisionPaths);
    if (attempt === maxPushAttempts) {
      throw publishError('PUSH_RETRY_EXHAUSTED');
    }

    await rebase(repository, runner, cwd);
    await assertNoConfiguredHooks(runner, cwd);
    await assertSafeCurrentTreeAttributes(runner, cwd, plan.allowedPaths);
    await ensureCleanTrackedState(runner, cwd);
    await assertLocalHistoryScope(
      repository,
      runner,
      cwd,
      plan.allowedPaths,
      plan.commitMessage,
    );
    await validatePlan(plan);
    if (plan.rebuildAfterRebase) {
      let rebuilt;
      try {
        rebuilt = await buildPlan(plan, 'rebase');
        await validatePlan(plan);
      } catch (error) {
        await recoverWorkingTree(runner, cwd, plan);
        throw error;
      }
      await stageAndCommit({
        repository,
        runner,
        cwd,
        plan,
        stagePaths: rebuilt.stagePaths,
        amend: true,
      });
      await completePlan(plan);
    }
    await ensureCleanTrackedState(runner, cwd);
    await assertLocalHistoryScope(
      repository,
      runner,
      cwd,
      plan.allowedPaths,
      plan.commitMessage,
    );
  }
  throw publishError('PUSH_RETRY_EXHAUSTED');
}

export async function publishChanges({
  cwd = process.cwd(),
  runner = createGitRunner(),
  fileSystem,
  expectedRepository = TARGET_REPOSITORY,
  maxPushAttempts = DEFAULT_PUSH_ATTEMPTS,
  resolvePlan,
} = {}) {
  if (typeof resolvePlan !== 'function') {
    throw publishError('INVALID_PUBLICATION_PLAN');
  }
  const safeAttempts = assertAttempts(maxPushAttempts);
  const activeFileSystem = fileSystem ?? defaultFileSystem;

  const preflight = await inspectDedicatedRepository({
    cwd,
    runner,
    expectedRepository,
    requireClean: false,
  });
  return withRepositoryLock({ cwd: preflight.root, fileSystem: activeFileSystem }, async () => {
    const preliminaryRepository = await inspectDedicatedRepository({
      cwd: preflight.root,
      runner,
      expectedRepository,
      requireClean: false,
    });
    const plan = normalizePlan(await resolvePlan({ repository: preliminaryRepository }));
    await recoverValidatedOwnedWorktreeChanges(
      runner,
      preliminaryRepository.root,
      preliminaryRepository,
      plan,
      activeFileSystem,
    );
    const repository = await inspectDedicatedRepository({
      cwd: preliminaryRepository.root,
      runner,
      expectedRepository,
    });
    const preparation = await updateBeforeBuild({
      repository,
      runner,
      cwd: repository.root,
      allowedPaths: plan.allowedPaths,
      collisionPaths: plan.collisionPaths,
      commitMessage: plan.commitMessage,
    });

    await validatePlan(plan);
    let built;
    try {
      built = await buildPlan(plan, 'initial');
      await validatePlan(plan);
    } catch (error) {
      await recoverWorkingTree(runner, repository.root, plan);
      throw error;
    }
    const committed = await stageAndCommit({
      repository,
      runner,
      cwd: repository.root,
      plan,
      stagePaths: built.stagePaths,
      amend: preparation.pendingCommit,
    });
    await completePlan(plan);
    const counts = await branchCounts(repository, runner, repository.root);
    if (!committed && counts.ahead === 0) {
      return { status: 'noop', attempts: 0, ...built };
    }

    const result = await publishPrepared({
      repository,
      runner,
      cwd: repository.root,
      plan,
      remoteHead: preparation.remoteHead,
      maxPushAttempts: safeAttempts,
    });
    return { ...result, ...built };
  });
}
