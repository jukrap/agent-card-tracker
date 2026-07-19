import { execFile as execFileCallback } from 'node:child_process';
import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify, TextDecoder } from 'node:util';

import { SaxesParser } from 'saxes';

import {
  validateDeviceSnapshot,
  validateProfileCandidate,
} from '../domain/schema.mjs';
import { stableStringify } from '../lib/atomic-file.mjs';
import { validateSvgDocument } from '../render/svg-validator.mjs';

const execFile = promisify(execFileCallback);
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_SVG_BYTES = 200 * 1024;
const MAX_PUBLIC_FILES = 4096;
const MAX_GIT_OUTPUT_BYTES = 8 * 1024 * 1024;
const SAFE_RULE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9._/-]+$/;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const PUBLIC_DIRECTORIES = Object.freeze([
  {
    relativeDirectory: 'data/devices',
    extension: '.json',
    kind: 'device',
    maxBytes: MAX_JSON_BYTES,
  },
  {
    relativeDirectory: 'data/profiles',
    extension: '.json',
    kind: 'profile',
    maxBytes: MAX_JSON_BYTES,
  },
  {
    relativeDirectory: 'cards',
    extension: '.svg',
    kind: 'card',
    maxBytes: MAX_SVG_BYTES,
  },
]);

const FORBIDDEN_FIELD_NAMES = new Set([
  'accountid',
  'accesstoken',
  'apikey',
  'authorization',
  'bearer',
  'clientsecret',
  'credential',
  'email',
  'filepath',
  'homepath',
  'hostname',
  'identity',
  'model',
  'password',
  'path',
  'project',
  'projectpath',
  'prompt',
  'raw',
  'rawdata',
  'rawjson',
  'rawlog',
  'rawoutput',
  'refreshtoken',
  'response',
  'secret',
  'sessionid',
  'useridentity',
  'username',
]);

