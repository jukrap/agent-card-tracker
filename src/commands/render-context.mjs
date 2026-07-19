import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import {
  assertIsoUtcInstant,
  dateAtInstant,
} from '../domain/calendar.mjs';
import { validateDeviceSnapshot } from '../domain/schema.mjs';

const ERROR_MESSAGES = Object.freeze({
  INVALID_ARGUMENT: 'Expected exactly one --instant value',
  INVALID_INSTANT: 'The render instant must be canonical UTC ISO time',
  NO_DEVICE_SNAPSHOTS: 'At least one device snapshot must establish the card timezone',
  PUBLIC_DATA_INVALID: 'The public device snapshots are invalid',
  TIMEZONE_MISMATCH: 'Every device snapshot must use the same timezone',
});

export class RenderContextError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? 'Render context resolution failed');
    this.name = 'RenderContextError';
    this.code = code;
  }
}

function fail(code) {
  throw new RenderContextError(code);
}

function safeInstant(value) {
  try {
    return assertIsoUtcInstant(value);
  } catch {
    fail('INVALID_INSTANT');
  }
}

async function loadDeviceSnapshots(cwd, fileSystem) {
  const directory = path.join(cwd, 'data', 'devices');
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    fail('PUBLIC_DATA_INVALID');
  }

  const snapshots = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      fail('PUBLIC_DATA_INVALID');
    }
    let snapshot;
    try {
      snapshot = validateDeviceSnapshot(JSON.parse(
        await fileSystem.readFile(path.join(directory, entry.name), 'utf8'),
      ));
    } catch {
      fail('PUBLIC_DATA_INVALID');
    }
    if (entry.name !== `${snapshot.deviceId}.json`) {
      fail('PUBLIC_DATA_INVALID');
    }
    snapshots.push(snapshot);
  }
  return snapshots;
}

export async function resolveRenderContext({
  cwd = process.cwd(),
  instant,
  fileSystem = defaultFileSystem,
} = {}) {
  const asOfInstant = safeInstant(instant);
  const snapshots = await loadDeviceSnapshots(path.resolve(cwd), fileSystem);
  if (snapshots.length === 0) {
    fail('NO_DEVICE_SNAPSHOTS');
  }
  const timezone = snapshots[0].timezone;
  if (snapshots.some((snapshot) => snapshot.timezone !== timezone)) {
    fail('TIMEZONE_MISMATCH');
  }
  return {
    asOf: dateAtInstant(Date.parse(asOfInstant), timezone),
    asOfInstant,
    timezone,
  };
}

function parseArgs(args) {
  if (args.length === 2 && args[0] === '--instant') {
    return { instant: args[1] };
  }
  return { invalid: true };
}

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

export async function run(
  args = [],
  io = { stdout: process.stdout, stderr: process.stderr },
  dependencies = {},
) {
  const options = parseArgs(args);
  if (options.invalid) {
    write(io.stderr, 'Render context failed: INVALID_ARGUMENT');
    return 2;
  }
  try {
    const context = await resolveRenderContext({ ...dependencies, instant: options.instant });
    write(io.stdout, `CARD_AS_OF=${context.asOf}`);
    write(io.stdout, `CARD_AS_OF_INSTANT=${context.asOfInstant}`);
    return 0;
  } catch (error) {
    const code = error instanceof RenderContextError
      ? error.code
      : 'PUBLIC_DATA_INVALID';
    write(io.stderr, `Render context failed: ${code}`);
    return 1;
  }
}
