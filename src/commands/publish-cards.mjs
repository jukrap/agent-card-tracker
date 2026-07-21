import { randomUUID } from 'node:crypto';
import * as defaultFileSystem from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { assertIsoDate } from '../domain/calendar.mjs';
import { GitPublishError, publishChanges } from '../git/publish.mjs';
import { CLI_NAME } from '../product.mjs';

const CARD_PATHS = Object.freeze([
  'cards/overview.svg',
  'cards/achievements.svg',
  'cards/records.svg',
  'cards/trends.svg',
  'cards/activity.svg',
  'cards/compact.svg',
]);

const HELP = `Usage: ${CLI_NAME} publish-cards --as-of YYYY-MM-DD

Render, validate, and publish exactly the six static SVG cards.
Use this only as a recovery path when the GitHub render workflow is unavailable.
`;

class PublishCardsError extends GitPublishError {
  constructor(code) {
    super(code);
    this.name = 'PublishCardsError';
    this.message = code === 'AS_OF_INVALID'
      ? 'A valid --as-of calendar date is required'
      : 'Card publication failed';
  }
}

function publishCardsError(code) {
  return new PublishCardsError(code);
}

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

function quietIo() {
  const sink = { write() {} };
  return { stdout: sink, stderr: sink };
}

function safeAsOf(value) {
  try {
    return assertIsoDate(value);
  } catch {
    throw publishCardsError('AS_OF_INVALID');
  }
}

async function captureCards(cwd, fileSystem) {
  const backups = new Map();
  for (const cardPath of CARD_PATHS) {
    const absolutePath = path.join(cwd, ...cardPath.split('/'));
    try {
      backups.set(cardPath, await fileSystem.readFile(absolutePath));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      backups.set(cardPath, null);
    }
  }
  return backups;
}

async function restoreCards(cwd, backups, fileSystem) {
  for (const [cardPath, contents] of backups) {
    const absolutePath = path.join(cwd, ...cardPath.split('/'));
    if (contents === null) {
      try {
        await fileSystem.unlink(absolutePath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }
      continue;
    }

    await fileSystem.mkdir(path.dirname(absolutePath), { recursive: true });
    const temporaryPath = path.join(
      cwd,
      '.git',
      `agent-card-card-restore-${process.pid}-${randomUUID()}.tmp`,
    );
    try {
      await fileSystem.writeFile(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
      await fileSystem.rename(temporaryPath, absolutePath);
    } catch (error) {
      try {
        await fileSystem.unlink(temporaryPath);
      } catch (cleanupError) {
        if (cleanupError?.code !== 'ENOENT') {
          throw cleanupError;
        }
      }
      throw error;
    }
  }
}

async function defaultRenderCards({ cwd, asOf }) {
  const renderer = await import('./render.mjs');
  if (typeof renderer.renderCards === 'function') {
    return renderer.renderCards({ cwd, asOf });
  }
  if (typeof renderer.run !== 'function') {
    throw new TypeError('render command has no programmatic entry point');
  }
  const status = await renderer.run(['--as-of', asOf], quietIo(), { cwd });
  if (status !== 0) {
    throw new TypeError('card rendering failed');
  }
  return true;
}

async function defaultValidateRepository({ cwd }) {
  const validator = await import('./validate.mjs');
  if (typeof validator.validateRepository === 'function') {
    return validator.validateRepository({ cwd });
  }
  if (typeof validator.validatePublicArtifacts === 'function') {
    return validator.validatePublicArtifacts({ cwd });
  }
  if (typeof validator.run !== 'function') {
    throw new TypeError('validate command has no programmatic entry point');
  }
  const status = await validator.run([], quietIo(), { cwd });
  if (status !== 0) {
    throw new TypeError('repository validation failed');
  }
  return true;
}

export async function publishCards({
  cwd = process.cwd(),
  asOf,
  gitRunner,
  fileSystem,
  renderCards = defaultRenderCards,
  validateRepository = defaultValidateRepository,
  publishChangesImpl = publishChanges,
  maxPushAttempts,
} = {}) {
  const date = safeAsOf(asOf);
  const activeFileSystem = fileSystem ?? defaultFileSystem;
  let pendingBackup = null;
  return publishChangesImpl({
    cwd,
    runner: gitRunner,
    fileSystem,
    maxPushAttempts,
    resolvePlan: async () => ({
      allowedPaths: [...CARD_PATHS],
      collisionPaths: [...CARD_PATHS],
      commitMessage: 'chore(cards): usage cards update',
      rebuildAfterRebase: true,
      rollback: async () => {
        const backup = pendingBackup;
        if (backup === null) {
          return;
        }
        await restoreCards(cwd, backup, activeFileSystem);
        if (pendingBackup === backup) {
          pendingBackup = null;
        }
      },
      complete: async () => {
        pendingBackup = null;
      },
      build: async () => {
        pendingBackup = await captureCards(cwd, activeFileSystem);
        await renderCards({ cwd, asOf: date, fileSystem: activeFileSystem });
        return { stagePaths: [...CARD_PATHS] };
      },
      validate: async () => {
        const result = await validateRepository({ cwd, fileSystem: activeFileSystem });
        if (result === false) {
          throw new TypeError('repository validation failed');
        }
        return true;
      },
    }),
  });
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--as-of' && args[index + 1]) {
      if (options.asOf !== undefined) {
        options.invalid = true;
      }
      options.asOf = args[index + 1];
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
  args = [],
  io = { stdout: process.stdout, stderr: process.stderr },
  dependencies = {},
) {
  const options = parseArgs(args);
  if (options.help) {
    write(io.stdout, HELP);
    return 0;
  }
  if (options.invalid || options.asOf === undefined) {
    write(io.stderr, 'Card publication failed: INVALID_ARGUMENT');
    return 2;
  }

  try {
    const result = await publishCards({ ...dependencies, asOf: options.asOf });
    write(
      io.stdout,
      result.status === 'noop' ? 'Cards are already up to date.' : 'Cards published.',
    );
    return 0;
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/u.test(error.code)
      ? error.code
      : 'PUBLISH_CARDS_FAILED';
    write(io.stderr, `Card publication failed: ${code}`);
    return 1;
  }
}
