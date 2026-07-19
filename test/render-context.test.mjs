import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resolver = path.join(root, 'scripts', 'resolve-render-context.mjs');
const fixtureUrl = new URL('./fixtures/public/multi-device.json', import.meta.url);

async function writeSnapshots(cwd, snapshots) {
  const directory = path.join(cwd, 'data', 'devices');
  await mkdir(directory, { recursive: true });
  for (const snapshot of snapshots) {
    await writeFile(
      path.join(directory, `${snapshot.deviceId}.json`),
      `${JSON.stringify(snapshot)}\n`,
      'utf8',
    );
  }
}

async function fixtureSnapshots(timezone = 'Asia/Seoul') {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  return fixture.deviceSnapshots.map((snapshot) => ({ ...snapshot, timezone }));
}

test('workflow resolver derives the date from one explicit instant and the shared IANA timezone', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-context-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeSnapshots(cwd, await fixtureSnapshots());

  const result = spawnSync(
    process.execPath,
    [resolver, '--instant', '2026-07-19T15:27:00.000Z'],
    { cwd, encoding: 'utf8' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(
    result.stdout,
    'CARD_AS_OF=2026-07-20\nCARD_AS_OF_INSTANT=2026-07-19T15:27:00.000Z\n',
  );
});

test('workflow resolver fails closed when no device snapshot establishes a timezone', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-context-empty-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [resolver, '--instant', '2026-07-19T15:27:00.000Z'],
    { cwd, encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /NO_DEVICE_SNAPSHOTS/);
  assert.doesNotMatch(result.stderr, new RegExp(cwd.replaceAll('\\', '\\\\')));
});

test('workflow resolver rejects timezone disagreement and non-canonical UTC instants', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-context-invalid-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const snapshots = await fixtureSnapshots();
  snapshots[1].timezone = 'UTC';
  await writeSnapshots(cwd, snapshots);

  const mismatch = spawnSync(
    process.execPath,
    [resolver, '--instant', '2026-07-19T15:27:00.000Z'],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /TIMEZONE_MISMATCH/);

  const invalidInstant = spawnSync(
    process.execPath,
    [resolver, '--instant', '2026-07-19T15:27:00+00:00'],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(invalidInstant.status, 1);
  assert.match(invalidInstant.stderr, /INVALID_INSTANT/);
});
