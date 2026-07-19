import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateRepository } from '../src/commands/validate.mjs';
import { renderCards } from '../src/commands/render.mjs';

const childScript = fileURLToPath(new URL('../scripts/fixtures/render-crash-child.mjs', import.meta.url));
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function waitForMarker(markerPath, child) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (await readFile(markerPath, 'utf8') === 'ready\n') {
        return;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
    if (child.exitCode !== null) {
      throw new Error(`render crash fixture exited early with ${child.exitCode}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('render crash fixture did not reach the publish boundary');
}

test('hard kill leaves ignored staging outside cards so public validation can recover', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-crash-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const markerPath = path.join(cwd, 'crash-ready');
  const child = spawn(
    process.execPath,
    [childScript, cwd, markerPath],
    { cwd, stdio: 'ignore' },
  );
  t.after(() => {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  });

  await waitForMarker(markerPath, child);
  child.kill('SIGKILL');
  await new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
    } else {
      child.once('close', resolve);
    }
  });

  const cardEntries = await readdir(path.join(cwd, 'cards'), { withFileTypes: true });
  assert.equal(cardEntries.some((entry) => entry.isDirectory()), false);

  const stagingEntries = await readdir(path.join(cwd, '.agent-card-tmp'), { withFileTypes: true });
  assert.equal(stagingEntries.some((entry) => entry.isDirectory()), true);
  assert.deepEqual(await validateRepository({ cwd }), {
    deviceSnapshots: 0,
    profileCandidates: 0,
    cards: 0,
  });
});

test('repository ignores the dedicated render staging root', async () => {
  const gitignore = await readFile(path.join(repositoryRoot, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.agent-card-tmp\/$/m);
});

test('render rejects a staging-root symlink or junction before it can write outside the output root', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-link-'));
  const external = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-external-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.after(() => rm(external, { recursive: true, force: true }));

  try {
    await symlink(
      external,
      path.join(cwd, '.agent-card-tmp'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES'].includes(error?.code)) {
      t.skip('This environment does not permit a directory link fixture.');
      return;
    }
    throw error;
  }

  await assert.rejects(
    () => renderCards({ cwd, asOf: '2026-07-20' }),
    (error) => error?.code === 'UNSAFE_STAGING_ROOT',
  );
  assert.deepEqual(await readdir(external), []);
});
