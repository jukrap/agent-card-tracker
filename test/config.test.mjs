import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LocalConfigError,
  createLocalConfig,
  loadLocalConfig,
  validateLocalConfig,
} from '../src/config.mjs';
import { run as runSetup, setupLocalConfig } from '../src/commands/setup.mjs';

function deterministicRandom(...buffers) {
  let index = 0;
  return (size) => {
    const value = buffers[index];
    index += 1;
    assert.equal(value.length, size);
    return value;
  };
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (value) => { stdout += value; } },
      stderr: { write: (value) => { stderr += value; } },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'agent-card-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('setup identity uses separate random bytes and never derives from hostname', () => {
  const deviceBytes = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const writerBytes = Buffer.from('10'.repeat(32), 'hex');
  const config = createLocalConfig({
    timezone: 'Asia/Seoul',
    randomBytesImpl: deterministicRandom(deviceBytes, writerBytes),
  });

  assert.deepEqual(config, {
    schemaVersion: 1,
    deviceId: 'device-00112233445566778899aabbccddeeff',
    writerKey: '10'.repeat(32),
    timezone: 'Asia/Seoul',
  });
  assert.equal(Object.keys(config).length, 4);
  assert.doesNotMatch(JSON.stringify(config), /hostname|username|computer/i);
  assert.equal(validateLocalConfig(config), config);
});

test('local config requires exact fields, a 128-bit device id, a distinct writer key, and IANA timezone', () => {
  const valid = {
    schemaVersion: 1,
    deviceId: `device-${'ab'.repeat(16)}`,
    writerKey: 'cd'.repeat(32),
    timezone: 'America/New_York',
  };
  assert.equal(validateLocalConfig(valid), valid);

  for (const invalid of [
    { ...valid, deviceId: 'device-office-laptop' },
    { ...valid, writerKey: 'short' },
    { ...valid, writerKey: valid.deviceId.slice('device-'.length) },
    { ...valid, timezone: 'local' },
    { ...valid, timezone: '+09:00' },
    { ...valid, hostname: 'private-workstation' },
  ]) {
    assert.throws(
      () => validateLocalConfig(invalid),
      (error) => error instanceof LocalConfigError,
    );
  }
});

test('setup always refuses to overwrite an existing local config', async (t) => {
  const directory = await temporaryDirectory(t);
  const configPath = path.join(directory, '.agent-card.local.json');
  const firstRandom = deterministicRandom(
    Buffer.alloc(16, 1),
    Buffer.alloc(32, 2),
  );
  const secondRandom = deterministicRandom(
    Buffer.alloc(16, 3),
    Buffer.alloc(32, 4),
  );

  const first = await setupLocalConfig({
    configPath,
    timezone: 'Asia/Seoul',
    randomBytesImpl: firstRandom,
  });
  const originalBytes = await readFile(configPath, 'utf8');

  await assert.rejects(
    setupLocalConfig({
      configPath,
      timezone: 'UTC',
      randomBytesImpl: secondRandom,
    }),
    (error) => error instanceof LocalConfigError && error.code === 'CONFIG_EXISTS',
  );
  assert.equal(await readFile(configPath, 'utf8'), originalBytes);

  await assert.rejects(
    setupLocalConfig({
      configPath,
      timezone: 'UTC',
      force: true,
      randomBytesImpl: secondRandom,
    }),
    (error) => error instanceof LocalConfigError && error.code === 'CONFIG_EXISTS',
  );
  assert.equal(await readFile(configPath, 'utf8'), originalBytes);
  assert.deepEqual(await loadLocalConfig(configPath), first);
});

test('setup help omits force and the CLI rejects the removed flag', async (t) => {
  const directory = await temporaryDirectory(t);
  const helpOutput = captureIo();
  const invalidOutput = captureIo();

  assert.equal(await runSetup(['--help'], helpOutput.io, { cwd: directory }), 0);
  assert.doesNotMatch(helpOutput.stdout(), /--force/);

  assert.equal(
    await runSetup(
      ['--timezone', 'Asia/Seoul', '--force'],
      invalidOutput.io,
      { cwd: directory },
    ),
    2,
  );
  assert.equal(invalidOutput.stdout(), '');
  assert.equal(invalidOutput.stderr(), 'Setup failed: INVALID_ARGUMENT\n');
});

test('loadLocalConfig fails closed without echoing malformed local contents', async (t) => {
  const directory = await temporaryDirectory(t);
  const configPath = path.join(directory, '.agent-card.local.json');
  const privateValue = 'private-writer-value-from-disk';
  await writeFile(configPath, `{ "writerKey": "${privateValue}" }`, 'utf8');

  await assert.rejects(loadLocalConfig(configPath), (error) => {
    assert.ok(error instanceof LocalConfigError);
    assert.equal(String(error).includes(privateValue), false);
    assert.equal('cause' in error, false);
    return true;
  });
});

test('setup command prints only the anonymous device id and safe status text', async (t) => {
  const directory = await temporaryDirectory(t);
  const output = captureIo();
  const writerBytes = Buffer.from('feed'.repeat(16), 'hex');

  const status = await runSetup(
    ['--timezone', 'Asia/Seoul'],
    output.io,
    {
      cwd: directory,
      randomBytesImpl: deterministicRandom(Buffer.alloc(16, 7), writerBytes),
    },
  );

  assert.equal(status, 0);
  assert.match(output.stdout(), /device-07070707070707070707070707070707/);
  assert.doesNotMatch(output.stdout(), /feed|writer|agent-card\.local|Asia\/Seoul/i);
  assert.equal(output.stderr(), '');
});
