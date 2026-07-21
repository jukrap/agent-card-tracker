import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CCUSAGE_VERSION,
  buildCcusageArgs,
  createCcusageRunner,
  normalizeCcusageDaily,
} from '../src/collectors/ccusage.mjs';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packagePath = join(projectRoot, 'node_modules', 'ccusage', 'package.json');

test('installed ccusage version and empty Codex home satisfy the pinned contract', async (t) => {
  try {
    await access(packagePath);
  } catch {
    t.skip('ccusage dependency is not installed');
    return;
  }

  const installed = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(installed.version, CCUSAGE_VERSION);

  const isolatedRoot = await mkdtemp(join(tmpdir(), 'agent-card-ccusage-'));
  const codexRoot = join(isolatedRoot, 'codex');
  await mkdir(codexRoot, { recursive: true });

  try {
    const runner = createCcusageRunner({
      entryPath: join(dirname(packagePath), 'src', 'cli.js'),
      timeoutMs: 20_000,
    });
    const environment = {
      ...process.env,
      HOME: isolatedRoot,
      USERPROFILE: isolatedRoot,
      CODEX_HOME: codexRoot,
    };

    let stdout;
    try {
      stdout = await runner(buildCcusageArgs('daily', 'UTC'), { env: environment });
    } catch (error) {
      assert.fail(`codex empty-home contract failed: ${error.code ?? 'UNKNOWN'}`);
    }
    const parsed = JSON.parse(stdout);
    assert.deepEqual(Object.keys(parsed).sort(), ['daily', 'totals']);
    assert.deepEqual(normalizeCcusageDaily(parsed, { timezone: 'UTC' }), []);
  } finally {
    await rm(isolatedRoot, { force: true, recursive: true });
  }
});
