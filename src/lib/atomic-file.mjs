import { randomUUID } from 'node:crypto';
import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';

function stableJsonError(reason) {
  return new TypeError(`Cannot create stable JSON: ${reason}`);
}

function canonicalize(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw stableJsonError('numbers must be finite');
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw stableJsonError('unsupported value type');
  }

  if (ancestors.has(value)) {
    throw stableJsonError('cyclic values are not supported');
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw stableJsonError('sparse arrays are not supported');
        }
        result.push(canonicalize(value[index], ancestors));
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw stableJsonError('only arrays and plain objects are supported');
    }

    const stringKeys = Object.keys(value);
    if (Reflect.ownKeys(value).length !== stringKeys.length) {
      throw stableJsonError('object properties must be enumerable string keys');
    }

    const result = {};
    for (const key of stringKeys.sort()) {
      result[key] = canonicalize(value[key], ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

export function stableStringify(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export async function writeJsonAtomic(
  filePath,
  value,
  {
    validate,
    fileSystem = defaultFileSystem,
    mode = 0o600,
  } = {},
) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('filePath must be a non-empty string');
  }
  if (validate !== undefined && typeof validate !== 'function') {
    throw new TypeError('validate must be a function');
  }

  if (validate) {
    await validate(value);
  }

  const contents = stableStringify(value);
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const tempPath = path.join(
    directory,
    `.${basename}.${process.pid}.${randomUUID()}.tmp`,
  );

  await fileSystem.mkdir(directory, { recursive: true });

  try {
    await fileSystem.writeFile(tempPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode,
    });
    await fileSystem.rename(tempPath, filePath);
  } catch (error) {
    try {
      await fileSystem.unlink(tempPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') {
        error.cleanupError = cleanupError;
      }
    }
    throw error;
  }

  return filePath;
}
