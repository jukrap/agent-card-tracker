import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PUBLIC_DOCS = Object.freeze([
  'README.md',
  'README.ko.md',
  'SECURITY.md',
  'docs/setup-windows.md',
  'docs/setup-unix.md',
]);

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('public documentation covers the Codex-only serverless flow', async () => {
  const [english, korean] = await Promise.all([
    read('README.md'),
    read('README.ko.md'),
  ]);

  for (const document of [english, korean]) {
    for (const command of [
      'npm ci',
      'npm run setup -- --timezone',
      'npm run sync',
      'npm run profile',
      'npm run publish-cards',
    ]) {
      assert.match(document, new RegExp(command.replaceAll(' ', '\\s+')));
    }

    assert.match(document, /Node(?:\.js)? 24/i);
    assert.match(document, /ccusage codex/i);
    assert.match(document, /App Server/i);
    assert.match(document, /account\/usage\/read/);
    assert.match(document, /AGENT_CARD_CODEX_BIN/);
    assert.match(document, /account profile updated/i);
    assert.match(document, /device fallback/i);
    assert.match(document, /ChatGPT/);
    assert.match(document, /API[- ]key/i);
    assert.match(document, /profile candidate/i);
    assert.match(document, /schema (?:version )?2/i);
    assert.match(document, /Rank XV/i);
    assert.match(document, /Mythic/i);
    assert.match(document, /Ascendant/i);
    assert.match(document, /raw (?:logs?|prompts?)/i);
    assert.match(document, /session IDs?/i);
    assert.match(document, /60 days|60일/i);
    assert.match(document, /delayed|지연/i);
    assert.match(document, /dropped|누락/i);
    assert.match(document, /public|공개/i);
    assert.match(document, /Unknown/);
    assert.match(document, /Partial/);
    assert.doesNotMatch(document, /Claude Code/i);
    assert.doesNotMatch(document, /Mixed|≈/);
  }

  assert.match(english, /newest.{0,20}valid account profile candidate.{0,80}within 48 hours/is);
  assert.match(english, /never adds account profile totals to local totals/is);
  assert.match(english, /falls back to all devices' local Codex totals/is);
  assert.match(korean, /48시간 안에 수집된 가장 최신.{0,80}account profile candidate/is);
  assert.match(korean, /절대 더하지 않으며/is);
  assert.match(korean, /모든 기기의 로컬 Codex 합계로 자동 fallback/is);
});

test('README files contain the six-card GitHub layout and compact alternative', async () => {
  const documents = await Promise.all([read('README.md'), read('README.ko.md')]);
  for (const document of documents) {
    for (const [card, width] of [
      ['overview', '100%'],
      ['achievements', '49%'],
      ['records', '49%'],
      ['trends', '49%'],
      ['activity', '49%'],
      ['compact', '416'],
    ]) {
      const rawUrl = `https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/${card}.svg`;
      assert.match(
        document,
        new RegExp(`<img width="${width.replace('%', '\\%')}" src="${rawUrl.replaceAll('.', '\\.')}`),
      );
    }
  }
});

test('scheduler guides use sync and document local App Server prerequisites', async () => {
  const windows = await read('docs/setup-windows.md');
  const unix = await read('docs/setup-unix.md');

  assert.match(windows, /Task Scheduler/i);
  assert.match(windows, /npm run sync/);
  assert.match(windows, /Start in|working directory/i);
  assert.match(windows, /codex\.exe/i);
  assert.match(windows, /ChatGPT/);
  assert.match(windows, /AGENT_CARD_CODEX_BIN/);
  assert.match(windows, /account profile updated/i);
  assert.match(windows, /device fallback/i);
  assert.match(windows, /local Codex|Codex aggregates/i);
  assert.match(windows, /secret|credential|authentication/i);

  assert.match(unix, /launchd/);
  assert.match(unix, /cron/);
  assert.ok((unix.match(/npm run sync/g) ?? []).length >= 2);
  assert.match(unix, /WorkingDirectory|working directory/i);
  assert.match(unix, /EnvironmentVariables|environment/i);
  assert.match(unix, /Codex CLI/i);
  assert.match(unix, /ChatGPT/);
  assert.match(unix, /AGENT_CARD_CODEX_BIN/);
  assert.match(unix, /local Codex fallback/i);
  assert.match(unix, /secret|credential|authentication/i);
  assert.doesNotMatch(windows + unix, /Claude Code|CLAUDE_CONFIG_DIR/i);
});

test('security policy documents schema v2 and App Server privacy boundaries', async () => {
  const security = await read('SECURITY.md');
  assert.match(security, /private vulnerability reporting/i);
  assert.match(security, /supported/i);
  assert.match(security, /current `main`/i);
  assert.match(security, /coordinated disclosure/i);
  assert.match(security, /schema-version 2/i);
  assert.match(security, /raw logs/i);
  assert.match(security, /public.{0,80}aggregate/is);
  assert.match(security, /App Server response bodies/i);
  assert.match(security, /CLI authentication state/i);
  assert.match(security, /AGENT_CARD_CODEX_BIN/);
});

test('legacy bearer environment and unofficial endpoint guidance are absent', async () => {
  await assert.rejects(
    read('.env.example'),
    (error) => error?.code === 'ENOENT',
  );

  const combined = (await Promise.all(PUBLIC_DOCS.map(read))).join('\n');
  assert.doesNotMatch(combined, /\.ai-agent-playbook|archive\/|archive\\/i);
  assert.doesNotMatch(combined, /Authorization:\s*Bearer\s+\S+/i);
  assert.doesNotMatch(combined, /CODEX_BEARER_TOKEN/i);
  assert.doesNotMatch(combined, /backend-api\/wham\/profiles\/me/i);
  assert.doesNotMatch(combined, /unofficial (?:profile )?endpoint/i);
});

test('README files explain one calendar basis and lower-bound fallback', async () => {
  const [english, korean] = await Promise.all([
    read('README.md'),
    read('README.ko.md'),
  ]);

  for (const document of [english, korean]) {
    assert.match(document, /Codex account calendar/);
    assert.match(document, /IANA timezone/i);
    assert.match(document, /At least Rank/);
    assert.match(document, /≥/);
    assert.match(document, /records?/i);
  }

  assert.match(english, /two date systems are never added together/i);
  assert.match(korean, /서로 다른 날짜 체계를 더하지 않습니다/);
});
