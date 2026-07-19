import { randomBytes } from 'node:crypto';
import * as defaultFileSystem from 'node:fs/promises';

import { validateIanaTimezone } from './domain/schema.mjs';

export const LOCAL_CONFIG_VERSION = 1;
export const LOCAL_CONFIG_FILENAME = '.agent-card.local.json';

const DEVICE_ID_PATTERN = /^device-[0-9a-f]{32}$/;
const WRITER_KEY_PATTERN = /^[0-9a-f]{64}$/;
const LOCAL_CONFIG_KEYS = new Set([
  'schemaVersion',
  'deviceId',
  'writerKey',
  'timezone',
]);

const ERROR_MESSAGES = Object.freeze({
  CONFIG_EXISTS: 'Local configuration already exists',
  CONFIG_INVALID: 'Local configuration is invalid',
  CONFIG_NOT_FOUND: 'Local configuration was not found',
  CONFIG_READ_FAILED: 'Local configuration could not be read',
  CONFIG_WRITE_FAILED: 'Local configuration could not be written',
});

export class LocalConfigError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Local configuration failed');
    this.name = 'LocalConfigError';
    this.code = code;
  }
}

function configError(code) {
  return new LocalConfigError(code);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExactConfigObject(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.length === LOCAL_CONFIG_KEYS.size
    && keys.every((key) => LOCAL_CONFIG_KEYS.has(key));
}

function bytesToHex(value, expectedLength) {
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    throw configError('CONFIG_INVALID');
  }
  return Buffer.from(value).toString('hex');
}

export function validateLocalConfig(config) {
  if (!isExactConfigObject(config)
    || config.schemaVersion !== LOCAL_CONFIG_VERSION
    || typeof config.deviceId !== 'string'
    || !DEVICE_ID_PATTERN.test(config.deviceId)
    || typeof config.writerKey !== 'string'
    || !WRITER_KEY_PATTERN.test(config.writerKey)
    || config.writerKey === config.deviceId.slice('device-'.length)) {
    throw configError('CONFIG_INVALID');
  }

  try {
    validateIanaTimezone(config.timezone);
  } catch {
    throw configError('CONFIG_INVALID');
  }
  return config;
}

export function createLocalConfig({
  timezone,
  randomBytesImpl = randomBytes,
} = {}) {
  try {
    validateIanaTimezone(timezone);
  } catch {
    throw configError('CONFIG_INVALID');
  }

  if (typeof randomBytesImpl !== 'function') {
    throw configError('CONFIG_INVALID');
  }

  let deviceHex;
  let writerKey;
  try {
    deviceHex = bytesToHex(randomBytesImpl(16), 16);
    writerKey = bytesToHex(randomBytesImpl(32), 32);
  } catch (error) {
    if (error instanceof LocalConfigError) {
      throw error;
    }
    throw configError('CONFIG_INVALID');
  }

  return validateLocalConfig({
    schemaVersion: LOCAL_CONFIG_VERSION,
    deviceId: `device-${deviceHex}`,
    writerKey,
    timezone,
  });
}

export async function loadLocalConfig(
  configPath,
  { fileSystem = defaultFileSystem } = {},
) {
  let contents;
  try {
    contents = await fileSystem.readFile(configPath, 'utf8');
  } catch (error) {
    throw configError(error?.code === 'ENOENT' ? 'CONFIG_NOT_FOUND' : 'CONFIG_READ_FAILED');
  }

  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw configError('CONFIG_INVALID');
  }

  return validateLocalConfig(parsed);
}
