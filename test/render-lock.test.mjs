import assert from 'node:assert/strict';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { renderCards, run as runRenderCommand } from '../src/commands/render.mjs';

const AS_OF = '2026-07-20';

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

async function assertMissing(target) {
  await assert.rejects(
    () => access(target),
    (error) => error?.code === 'ENOENT',
  );
}

test('standalone render CLI는 겹친 실행을 거부하고 완료 후 공용 lock을 해제한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-lock-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.git'));

  let enterValidation;
  const validationEntered = new Promise((resolve) => {
    enterValidation = resolve;
  });
  let releaseValidation;
  const validationReleased = new Promise((resolve) => {
    releaseValidation = resolve;
  });
  let firstValidation = true;
  const firstIo = { stdout: captureStream(), stderr: captureStream() };
  const firstRun = runRenderCommand(
    ['--as-of', AS_OF],
    firstIo,
    {
      cwd,
      async validateSvg() {
        if (firstValidation) {
          firstValidation = false;
          enterValidation();
          await validationReleased;
        }
      },
    },
  );

  await validationEntered;
  const lockPath = path.join(cwd, '.git', 'agent-card-sync.lock');
  const secondIo = { stdout: captureStream(), stderr: captureStream() };
  assert.equal(
    await runRenderCommand(['--as-of', AS_OF], secondIo, { cwd }),
    1,
  );
  assert.match(secondIo.stderr.text(), /Render failed: SYNC_ALREADY_RUNNING/);

  releaseValidation();
  assert.equal(await firstRun, 0, firstIo.stderr.text());
  await assertMissing(lockPath);

  const thirdIo = { stdout: captureStream(), stderr: captureStream() };
  assert.equal(
    await runRenderCommand(['--as-of', AS_OF], thirdIo, { cwd }),
    0,
    thirdIo.stderr.text(),
  );
  await assertMissing(lockPath);
});

test('stale repository lock은 SYNC_STALE_LOCK으로 fail closed하고 원본을 보존한다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-stale-lock-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.git'));
  const lockPath = path.join(cwd, '.git', 'agent-card-sync.lock');
  const contents = `${JSON.stringify({
    version: 1,
    pid: 12345,
    createdAt: '2026-07-20T00:00:00.000Z',
    token: '00000000-0000-4000-8000-000000000000',
  })}\n`;
  await writeFile(lockPath, contents, 'utf8');

  const io = { stdout: captureStream(), stderr: captureStream() };
  assert.equal(
    await runRenderCommand(
      ['--as-of', AS_OF],
      io,
      {
        cwd,
        repositoryLockOptions: {
          isProcessAlive: () => false,
          now: () => new Date('2026-07-20T01:00:00.000Z'),
          staleAfterMs: 1_000,
        },
      },
    ),
    1,
  );
  assert.match(io.stderr.text(), /Render failed: SYNC_STALE_LOCK/);
  assert.equal(await readFile(lockPath, 'utf8'), contents);
});

test('pure renderCards API는 repository lock과 독립적으로 유지된다', async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'agent-card-render-pure-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(path.join(cwd, '.git'));
  await writeFile(
    path.join(cwd, '.git', 'agent-card-sync.lock'),
    'occupied by an outer publisher\n',
    'utf8',
  );

  const result = await renderCards({ cwd, asOf: AS_OF });

  assert.equal(result.asOf, AS_OF);
  assert.equal(
    await readFile(path.join(cwd, 'cards', 'overview.svg'), 'utf8')
      .then((contents) => contents.includes('<svg')),
    true,
  );
});