const SENSITIVE_PATTERNS = Object.freeze([
  ['PUBLIC_EMAIL', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
  [
    'PUBLIC_HOME_PATH',
    /(?:\b[A-Za-z]:[\\/]+(?:Users|Documents[ \\]+and[ \\]+Settings)[\\/]+|\/(?:home|Users|root)(?:\/|\b))[^\s"'<>]*/i,
  ],
  ['PUBLIC_BEARER', /\bBearer[ \t]+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/i],
  ['PUBLIC_JWT', /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  [
    'PUBLIC_API_KEY',
    /(?:\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bAKIA[0-9A-Z]{16}\b|\bapi[_-]?key\b[ \t]*[:=][ \t]*["']?[A-Za-z0-9._~+\/-]{12,})/i,
  ],
  [
    'PUBLIC_SECRET',
    /\b(?:client[_-]?secret|access[_-]?token|refresh[_-]?token|password|secret)\b[ \t]*[:=][ \t]*["']?[A-Za-z0-9._~+\/-]{12,}/i,
  ],
]);

function lexicalCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeFieldName(fieldName) {
  return fieldName.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

function normalizeRelativePath(filePath) {
  if (typeof filePath !== 'string') {
    return null;
  }
  const normalized = filePath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    return null;
  }
  return normalized;
}

function safePathLabel(filePath) {
  const normalized = normalizeRelativePath(filePath);
  if (normalized === null || !SAFE_RELATIVE_PATH.test(normalized)) {
    return '<unsafe-path>';
  }
  return normalized;
}

export class RepositoryValidationError extends Error {
  constructor(code, filePath = '<repository>') {
    const safeCode = SAFE_RULE_CODE.test(code) ? code : 'VALIDATION_FAILED';
    const safePath = filePath === '<repository>' ? filePath : safePathLabel(filePath);
    super(`${safeCode} at ${safePath}`);
    this.name = 'RepositoryValidationError';
    this.code = safeCode;
    this.path = safePath;
  }
}

function fail(code, filePath) {
  throw new RepositoryValidationError(code, filePath);
}

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function isNotFound(error) {
  return error?.code === 'ENOENT';
}

function isWithinRoot(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  if (process.platform === 'win32') {
    return resolvedLeft.toLowerCase() === resolvedRight.toLowerCase();
  }
  return resolvedLeft === resolvedRight;
}

function fileStatChanged(left, right) {
  return left.size !== right.size
    || (left.dev !== undefined && right.dev !== left.dev)
    || (left.ino !== undefined && right.ino !== left.ino)
    || (left.mtimeMs !== undefined && right.mtimeMs !== left.mtimeMs)
    || (left.ctimeMs !== undefined && right.ctimeMs !== left.ctimeMs);
}

function scanSensitiveText(value, filePath) {
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)) {
    fail('PUBLIC_CONTROL_CHARACTER', filePath);
  }
  for (const [code, pattern] of SENSITIVE_PATTERNS) {
    if (pattern.test(value)) {
      fail(code, filePath);
    }
  }
}

function scanSensitivePublicPath(relativePath) {
  scanSensitiveText(relativePath, '<unsafe-path>');
}

function decodeXmlCharacterReferences(value) {
  const decodedNumeric = value.replace(
    /&#(?:x([0-9A-F]+)|([0-9]+));/giu,
    (_match, hexadecimal, decimal) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal, hexadecimal ? 16 : 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return '\u0000';
      }
    },
  );
  const predefined = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };
  return decodedNumeric.replace(/&(amp|apos|gt|lt|quot);/gu, (_match, name) => predefined[name]);
}

function scanVisibleSvgText(svg, filePath) {
  const parser = new SaxesParser({ xmlns: true, position: false });
  const stack = [];
  let visibleText = '';
  parser.on('opentag', (tag) => stack.push(tag.local));
  parser.on('closetag', () => stack.pop());
  parser.on('text', (text) => {
    if (['title', 'desc', 'text', 'tspan'].includes(stack.at(-1))) {
      scanSensitiveText(text, filePath);
      visibleText += text;
    }
  });
  parser.write(svg).close();
  scanSensitiveText(visibleText, filePath);
}

function scanJsonValue(value, filePath, depth = 0) {
  if (depth > 64) {
    fail('PUBLIC_MAX_DEPTH', filePath);
  }
  if (typeof value === 'string') {
    scanSensitiveText(value, filePath);
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      scanJsonValue(entry, filePath, depth + 1);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_FIELD_NAMES.has(normalizeFieldName(key))) {
      fail('PUBLIC_FORBIDDEN_FIELD', filePath);
    }
    scanSensitiveText(key, filePath);
    scanJsonValue(entry, filePath, depth + 1);
  }
}

function parseAndValidateJson(contents, filePath, kind) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch {
    fail('JSON_PARSE', filePath);
  }

  scanJsonValue(value, filePath);
  if (stableStringify(value) !== contents) {
    fail('JSON_CANONICAL', filePath);
  }
  try {
    if (kind === 'device') {
      validateDeviceSnapshot(value);
    } else {
      validateProfileCandidate(value);
    }
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }
    fail(kind === 'device' ? 'DEVICE_SCHEMA' : 'PROFILE_SCHEMA', filePath);
  }
  if (path.posix.basename(filePath) !== `${value.deviceId}.json`) {
    fail('PUBLIC_FILENAME', filePath);
  }
}

async function safeLstat(fileSystem, targetPath, filePath, code = 'PUBLIC_READ') {
  try {
    return await fileSystem.lstat(targetPath);
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    fail(code, filePath);
  }
}

