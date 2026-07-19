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
      'npm run publish-cards',
    ]) {
      assert.match(document, new RegExp(command.replaceAll(' ', '\\s+')));
    }

    assert.match(document, /Node(?:\.js)? 24/i);
    assert.match(document, /CODEX_BEARER_TOKEN/);
    assert.match(document, /https:\/\/chatgpt\.com\/backend-api\/wham\/profiles\/me/);
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
  assert.match(korean, /가장 최신.{0,100}profile candidate/is);
  assert.match(korean, /(?:절대|결코).{0,80}(?:합산|더하지)/is);
});

test('README files contain exact raw GitHub card URLs for profile embedding', async () => {
  const documents = (await Promise.all([read('README.md'), read('README.ko.md')])).join('\n');
  for (const card of ['overview', 'trends', 'activity']) {
    const rawUrl = `https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/${card}.svg`;
    assert.match(documents, new RegExp(`!\\[[^\\]]+\\]\\(${rawUrl.replaceAll('.', '\\.') }\\)`));
  }
});

test('scheduler guides call the same sync command with execution context and secret guidance', async () => {
  const windows = await read('docs/setup-windows.md');
  const unix = await read('docs/setup-unix.md');

  assert.match(windows, /Task Scheduler/i);
  assert.match(windows, /npm run sync/);
  assert.match(windows, /Start in|working directory/i);
  assert.match(windows, /environment|환경/i);
  assert.match(windows, /secret|credential|token/i);

  assert.match(unix, /launchd/);
  assert.match(unix, /cron/);
  assert.ok((unix.match(/npm run sync/g) ?? []).length >= 2);
  assert.match(unix, /WorkingDirectory|working directory/i);
  assert.match(unix, /EnvironmentVariables|environment/i);
  assert.match(unix, /secret|credential|token/i);
});

test('security policy provides private reporting, supported scope, and privacy boundaries', async () => {
  const security = await read('SECURITY.md');
  assert.match(security, /private vulnerability reporting/i);
  assert.match(security, /supported/i);
  assert.match(security, /current `main`/i);
  assert.match(security, /coordinated disclosure/i);
  assert.match(security, /raw logs/i);
  assert.match(security, /public.{0,80}aggregate/is);
  assert.match(security, /CODEX_BEARER_TOKEN/);
});

test('.env.example declares only the empty optional profile variable', async () => {
  assert.equal(await read('.env.example'), 'CODEX_BEARER_TOKEN=\n');
});

test('public docs do not expose private working-material names or secret examples', async () => {
  const combined = (await Promise.all(PUBLIC_DOCS.map(read))).join('\n');
  assert.doesNotMatch(combined, /\.ai-agent-playbook|archive\/|archive\\/i);
  assert.doesNotMatch(combined, /Authorization:\s*Bearer\s+\S+/i);
  assert.doesNotMatch(combined, /CODEX_BEARER_TOKEN\s*=\s*\S+/);
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
