import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { stableStringify, writeJsonAtomic } from '../src/lib/atomic-file.mjs';

test('stableStringify sorts object keys recursively and ends with one LF', () => {
  const value = {
    z: 1,
    a: { d: 4, c: 3 },
    list: [{ y: 2, x: 1 }],
  };

  assert.equal(
    stableStringify(value),
    '{\n' +
      '  "a": {\n' +
      '    "c": 3,\n' +
      '    "d": 4\n' +
      '  },\n' +
      '  "list": [\n' +
      '    {\n' +
      '      "x": 1,\n' +
      '      "y": 2\n' +
      '    }\n' +
      '  ],\n' +
      '  "z": 1\n' +
      '}\n',
  );
});

test('stableStringify rejects values JSON would silently corrupt or omit', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1n, undefined]) {
    assert.throws(() => stableStringify({ value }), /stable JSON/i);
  }

  assert.throws(() => stableStringify({ value: () => {} }), /stable JSON/i);
  assert.throws(() => stableStringify(new Date()), /plain objects/i);

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic), /cyclic/i);
});

test('writeJsonAtomic creates a parent directory and replaces with stable JSON', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-card-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'nested', 'snapshot.json');

  await writeJsonAtomic(target, { z: 1, a: 2 });
  assert.equal(await fs.readFile(target, 'utf8'), '{\n  "a": 2,\n  "z": 1\n}\n');

  await writeJsonAtomic(target, { replacement: true });
  assert.equal(await fs.readFile(target, 'utf8'), '{\n  "replacement": true\n}\n');

  const directoryEntries = await fs.readdir(path.dirname(target));
  assert.deepEqual(directoryEntries, ['snapshot.json']);
});

test('writeJsonAtomic validates before touching the destination', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-card-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'snapshot.json');
  await fs.writeFile(target, 'previous\n', 'utf8');

  await assert.rejects(
    writeJsonAtomic(target, { unsafe: true }, {
      validate() {
        throw new Error('invalid public snapshot');
      },
    }),
    /invalid public snapshot/,
  );

  assert.equal(await fs.readFile(target, 'utf8'), 'previous\n');
  assert.deepEqual(await fs.readdir(directory), ['snapshot.json']);
});

test('writeJsonAtomic uses a same-directory temp and preserves the old file on rename failure', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-card-atomic-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'snapshot.json');
  await fs.writeFile(target, 'previous\n', 'utf8');

  let tempPath;
  const fileSystem = {
    mkdir: fs.mkdir,
    async writeFile(filePath, contents, options) {
      tempPath = filePath;
      return fs.writeFile(filePath, contents, options);
    },
    async rename(from, to) {
      assert.equal(from, tempPath);
      assert.equal(to, target);
      assert.equal(path.dirname(from), path.dirname(to));
      throw Object.assign(new Error('simulated rename failure'), { code: 'EACCES' });
    },
    unlink: fs.unlink,
  };

  await assert.rejects(
    writeJsonAtomic(target, { replacement: true }, { fileSystem }),
    /simulated rename failure/,
  );

  assert.equal(await fs.readFile(target, 'utf8'), 'previous\n');
  assert.equal(tempPath.startsWith(`${directory}${path.sep}.snapshot.json.`), true);
  await assert.rejects(fs.access(tempPath), { code: 'ENOENT' });
});
