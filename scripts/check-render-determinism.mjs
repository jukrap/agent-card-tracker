import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CARD_ARTIFACT_PATHS } from '../src/card-catalog.mjs';
import { assertIsoDate, assertIsoUtcInstant } from '../src/domain/calendar.mjs';
import { renderCards } from '../src/commands/render.mjs';

const args = process.argv.slice(2);
let asOf = null;
let asOfInstant;
let invalid = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  try {
    if (argument === '--as-of' && args[index + 1] && asOf === null) {
      asOf = assertIsoDate(args[index + 1]);
      index += 1;
    } else if (
      argument === '--as-of-instant'
      && args[index + 1]
      && asOfInstant === undefined
    ) {
      asOfInstant = assertIsoUtcInstant(args[index + 1]);
      index += 1;
    } else {
      invalid = true;
    }
  } catch {
    invalid = true;
  }
}

if (asOf === null || invalid) {
  process.stderr.write(
    'Usage: node scripts/check-render-determinism.mjs --as-of YYYY-MM-DD [--as-of-instant ISO_UTC_INSTANT]\n',
  );
  process.exitCode = 2;
} else {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-card-determinism-a-'));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-card-determinism-b-'));

  try {
    await renderCards({
      cwd: process.cwd(),
      asOf,
      asOfInstant,
      outputDirectory: path.join(firstRoot, 'cards'),
    });
    await renderCards({
      cwd: process.cwd(),
      asOf,
      asOfInstant,
      outputDirectory: path.join(secondRoot, 'cards'),
    });

    for (const artifactPath of CARD_ARTIFACT_PATHS) {
      const filename = path.posix.basename(artifactPath);
      const first = await readFile(path.join(firstRoot, 'cards', filename));
      const second = await readFile(path.join(secondRoot, 'cards', filename));
      if (!first.equals(second)) {
        throw new Error(`${filename} is not deterministic`);
      }
    }
    process.stdout.write(`Deterministic SVG OK (${CARD_ARTIFACT_PATHS.length} cards, as-of ${asOf})\n`);
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  }
}