async function readPublicFile({
  rootPath,
  absolutePath,
  relativePath,
  maxBytes,
  fileSystem,
}) {
  if (!isWithinRoot(rootPath, absolutePath)) {
    fail('PUBLIC_PATH_TRAVERSAL', '<unsafe-path>');
  }

  const before = await safeLstat(fileSystem, absolutePath, relativePath);
  if (before === null) {
    fail('PUBLIC_READ', relativePath);
  }
  if (before.isSymbolicLink()) {
    fail('PUBLIC_SYMLINK', relativePath);
  }
  if (!before.isFile()) {
    fail('PUBLIC_FILE_TYPE', relativePath);
  }
  if (before.size > maxBytes) {
    fail('PUBLIC_FILE_SIZE', relativePath);
  }

  try {
    const realPath = await fileSystem.realpath(absolutePath);
    if (!isWithinRoot(rootPath, realPath) || !samePath(realPath, absolutePath)) {
      fail('PUBLIC_SYMLINK', relativePath);
    }
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }
    fail('PUBLIC_READ', relativePath);
  }

  let handle;
  try {
    handle = await fileSystem.open(absolutePath, 'r');
  } catch {
    fail('PUBLIC_READ', relativePath);
  }

  let contents;
  try {
    const openedBefore = await handle.stat();
    if (!openedBefore.isFile() || fileStatChanged(before, openedBefore)) {
      fail('PUBLIC_FILE_CHANGED', relativePath);
    }
    if (openedBefore.size > maxBytes) {
      fail('PUBLIC_FILE_SIZE', relativePath);
    }
    contents = await handle.readFile();
    const openedAfter = await handle.stat();
    if (!openedAfter.isFile() || fileStatChanged(openedBefore, openedAfter)) {
      fail('PUBLIC_FILE_CHANGED', relativePath);
    }
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }
    fail('PUBLIC_READ', relativePath);
  } finally {
    try {
      await handle.close();
    } catch {
      // The opened bytes were read-only; a close failure must not expose OS details.
    }
  }
  if (contents.byteLength > maxBytes) {
    fail('PUBLIC_FILE_SIZE', relativePath);
  }

  const after = await safeLstat(fileSystem, absolutePath, relativePath);
  if (
    after === null
    || after.isSymbolicLink()
    || !after.isFile()
    || fileStatChanged(before, after)
  ) {
    fail('PUBLIC_FILE_CHANGED', relativePath);
  }
  return decodeUtf8(contents, relativePath);
}

async function discoverPublicFiles(rootPath, definition, fileSystem) {
  const directoryPath = path.join(rootPath, ...definition.relativeDirectory.split('/'));
  const directoryStat = await safeLstat(
    fileSystem,
    directoryPath,
    definition.relativeDirectory,
    'PUBLIC_DIRECTORY_READ',
  );
  if (directoryStat === null) {
    return [];
  }
  if (directoryStat.isSymbolicLink()) {
    fail('PUBLIC_SYMLINK', definition.relativeDirectory);
  }
  if (!directoryStat.isDirectory()) {
    fail('PUBLIC_DIRECTORY_TYPE', definition.relativeDirectory);
  }

  try {
    const realDirectoryPath = await fileSystem.realpath(directoryPath);
    if (!isWithinRoot(rootPath, realDirectoryPath) || !samePath(realDirectoryPath, directoryPath)) {
      fail('PUBLIC_SYMLINK', definition.relativeDirectory);
    }
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }
    fail('PUBLIC_DIRECTORY_READ', definition.relativeDirectory);
  }

  let entries;
  try {
    entries = await fileSystem.readdir(directoryPath, { withFileTypes: true });
  } catch {
    fail('PUBLIC_DIRECTORY_READ', definition.relativeDirectory);
  }
  if (entries.length > MAX_PUBLIC_FILES) {
    fail('PUBLIC_FILE_COUNT', definition.relativeDirectory);
  }

  entries.sort((left, right) => lexicalCompare(left.name, right.name));
  const files = [];
  for (const entry of entries) {
    const relativePath = `${definition.relativeDirectory}/${entry.name}`;
    if (safePathLabel(relativePath) === '<unsafe-path>') {
      fail('PUBLIC_PATH_NAME', '<unsafe-path>');
    }
    scanSensitivePublicPath(relativePath);
    if (entry.isSymbolicLink()) {
      fail('PUBLIC_SYMLINK', relativePath);
    }
    if (!entry.isFile() || path.posix.extname(entry.name) !== definition.extension) {
      fail('PUBLIC_FILE_TYPE', relativePath);
    }
    files.push({
      ...definition,
      relativePath,
      absolutePath: path.join(directoryPath, entry.name),
    });
  }
  return files;
}

