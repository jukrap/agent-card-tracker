#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const COMMANDS = new Map([
  ['setup', './commands/setup.mjs'],
  ['collect', './commands/collect.mjs'],
  ['profile', './commands/profile.mjs'],
  ['render', './commands/render.mjs'],
  ['validate', './commands/validate.mjs'],
  ['sync', './commands/sync.mjs'],
  ['publish-cards', './commands/publish-cards.mjs'],
]);

const HELP = `agent-card - publish private-safe AI usage cards

Usage:
  agent-card <command> [options]

Commands:
  setup          Create ignored local device configuration
  collect        Collect sanitized local Codex usage
  profile        Collect the experimental Codex account profile
  render         Render static SVG cards
  validate       Validate public data and cards
  sync           Publish this device's sanitized snapshots
  publish-cards  Publish rendered cards as a local recovery path

Run agent-card <command> --help for command-specific options.
`;

function write(stream, value) {
  stream.write(value.endsWith('\n') ? value : `${value}\n`);
}

export async function main(
  argv = process.argv.slice(2),
  io = { stdout: process.stdout, stderr: process.stderr },
) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    write(io.stdout, HELP);
    return 0;
  }

  const modulePath = COMMANDS.get(command);
  if (!modulePath) {
    write(io.stderr, `Unknown command: ${command}`);
    write(io.stderr, 'Run agent-card --help for usage.');
    return 2;
  }

  const commandModule = await import(new URL(modulePath, import.meta.url));
  const status = await commandModule.run(args, io);
  return Number.isInteger(status) ? status : 0;
}

const isEntryPoint = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isEntryPoint) {
  try {
    process.exitCode = await main();
  } catch {
    write(process.stderr, 'Command failed: INTERNAL_ERROR');
    process.exitCode = 1;
  }
}
