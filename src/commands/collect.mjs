import { createHash } from 'node:crypto';
import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { collectCcusage } from '../collectors/ccusage.mjs';
import { LOCAL_CONFIG_FILENAME, loadLocalConfig } from '../config.mjs';
import { SCHEMA_VERSION, validateDeviceSnapshot } from '../domain/schema.mjs';
import { writeJsonAtomic } from '../lib/atomic-file.mjs';
import { CLI_NAME } from '../product.mjs';

export const COLLECTOR_VERSION = '0.1.0';

const ERROR_MESSAGES = Object.freeze({
  CLOCK_INVALID: 'Collection clock is invalid',
  EXISTING_SNAPSHOT_INVALID: 'Existing device snapshot is invalid',
  INVALID_ARGUMENT: 'Collect command received an invalid argument',
  SNAPSHOT_READ_FAILED: 'Device snapshot could not be read',
  SNAPSHOT_TIMEZONE_CONFLICT: 'Device snapshot uses a different timezone',
  SNAPSHOT_WRITE_FAILED: 'Device snapshot could not be written',
  WRITER_KEY_CONFLICT: 'Device snapshot belongs to a different local writer',
});

export class CollectCommandError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Device collection failed');
    this.name = 'CollectCommandError';
    this.code = code;
  }
}

function commandError(code) {
  return new CollectCommandError(code);
}

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

export function hashWriterKey(writerKey) {
  return createHash('sha256').update(writerKey, 'utf8').digest('hex');
}

async function readExistingSnapshot(snapshotPath, fileSystem) {
  let contents;
  try {
    contents = await fileSystem.readFile(snapshotPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw commandError('SNAPSHOT_READ_FAILED');
  }

  try {
    return validateDeviceSnapshot(JSON.parse(contents));
  } catch {
    throw commandError('EXISTING_SNAPSHOT_INVALID');
  }
}

function collectionInstant(now) {
  let value;
  try {
    value = now();
  } catch {
    throw commandError('CLOCK_INVALID');
  }
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw commandError('CLOCK_INVALID');
  }
  return value.toISOString();
}

function safeErrorCode(error) {
  if (typeof error?.code === 'string' && /^CCUSAGE_[A-Z0-9_]{1,55}$/.test(error.code)) {
    return error.code;
  }
  return 'COLLECTION_FAILED';
}

function previousSource(existing) {
  return existing?.sources?.codex ?? {
    lastSuccessfulAt: null,
    days: [],
    coverage: { totals: null, sessions: null },
  };
}

function dateInTimezone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function collectSource({
  timezone,
  collectedAt,
  existing,
  runner,
  collectUsage,
  cwd,
}) {
  try {
    const result = await collectUsage({
      timezone,
      includeSessions: true,
      runner,
      runnerOptions: { cwd },
    });
    const collectionDate = dateInTimezone(collectedAt, timezone);
    const totals = {
      startDate: result.days[0]?.date ?? collectionDate,
      endDate: collectionDate,
    };
    return {
      status: 'ok',
      lastSuccessfulAt: collectedAt,
      days: result.days,
      coverage: {
        totals,
        sessions: result.sessionStatus === 'ok' ? { ...totals } : null,
      },
    };
  } catch (error) {
    const previous = previousSource(existing);
    return {
      status: 'error',
      errorCode: safeErrorCode(error),
      lastSuccessfulAt: previous.lastSuccessfulAt,
      days: previous.days,
      coverage: previous.coverage,
    };
  }
}

export async function collectDeviceUsage({
  cwd = process.cwd(),
  configPath = path.join(cwd, LOCAL_CONFIG_FILENAME),
  snapshotPath,
  now = () => new Date(),
  runner,
  collectUsage = collectCcusage,
  fileSystem = defaultFileSystem,
  collectorVersion = COLLECTOR_VERSION,
} = {}) {
  const config = await loadLocalConfig(configPath, { fileSystem });
  const publicWriterKeyHash = hashWriterKey(config.writerKey);
  const outputPath = snapshotPath
    ?? path.join(cwd, 'data', 'devices', `${config.deviceId}.json`);
  const existing = await readExistingSnapshot(outputPath, fileSystem);

  if (existing
    && (existing.deviceId !== config.deviceId
      || existing.writerKeyHash !== publicWriterKeyHash)) {
    throw commandError('WRITER_KEY_CONFLICT');
  }
  if (existing && existing.timezone !== config.timezone) {
    throw commandError('SNAPSHOT_TIMEZONE_CONFLICT');
  }

  const collectedAt = collectionInstant(now);
  const sourceOptions = {
    timezone: config.timezone,
    collectedAt,
    existing,
    runner,
    collectUsage,
    cwd,
  };
  const codex = await collectSource(sourceOptions);

  const snapshot = {
    schemaVersion: SCHEMA_VERSION,
    deviceId: config.deviceId,
    writerKeyHash: publicWriterKeyHash,
    generatedAt: collectedAt,
    timezone: config.timezone,
    collectorVersion,
    sources: { codex },
  };

  validateDeviceSnapshot(snapshot);
  try {
    await writeJsonAtomic(outputPath, snapshot, {
      validate: validateDeviceSnapshot,
      fileSystem,
    });
  } catch (error) {
    if (error instanceof CollectCommandError) {
      throw error;
    }
    throw commandError('SNAPSHOT_WRITE_FAILED');
  }
  return snapshot;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--config' && args[index + 1]) {
      options.configPath = args[index + 1];
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      options.invalid = true;
    }
  }
  return options;
}

export async function run(
  args,
  io,
  {
    cwd = process.cwd(),
    now,
    runner,
    collectUsage,
    fileSystem = defaultFileSystem,
  } = {},
) {
  const options = parseArgs(args);
  if (options.help) {
    write(io.stdout, `Usage: ${CLI_NAME} collect [--config PATH]`);
    return 0;
  }
  if (options.invalid) {
    write(io.stderr, 'Collect failed: INVALID_ARGUMENT');
    return 2;
  }

  try {
    const snapshot = await collectDeviceUsage({
      cwd,
      configPath: options.configPath
        ? path.resolve(cwd, options.configPath)
        : path.join(cwd, LOCAL_CONFIG_FILENAME),
      now,
      runner,
      collectUsage,
      fileSystem,
    });
    write(
      io.stdout,
      `${snapshot.deviceId} codex=${snapshot.sources.codex.status} days=${snapshot.sources.codex.days.length}`,
    );
    return 0;
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
      ? error.code
      : 'COLLECT_FAILED';
    write(io.stderr, `Collect failed: ${code}`);
    return 1;
  }
}
