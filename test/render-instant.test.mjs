import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderCards, run as runRenderCommand } from '../src/commands/render.mjs';

const AS_OF = '2026-07-20';
const AS_OF_INSTANT = '2026-07-19T15:27:00.000Z';
const fixtureUrl = new URL('./fixtures/public/multi-device.json', import.meta.url);

function captureStream() {
  const chunks = [];
  return {
    write(value) {
      chunks.push(value);
    },
    text() {
      return chunks.join('');
    },
  };
}

async function prepareSnapshot(cwd) {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  const snapshot = structuredClone(fixture.deviceSnapshots[0]);
  snapshot.timezone = 'Asia/Seoul';
  snapshot.generatedAt = '2026-07-16T16:00:00.000Z';
  await mkdir(path.join(cwd, 'data', 'devices'), { recursive: true });
  await writeFile(
    path.join(cwd, 'data', 'devices', `${snapshot.deviceId}.json`),
    `${JSON.stringify(snapshot)}\n`,
    'utf8',
  );
}

test('explicit as-of instant controls freshness while the date controls statistics', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-instant-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await prepareSnapshot(cwd);

  await renderCards({ cwd, asOf: AS_OF, asOfInstant: AS_OF_INSTANT });
  const explicit = await readFile(path.join(cwd, 'cards', 'overview.svg'), 'utf8');
  assert.match(explicit, /As of 2026-07-20 · Asia\/Seoul/);
  assert.doesNotMatch(explicit, /stale source/);

  await renderCards({ cwd, asOf: AS_OF });
  const implicit = await readFile(path.join(cwd, 'cards', 'overview.svg'), 'utf8');
  assert.match(implicit, /1 stale source/);
});

test('explicit instant must be canonical UTC and belong to the configured timezone date', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-instant-invalid-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await prepareSnapshot(cwd);

  await assert.rejects(
    () => renderCards({
      cwd,
      asOf: AS_OF,
      asOfInstant: '2026-07-19T14:59:59.999Z',
    }),
    (error) => error?.code === 'AS_OF_INSTANT_DATE_MISMATCH',
  );
  await assert.rejects(
    () => renderCards({
      cwd,
      asOf: AS_OF,
      asOfInstant: '2026-07-19T15:27:00+00:00',
    }),
    (error) => error?.code === 'INVALID_AS_OF_INSTANT',
  );
});

test('render CLI and determinism checker accept the same explicit instant', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-instant-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await prepareSnapshot(cwd);
  const stdout = captureStream();
  const stderr = captureStream();

  assert.equal(
    await runRenderCommand(
      ['--as-of', AS_OF, '--as-of-instant', AS_OF_INSTANT],
      { stdout, stderr },
      {
        cwd,
        withRepositoryLockImpl: (_options, operation) => operation(),
      },
    ),
    0,
  );
  assert.equal(stderr.text(), '');

  const deterministic = spawnSync(
    process.execPath,
    [
      path.resolve('scripts/check-render-determinism.mjs'),
      '--as-of',
      AS_OF,
      '--as-of-instant',
      AS_OF_INSTANT,
    ],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(deterministic.status, 0, deterministic.stderr);
  assert.match(deterministic.stdout, /as-of 2026-07-20/);
});
