import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'src', 'cli.mjs');

test('help lists every public command', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^codex-renown -/u);
  assert.match(result.stdout, /Compatibility alias: agent-card/u);
  assert.doesNotMatch(result.stdout, /^agent-card -/u);
  for (const command of [
    'setup',
    'collect',
    'profile',
    'render',
    'validate',
    'sync',
    'publish-cards',
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`));
  }
});

test('unknown commands fail with usage status 2', () => {
  const result = spawnSync(process.execPath, [cli, 'not-a-command'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown command: not-a-command/);
  assert.match(result.stderr, /codex-renown --help/);
});