async function hasGitMetadata(rootPath, fileSystem) {
  const gitPath = path.join(rootPath, '.git');
  try {
    await fileSystem.lstat(gitPath);
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    fail('GIT_INDEX_READ', '<repository>');
  }
}

function parseNulList(stdout) {
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

async function defaultListGitEntries(rootPath, fileSystem) {
  if (!(await hasGitMetadata(rootPath, fileSystem))) {
    return [];
  }

  let listed;
  let staged;
  try {
    [listed, staged] = await Promise.all([
      execFile(
        'git',
        ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
        { cwd: rootPath, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT_BYTES },
      ),
      execFile(
        'git',
        ['ls-files', '-z', '--stage'],
        { cwd: rootPath, encoding: 'utf8', maxBuffer: MAX_GIT_OUTPUT_BYTES },
      ),
    ]);
  } catch {
    fail('GIT_INDEX_READ', '<repository>');
  }

  const indexEntries = new Map();
  for (const record of parseNulList(staged.stdout)) {
    const separator = record.indexOf('\t');
    if (separator < 0) {
      fail('GIT_INDEX_FORMAT', '<repository>');
    }
    const metadata = record.slice(0, separator).split(' ');
    if (
      metadata.length !== 3
      || !/^[0-7]{6}$/.test(metadata[0])
      || !/^[0-9a-f]{40,64}$/.test(metadata[1])
      || !/^[0-3]$/.test(metadata[2])
    ) {
      fail('GIT_INDEX_FORMAT', '<repository>');
    }
    const entryPath = record.slice(separator + 1);
    const existing = indexEntries.get(entryPath);
    if (existing === undefined || metadata[2] !== '0') {
      indexEntries.set(entryPath, {
        mode: metadata[0],
        objectId: metadata[1],
        stage: metadata[2],
      });
    }
  }
  return parseNulList(listed.stdout).map((entryPath) => {
    const indexEntry = indexEntries.get(entryPath);
    return {
      path: entryPath,
      mode: indexEntry?.mode ?? null,
      objectId: indexEntry?.objectId ?? null,
      stage: indexEntry?.stage ?? null,
    };
  });
}

function decodeUtf8(value, filePath) {
  if (typeof value === 'string') {
    return value;
  }
  if (!(value instanceof Uint8Array)) {
    fail('PUBLIC_READ', filePath);
  }
  try {
    return UTF8_DECODER.decode(value);
  } catch {
    fail('PUBLIC_UTF8', filePath);
  }
}

async function defaultReadGitBlob({ rootPath, objectId, maxBytes, filePath }) {
  if (typeof objectId !== 'string' || !/^[0-9a-f]{40,64}$/.test(objectId)) {
    fail('GIT_INDEX_FORMAT', filePath);
  }

  let sizeOutput;
  try {
    ({ stdout: sizeOutput } = await execFile(
      'git',
      ['cat-file', '-s', objectId],
      { cwd: rootPath, encoding: 'utf8', maxBuffer: 128 },
    ));
  } catch {
    fail('GIT_BLOB_READ', filePath);
  }
  const trimmedSize = sizeOutput.trim();
  if (!/^\d+$/.test(trimmedSize)) {
    fail('GIT_INDEX_FORMAT', filePath);
  }
  const size = Number(trimmedSize);
  if (!Number.isSafeInteger(size) || size < 0) {
    fail('GIT_INDEX_FORMAT', filePath);
  }
  if (size > maxBytes) {
    fail('PUBLIC_FILE_SIZE', filePath);
  }

  let contents;
  try {
    ({ stdout: contents } = await execFile(
      'git',
      ['cat-file', 'blob', objectId],
      { cwd: rootPath, encoding: null, maxBuffer: maxBytes + 1 },
    ));
  } catch {
    fail('GIT_BLOB_READ', filePath);
  }
  if (contents.byteLength !== size) {
    fail('GIT_BLOB_READ', filePath);
  }
  return decodeUtf8(contents, filePath);
}

function isLocalOnlyPath(relativePath) {
  const segments = relativePath.split('/').map((segment) => segment.toLowerCase());
  const basename = segments.at(-1);
  if (
    segments.some((segment) => [
      '.ai-agent-playbook',
      '.agents',
      '.claude',
      '.codex',
      '.worktrees',
    ].includes(segment))
  ) {
    return true;
  }
  if (basename === 'agents.md' || basename === '.agent-card.local.json') {
    return true;
  }
  if (basename === '.env' || (basename.startsWith('.env.') && basename !== '.env.example')) {
    return true;
  }
  return basename.endsWith('.log');
}

function isRawLogPath(relativePath) {
  const lower = relativePath.toLowerCase();
  return lower.endsWith('.jsonl') || lower.endsWith('.ndjson');
}

function publicDefinitionForPath(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  for (const definition of PUBLIC_DIRECTORIES) {
    const prefix = `${definition.relativeDirectory}/`;
    const lowerDirectory = definition.relativeDirectory.toLowerCase();
    if (lowerPath === lowerDirectory || lowerPath.startsWith(`${lowerDirectory}/`)) {
      if (
        relativePath !== definition.relativeDirectory
        && !relativePath.startsWith(prefix)
      ) {
        scanSensitivePublicPath(relativePath);
        fail('PUBLIC_PATH_CASE', relativePath);
      }
      return definition;
    }
  }
  return null;
}

function inspectRepositoryEntries(entries) {
  if (!Array.isArray(entries)) {
    fail('GIT_INDEX_FORMAT', '<repository>');
  }
  const normalizedEntries = entries.map((entry) => {
    const rawPath = typeof entry === 'string' ? entry : entry?.path;
    const relativePath = normalizeRelativePath(rawPath);
    if (relativePath === null) {
      fail('PUBLIC_PATH_TRAVERSAL', '<unsafe-path>');
    }
    return {
      path: relativePath,
      mode: typeof entry === 'object' && entry !== null ? entry.mode : null,
      objectId: typeof entry === 'object' && entry !== null ? entry.objectId : null,
      stage: typeof entry === 'object' && entry !== null ? entry.stage : null,
    };
  }).sort((left, right) => lexicalCompare(left.path, right.path));

  for (const entry of normalizedEntries) {
    if (entry.stage !== null && entry.stage !== undefined && entry.stage !== '0') {
      fail('GIT_INDEX_CONFLICT', entry.path);
    }
    if (isLocalOnlyPath(entry.path)) {
      fail('LOCAL_ONLY_PATH', entry.path);
    }
    if (isRawLogPath(entry.path)) {
      fail('RAW_LOG_PATH', entry.path);
    }

    const definition = publicDefinitionForPath(entry.path);
    if (definition !== null) {
      scanSensitivePublicPath(entry.path);
      if (entry.mode === '120000') {
        fail('PUBLIC_SYMLINK', entry.path);
      }
      if (entry.mode !== null && entry.mode !== undefined && !['100644', '100755'].includes(entry.mode)) {
        fail('PUBLIC_GIT_MODE', entry.path);
      }
      if (entry.path === definition.relativeDirectory) {
        fail('PUBLIC_FILE_TYPE', entry.path);
      }
      const tail = entry.path.slice(definition.relativeDirectory.length + 1);
      if (tail.includes('/') || path.posix.extname(tail) !== definition.extension) {
        fail('PUBLIC_FILE_TYPE', entry.path);
      }
    }
  }
  return normalizedEntries;
}

function validatePublicContents(contents, file) {
  const text = decodeUtf8(contents, file.relativePath);
  if (Buffer.byteLength(text, 'utf8') > file.maxBytes) {
    fail('PUBLIC_FILE_SIZE', file.relativePath);
  }
  if (file.kind === 'card') {
    scanSensitiveText(text, file.relativePath);
    scanSensitiveText(decodeXmlCharacterReferences(text), file.relativePath);
    try {
      validateSvgDocument(text, { filePath: file.relativePath });
      scanVisibleSvgText(text, file.relativePath);
    } catch (error) {
      if (error instanceof RepositoryValidationError) {
        throw error;
      }
      const code = typeof error?.code === 'string' && SAFE_RULE_CODE.test(error.code)
        ? error.code
        : 'SVG_INVALID';
      fail(code, file.relativePath);
    }
  } else {
    parseAndValidateJson(text, file.relativePath, file.kind);
  }
}

export async function validateRepository({
  cwd = process.cwd(),
  fileSystem = defaultFileSystem,
  listGitEntries,
  readGitBlob,
} = {}) {
  if (typeof cwd !== 'string' || cwd.length === 0) {
    fail('INVALID_ROOT', '<repository>');
  }
  const rootPath = path.resolve(cwd);
  let rootStat;
  try {
    rootStat = await fileSystem.lstat(rootPath);
  } catch {
    fail('INVALID_ROOT', '<repository>');
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    fail('INVALID_ROOT', '<repository>');
  }

  let entries;
  try {
    entries = listGitEntries
      ? await listGitEntries({ cwd: rootPath })
      : await defaultListGitEntries(rootPath, fileSystem);
  } catch (error) {
    if (error instanceof RepositoryValidationError) {
      throw error;
    }
    fail('GIT_INDEX_READ', '<repository>');
  }
  const normalizedEntries = inspectRepositoryEntries(entries);
  for (const entry of normalizedEntries) {
    const definition = publicDefinitionForPath(entry.path);
    if (definition === null || entry.objectId === null || entry.objectId === undefined) {
      continue;
    }
    let contents;
    try {
      contents = readGitBlob
        ? await readGitBlob({
          cwd: rootPath,
          objectId: entry.objectId,
          maxBytes: definition.maxBytes,
          filePath: entry.path,
        })
        : await defaultReadGitBlob({
          rootPath,
          objectId: entry.objectId,
          maxBytes: definition.maxBytes,
          filePath: entry.path,
        });
    } catch (error) {
      if (error instanceof RepositoryValidationError) {
        throw error;
      }
      fail('GIT_BLOB_READ', entry.path);
    }
    validatePublicContents(contents, {
      ...definition,
      relativePath: entry.path,
    });
  }

  const groups = [];
  for (const definition of PUBLIC_DIRECTORIES) {
    groups.push(await discoverPublicFiles(rootPath, definition, fileSystem));
  }

  const result = {
    deviceSnapshots: 0,
    profileCandidates: 0,
    cards: 0,
  };
  for (const files of groups) {
    for (const file of files) {
      const contents = await readPublicFile({
        rootPath,
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        maxBytes: file.maxBytes,
        fileSystem,
      });
      validatePublicContents(contents, file);
      if (file.kind === 'card') {
        result.cards += 1;
      } else if (file.kind === 'device') {
        result.deviceSnapshots += 1;
      } else {
        result.profileCandidates += 1;
      }
    }
  }
  return result;
}

function parseArgs(args) {
  let help = false;
  let invalid = false;
  for (const argument of args) {
    if (argument === '--help' || argument === '-h') {
      help = true;
    } else {
      invalid = true;
    }
  }
  return { help, invalid };
}

export async function run(
  args = [],
  io = { stdout: process.stdout, stderr: process.stderr },
  {
    cwd = process.cwd(),
    fileSystem = defaultFileSystem,
    listGitEntries,
    readGitBlob,
  } = {},
) {
  const options = parseArgs(args);
  if (options.help) {
    write(io.stdout, 'Usage: agent-card validate');
    return 0;
  }
  if (options.invalid) {
    write(io.stderr, 'Validation failed: INVALID_ARGUMENT at <repository>');
    return 2;
  }

  try {
    const result = await validateRepository({ cwd, fileSystem, listGitEntries, readGitBlob });
    write(
      io.stdout,
      `Validated devices=${result.deviceSnapshots} profiles=${result.profileCandidates} cards=${result.cards}`,
    );
    return 0;
  } catch (error) {
    const code = error instanceof RepositoryValidationError
      ? error.code
      : 'VALIDATION_FAILED';
    const errorPath = error instanceof RepositoryValidationError
      ? error.path
      : '<repository>';
    write(io.stderr, `Validation failed: ${code} at ${errorPath}`);
    return 1;
  }
}
