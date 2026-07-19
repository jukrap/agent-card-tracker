import * as fileSystem from 'node:fs/promises';

import { renderCards } from '../../src/commands/render.mjs';

const [cwd, markerPath] = process.argv.slice(2);

await renderCards({
  cwd,
  asOf: '2026-07-20',
  fileSystem: {
    ...fileSystem,
    async rename() {
      await fileSystem.writeFile(markerPath, 'ready\n', 'utf8');
      await new Promise(() => {});
    },
  },
});

process.exitCode = 1;
