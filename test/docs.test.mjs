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

test('public documentation covers the supported serverless multi-device flow', async () => {
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
    assert.match(document, /App Server/i);
    assert.match(document, /account\/usage\/read/);
    assert.match(document, /AGENT_CARD_CODEX_BIN/);
    assert.match(document, /ChatGPT/);
    assert.match(document, /API[- ]key/i);
    assert.match(document, /profile candidate/i);
    assert.match(document, /Claude Code/i);
    assert.match(document, /raw (?:logs?|prompts?)/i);
    assert.match(document, /session IDs?/i);
    assert.match(document, /(?:same|동일).{0,80}(?:raw )?logs?.{0,100}(?:duplicate|중복)/is);
    assert.match(document, /60 days|60일/i);
    assert.match(document, /delayed|지연/i);
    assert.match(document, /dropped|누락/i);
    assert.match(document, /public repositor(?:y|ies)|공개 저장소/i);
    assert.match(document, /Unknown/);
    assert.match(document, /Partial/);
  }

  assert.match(english, /newest fresh.{0,100}profile candidate/is);
  assert.match(english, /never (?:adds?|sums?).{0,80}(?:profile|local Codex)/is);
  assert.match(english, /falls back.{0,120}all devices.{0,80}local Codex/is);
  assert.match(korean, /가장 최신.{0,100}profile candidate/is);
  assert.match(korean, /(?:절대|결코).{0,80}(?:합산|더하지)/is);
  assert.match(korean, /모든 기기의 로컬 Codex 합계로 자동 fallback/is);
});

test('README files contain the full-width and paired 49 percent GitHub layout', async () => {
  const documents = await Promise.all([read('README.md'), read('README.ko.md')]);
  for (const document of documents) {
    for (const [card, width] of [
      ['overview', '100%'],
      ['trends', '49%'],
      ['activity', '49%'],
    ]) {
      const rawUrl = `https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/${card}.svg`;
      assert.match(
        document,
        new RegExp(`<img width="${width.replace('%', '\\%')}" src="${rawUrl.replaceAll('.', '\\.')}"`),
      );
    }
  }
});

test('scheduler guides use the same sync command and local App Server prerequisites', async () => {
  const windows = await read('docs/setup-windows.md');
  const unix = await read('docs/setup-unix.md');

  assert.match(windows, /Task Scheduler/i);
  assert.match(windows, /npm run sync/);
  assert.match(windows, /Start in|working directory/i);
  assert.match(windows, /codex\.exe/i);
  assert.match(windows, /ChatGPT/);
  assert.match(windows, /AGENT_CARD_CODEX_BIN/);
  assert.match(windows, /device totals|local Codex/i);
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
});

test('security policy provides private reporting and App Server privacy boundaries', async () => {
  const security = await read('SECURITY.md');
  assert.match(security, /private vulnerability reporting/i);
  assert.match(security, /supported/i);
  assert.match(security, /current `main`/i);
  assert.match(security, /coordinated disclosure/i);
  assert.match(security, /raw logs/i);
  assert.match(security, /public.{0,80}aggregate/is);
  assert.match(security, /App Server response bodies/i);
  assert.match(security, /CLI authentication state/i);
  assert.match(security, /AGENT_CARD_CODEX_BIN/);
});

test('legacy bearer environment example is removed', async () => {
  await assert.rejects(
    read('.env.example'),
    (error) => error?.code === 'ENOENT',
  );
});

test('public docs omit the retired bearer and unofficial endpoint guidance', async () => {
  const combined = (await Promise.all(PUBLIC_DOCS.map(read))).join('\n');
  assert.doesNotMatch(combined, /\.ai-agent-playbook|archive\/|archive\\/i);
  assert.doesNotMatch(combined, /Authorization:\s*Bearer\s+\S+/i);
  assert.doesNotMatch(combined, /CODEX_BEARER_TOKEN/i);
  assert.doesNotMatch(combined, /backend-api\/wham\/profiles\/me/i);
  assert.doesNotMatch(combined, /unofficial (?:profile )?endpoint/i);
});

test('README files explain mixed calendar observations without calling them lower bounds', async () => {
  const [english, korean] = await Promise.all([
    read('README.md'),
    read('README.ko.md'),
  ]);

  for (const document of [english, korean]) {
    assert.match(document, /Mixed/);
    assert.match(document, /≈/);
    assert.match(document, /provider calendar date/i);
  }

  assert.match(english, /not a lower bound/i);
  assert.match(english, /comparisons? and streaks?.{0,80}unavailable/is);
  assert.match(english, /provider-reported lifetime.{0,100}(?:exact|unaffected)/is);

  assert.match(korean, /하한이 아닙니다/);
  assert.match(korean, /비교와 연속 활동.{0,80}표시하지 않습니다/is);
  assert.match(korean, /provider가 보고한 lifetime.{0,100}(?:정확|영향받지)/is);
});
