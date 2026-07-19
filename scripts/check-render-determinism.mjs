import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { assertIsoDate } from '../src/domain/calendar.mjs';
import { renderCards } from '../src/commands/render.mjs';

const args = process.argv.slice(2);
let asOf = null;
if (args.length === 2 && args[0] === '--as-of') {
  try {
    asOf = assertIsoDate(args[1]);
  } catch {
    asOf = null;
  }
}

if (asOf === null) {
  process.stderr.write('Usage: node scripts/check-render-determinism.mjs --as-of YYYY-MM-DD\n');
  process.exitCode = 2;
} else {
  const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-card-determinism-a-'));
  const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-card-determinism-b-'));
  const names = ['overview', 'trends', 'activity'];

  try {
    await renderCards({
      cwd: process.cwd(),
      asOf,
      outputDirectory: path.join(firstRoot, 'cards'),
    });
    await renderCards({
      cwd: process.cwd(),
      asOf,
      outputDirectory: path.join(secondRoot, 'cards'),
    });

    for (const name of names) {
      const first = await readFile(path.join(firstRoot, 'cards', `${name}.svg`));
      const second = await readFile(path.join(secondRoot, 'cards', `${name}.svg`));
      if (!first.equals(second)) {
        throw new Error(`${name}.svg is not deterministic`);
      }
    }
    process.stdout.write(`Deterministic SVG OK (${names.length} cards, as-of ${asOf})\n`);
  } finally {
    await Promise.all([
      rm(firstRoot, { recursive: true, force: true }),
      rm(secondRoot, { recursive: true, force: true }),
    ]);
  }
}
