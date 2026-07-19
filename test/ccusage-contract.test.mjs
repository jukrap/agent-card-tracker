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

test('설치된 ccusage 버전과 빈 HOME daily JSON 계약을 smoke 검증한다', async (t) => {
  try {
    await access(packagePath);
  } catch {
    t.skip('ccusage 의존성이 아직 설치되지 않아 contract smoke를 건너뜁니다');
    return;
  }

  const installed = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(installed.version, CCUSAGE_VERSION);

  const isolatedHome = await mkdtemp(join(tmpdir(), 'agent-card-ccusage-'));
  const codexHome = join(isolatedHome, 'codex');
  const claudeConfig = join(isolatedHome, 'claude');
  await mkdir(codexHome, { recursive: true });
  await mkdir(join(claudeConfig, 'projects'), { recursive: true });

  try {
    const runner = createCcusageRunner({
      entryPath: join(dirname(packagePath), 'src', 'cli.js'),
      timeoutMs: 20_000,
    });
    const env = {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      CODEX_HOME: codexHome,
      CLAUDE_CONFIG_DIR: claudeConfig,
    };

    for (const agent of ['claude', 'codex']) {
      let stdout;
      try {
        stdout = await runner(buildCcusageArgs(agent, 'daily', 'UTC'), { env });
      } catch (error) {
        assert.fail(`${agent} empty-home contract failed: ${error.code ?? 'UNKNOWN'}`);
      }
      const parsed = JSON.parse(stdout);
      assert.deepEqual(Object.keys(parsed).sort(), ['daily', 'totals']);
      assert.deepEqual(normalizeCcusageDaily(parsed, { timezone: 'UTC' }), []);
    }
  } finally {
    await rm(isolatedHome, { force: true, recursive: true });
  }
});
