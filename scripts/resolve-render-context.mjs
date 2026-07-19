import process from 'node:process';

import { run } from '../src/commands/render-context.mjs';

process.exitCode = await run(process.argv.slice(2));
