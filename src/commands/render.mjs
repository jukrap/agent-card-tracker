import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { assertIsoDate } from '../domain/calendar.mjs';
import { mergeUsage } from '../domain/merge.mjs';
import {
  validateDeviceSnapshot,
  validateProfileCandidate,
} from '../domain/schema.mjs';
import { computeStatistics } from '../domain/statistics.mjs';
import { renderActivity } from '../render/activity.mjs';
import { renderOverview } from '../render/overview.mjs';
import { validateSvgDocument } from '../render/svg-validator.mjs';
import { renderTrends } from '../render/trends.mjs';

const CARD_NAMES = Object.freeze(['overview', 'trends', 'activity']);
const HELP = `Render deterministic static SVG cards

Usage:
  agent-card render --as-of YYYY-MM-DD

The as-of date is required so the same public data produces identical bytes.
`;

export class RenderCommandError extends Error {
  constructor(code) {
    super(`Card rendering failed: ${code}`);
    this.name = 'RenderCommandError';
    this.code = code;
  }
}

function fail(code) {
  throw new RenderCommandError(code);
}

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function validateAsOf(value) {
  try {
    return assertIsoDate(value);
  } catch {
    fail('INVALID_AS_OF');
  }
}

function mergeInstant(asOf) {
  return `${asOf}T23:59:59.999Z`;
}

async function listJsonFiles(directory, fileSystem) {
  let entries;
  try {
    entries = await fileSystem.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    fail('PUBLIC_DATA_READ_FAILED');
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .toSorted();
}

async function loadPublicJson(directory, validator, fileSystem) {
  const values = [];
  for (const filename of await listJsonFiles(directory, fileSystem)) {
    let parsed;
    try {
      const contents = await fileSystem.readFile(path.join(directory, filename), 'utf8');
      parsed = JSON.parse(contents);
      validator(parsed);
    } catch {
      fail('PUBLIC_DATA_INVALID');
    }
    if (`${parsed.deviceId}.json` !== filename) {
      fail('PUBLIC_DATA_FILENAME');
    }
    values.push(parsed);
  }
  return values;
}

async function stageCards({
  cards,
  outputDirectory,
  fileSystem,
  validateSvg,
}) {
  await fileSystem.mkdir(outputDirectory, { recursive: true });
  const stagingDirectory = await fileSystem.mkdtemp(path.join(outputDirectory, '.render-'));
  try {
    for (const name of CARD_NAMES) {
      const contents = cards[name];
      await validateSvg(contents);
      await fileSystem.writeFile(
        path.join(stagingDirectory, `${name}.svg`),
        contents,
        { encoding: 'utf8', flag: 'wx', mode: 0o644 },
      );
    }

    for (const name of CARD_NAMES) {
      await fileSystem.rename(
        path.join(stagingDirectory, `${name}.svg`),
        path.join(outputDirectory, `${name}.svg`),
      );
    }
  } finally {
    await fileSystem.rm(stagingDirectory, { recursive: true, force: true });
  }
}

/**
 * Loads all sanitized public snapshots, computes coverage-aware statistics, and
 * atomically replaces the three deterministic card files after every SVG has
 * passed validation.
 */
export async function renderCards({
  cwd = process.cwd(),
  asOf,
  outputDirectory = path.join(cwd, 'cards'),
  fileSystem = defaultFileSystem,
  validateSvg = validateSvgDocument,
} = {}) {
  const asOfDate = validateAsOf(asOf);
  const deviceSnapshots = await loadPublicJson(
    path.join(cwd, 'data', 'devices'),
    validateDeviceSnapshot,
    fileSystem,
  );
  const profileCandidates = await loadPublicJson(
    path.join(cwd, 'data', 'profiles'),
    validateProfileCandidate,
    fileSystem,
  );
  const merged = mergeUsage({
    deviceSnapshots,
    profileCandidates,
    asOf: mergeInstant(asOfDate),
  });
  const statistics = computeStatistics(merged, { asOf: asOfDate });
  const cards = {
    overview: renderOverview(statistics, {
      codexSource: merged.codexSource,
      staleDeviceCount: merged.diagnostics.staleDeviceCount,
    }),
    trends: renderTrends(statistics),
    activity: renderActivity(statistics),
  };
  const resolvedOutputDirectory = path.resolve(cwd, outputDirectory);
  await stageCards({
    cards,
    outputDirectory: resolvedOutputDirectory,
    fileSystem,
    validateSvg,
  });

  return {
    asOf: asOfDate,
    cardPaths: Object.fromEntries(
      CARD_NAMES.map((name) => [name, path.join(resolvedOutputDirectory, `${name}.svg`)]),
    ),
  };
}

function parseArgs(args) {
  if (args.length === 1 && ['--help', '-h', 'help'].includes(args[0])) {
    return { help: true };
  }
  if (args.length === 2 && args[0] === '--as-of') {
    return { asOf: args[1] };
  }
  return { invalid: true };
}

export async function run(
  args = [],
  io = { stdout: process.stdout, stderr: process.stderr },
  dependencies = {},
) {
  const options = parseArgs(args);
  if (options.help) {
    write(io.stdout, HELP);
    return 0;
  }
  if (options.invalid) {
    write(io.stderr, 'Usage: agent-card render --as-of YYYY-MM-DD');
    return 2;
  }

  try {
    const result = await renderCards({ ...dependencies, asOf: options.asOf });
    write(io.stdout, `Rendered 3 cards as of ${result.asOf}.`);
    return 0;
  } catch (error) {
    const code = error instanceof RenderCommandError ? error.code : 'RENDER_FAILED';
    write(io.stderr, `Render failed: ${code}`);
    return 1;
  }
}
