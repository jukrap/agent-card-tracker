import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { stableStringify } from '../src/lib/atomic-file.mjs';
import {
  RepositoryValidationError,
  run as runValidate,
  validateRepository,
} from '../src/commands/validate.mjs';

const execFile = promisify(execFileCallback);
const DEVICE_ID = `device-${'01'.repeat(16)}`;
const WRITER_KEY_HASH = 'ab'.repeat(32);

function emptySource() {
  return {
    status: 'unavailable',
    errorCode: 'NO_LOCAL_DATA',
    lastSuccessfulAt: null,
    days: [],
    coverage: { totals: null, sessions: null },
  };
}

function validDeviceSnapshot() {
  return {
    schemaVersion: 2,
    deviceId: DEVICE_ID,
    writerKeyHash: WRITER_KEY_HASH,
    generatedAt: '2026-07-19T00:00:00.000Z',
    timezone: 'Asia/Seoul',
    collectorVersion: '0.1.0',
    sources: { codex: emptySource() },
  };
}

function validProfileCandidate() {
  return {
    schemaVersion: 2,
    kind: 'codex-profile',
    deviceId: DEVICE_ID,
    writerKeyHash: WRITER_KEY_HASH,
    collectedAt: '2026-07-19T00:00:00.000Z',
    dateBasis: 'provider-calendar-date',
    daily: [],
    coverage: {
      startDate: null,
      endDate: null,
      bucketCount: 0,
    },
  };
}

function validSvg(body = '<text x="12" y="24">No usage yet</text>') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 200" role="img" aria-labelledby="title desc">
  <title id="title">Usage card</title>
  <desc id="desc">Daily aggregate usage</desc>
  ${body}
</svg>\n`;
}

async function createTempDirectory(t, prefix = 'agent-card-validate-') {
  const cwd = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

async function writePublicFile(cwd, relativePath, contents) {
  const filePath = path.join(cwd, ...relativePath.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, 'utf8');
}

async function writeJson(cwd, relativePath, value) {
  await writePublicFile(cwd, relativePath, stableStringify(value));
}

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } },
    },
    output() {
      return { stdout, stderr };
    },
  };
}

async function assertRepositoryError(operation, code, relativePath) {
  await assert.rejects(operation, (error) => {
    assert.ok(error instanceof RepositoryValidationError);
    assert.equal(error.code, code);
    assert.equal(error.path, relativePath);
    assert.match(error.message, new RegExp(code));
    assert.match(error.message, new RegExp(relativePath.replaceAll('/', '[/\\\\]')));
    return true;
  });
}

test('정상 빈 저장소를 유효한 공개 상태로 처리한다', async (t) => {
  const cwd = await createTempDirectory(t);

  assert.deepEqual(await validateRepository({ cwd }), {
    deviceSnapshots: 0,
    profileCandidates: 0,
    cards: 0,
  });
});

test('정렬된 device/profile JSON과 정적 SVG를 strict validation한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writeJson(cwd, `data/devices/${DEVICE_ID}.json`, validDeviceSnapshot());
  await writeJson(cwd, `data/profiles/${DEVICE_ID}.json`, validProfileCandidate());
  await writePublicFile(cwd, 'cards/overview.svg', validSvg());

  assert.deepEqual(await validateRepository({ cwd }), {
    deviceSnapshots: 1,
    profileCandidates: 1,
    cards: 1,
  });
});

test('malformed JSON과 schema drift를 안전한 규칙 코드로 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writePublicFile(cwd, 'data/devices/a-broken.json', '{"schemaVersion":1');
  await writeJson(cwd, 'data/devices/z-broken.json', { unexpected: true });

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'JSON_PARSE',
    'data/devices/a-broken.json',
  );

  await rm(path.join(cwd, 'data', 'devices', 'a-broken.json'));
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'DEVICE_SCHEMA',
    'data/devices/z-broken.json',
  );
});

test('duplicate JSON key로 사라진 원문 값도 canonical-byte 계약으로 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  const canonical = stableStringify(validDeviceSnapshot());
  const secret = `Bearer ${'duplicate-secret-'.repeat(3)}`;
  const duplicate = canonical.replace('{', `{"deviceId":"${secret}",`);
  await writePublicFile(cwd, `data/devices/${DEVICE_ID}.json`, duplicate);

  await assert.rejects(() => validateRepository({ cwd }), (error) => {
    assert.ok(error instanceof RepositoryValidationError);
    assert.equal(error.code, 'JSON_CANONICAL');
    assert.equal(error.path, `data/devices/${DEVICE_ID}.json`);
    assert.doesNotMatch(error.message, /duplicate-secret/i);
    return true;
  });
});

test('공개 JSON filename은 내부 anonymous deviceId와 일치해야 한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writeJson(cwd, 'data/devices/personal-laptop.json', validDeviceSnapshot());

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_FILENAME',
    'data/devices/personal-laptop.json',
  );

  await rm(path.join(cwd, 'data'), { recursive: true });
  await writeJson(cwd, 'data/profiles/account-name.json', validProfileCandidate());
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_FILENAME',
    'data/profiles/account-name.json',
  );
});

test('공개 SVG 안의 email, home path, bearer, JWT, API key와 secret 모양을 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  const cases = [
    ['PUBLIC_EMAIL', 'developer@example.com'],
    ['PUBLIC_HOME_PATH', 'C:\\Users\\private-user\\project'],
    ['PUBLIC_HOME_PATH', '/home/private-user/project'],
    ['PUBLIC_BEARER', `Bearer ${'x'.repeat(32)}`],
    ['PUBLIC_JWT', `${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`],
    ['PUBLIC_API_KEY', `api_key=${'k'.repeat(32)}`],
    ['PUBLIC_SECRET', `client_secret=${'s'.repeat(32)}`],
  ];

  for (const [code, value] of cases) {
    await writePublicFile(cwd, 'cards/overview.svg', validSvg(`<text x="12" y="24">${value}</text>`));
    await assertRepositoryError(
      () => validateRepository({ cwd }),
      code,
      'cards/overview.svg',
    );
  }

  await writePublicFile(
    cwd,
    'cards/overview.svg',
    validSvg('<text x="12" y="24">developer&#64;example.com</text>'),
  );
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_EMAIL',
    'cards/overview.svg',
  );

  await writePublicFile(
    cwd,
    'cards/overview.svg',
    validSvg('<text x="12" y="24">developer<tspan>&#64;example.com</tspan></text>'),
  );
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_EMAIL',
    'cards/overview.svg',
  );
});

test('금지된 identity/raw/path/secret 필드명과 control character를 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  const candidate = validDeviceSnapshot();
  candidate.hostname = 'opaque-host';
  await writeJson(cwd, `data/devices/${DEVICE_ID}.json`, candidate);

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_FORBIDDEN_FIELD',
    `data/devices/${DEVICE_ID}.json`,
  );

  await rm(path.join(cwd, 'data'), { recursive: true });
  await writePublicFile(cwd, 'cards/overview.svg', validSvg().replace('Usage card', 'Usage\u0085card'));
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_CONTROL_CHARACTER',
    'cards/overview.svg',
  );
});

test('unsafe SVG는 SVG validator의 안전한 규칙 코드로 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writePublicFile(cwd, 'cards/overview.svg', validSvg('<script>bad</script>'));

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'SVG_ELEMENT',
    'cards/overview.svg',
  );
});

test('ignored 로컬 설정은 허용하지만 index에 staged되면 local-only 규칙으로 거절한다', async (t) => {
  const cwd = await createTempDirectory(t, 'agent-card-validate-git-');
  await execFile('git', ['init', '--quiet'], { cwd });
  await writePublicFile(cwd, '.gitignore', '.agent-card.local.json\n');
  await writePublicFile(cwd, '.agent-card.local.json', '{"writerKey":"local-only"}\n');

  assert.deepEqual(await validateRepository({ cwd }), {
    deviceSnapshots: 0,
    profileCandidates: 0,
    cards: 0,
  });

  await execFile('git', ['add', '-f', '.agent-card.local.json'], { cwd });
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'LOCAL_ONLY_PATH',
    '.agent-card.local.json',
  );
});

test('local-only path는 Windows 대소문자 변형으로 우회할 수 없다', async (t) => {
  const cwd = await createTempDirectory(t);
  for (const localPath of [
    'agents.md',
    '.AI-AGENT-PLAYBOOK/private.md',
    '.AGENT-CARD-TMP/.render-crash/overview.svg',
    '.Agent-Card.Local.Json',
    '.ENV',
    'debug.LOG',
  ]) {
    await assertRepositoryError(
      () => validateRepository({
        cwd,
        listGitEntries: async () => [{ path: localPath, mode: '100644' }],
      }),
      'LOCAL_ONLY_PATH',
      localPath,
    );
  }
});

test('staged public blob과 working tree를 모두 검증한다', async (t) => {
  const cwd = await createTempDirectory(t, 'agent-card-validate-index-');
  await execFile('git', ['init', '--quiet'], { cwd });
  const secret = `Bearer ${'staged-secret-'.repeat(3)}`;
  await writePublicFile(
    cwd,
    'cards/overview.svg',
    validSvg(`<text x="12" y="24">${secret}</text>`),
  );
  await execFile('git', ['add', 'cards/overview.svg'], { cwd });
  await writePublicFile(cwd, 'cards/overview.svg', validSvg());

  await assert.rejects(() => validateRepository({ cwd }), (error) => {
    assert.ok(error instanceof RepositoryValidationError);
    assert.equal(error.code, 'PUBLIC_BEARER');
    assert.equal(error.path, 'cards/overview.svg');
    assert.doesNotMatch(error.message, /staged-secret/i);
    return true;
  });
});

test('ls-files와 cat-file은 profile bearer가 제거된 최소 child env만 받는다', async (t) => {
  const cwd = await createTempDirectory(t, 'agent-card-validate-env-');
  await mkdir(path.join(cwd, '.git'));
  const svg = validSvg();
  await writePublicFile(cwd, 'cards/overview.svg', svg);
  const objectId = 'ab'.repeat(20);
  const observed = [];
  const sourceEnvironment = {
    Path: 'safe-path',
    systemroot: 'C:\\Windows',
    windir: 'C:\\Windows',
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    pathext: '.COM;.EXE;.BAT;.CMD',
    TEMP: 'C:\\safe-temp',
    tmp: 'C:\\safe-tmp',
    HOME: 'C:\\private-home',
    USERPROFILE: 'C:\\Users\\private-user',
    CODEX_BEARER_TOKEN: 'private-upper',
    codex_bearer_token: 'private-lower',
    CoDeX_BeArEr_ToKeN: 'private-mixed',
    ANTHROPIC_API_KEY: 'private-adjacent-secret',
    GIT_DIR: 'C:\\attacker-controlled-git-dir',
  };

  async function execFileImpl(command, args, options) {
    observed.push({ command, args, options });
    const gitCommand = args.find((argument) => ['ls-files', 'cat-file'].includes(argument));
    if (gitCommand === 'ls-files' && args.includes('--stage')) {
      return {
        stdout: `100644 ${objectId} 0\tcards/overview.svg\0`,
        stderr: '',
      };
    }
    if (gitCommand === 'ls-files') {
      return { stdout: 'cards/overview.svg\0', stderr: '' };
    }
    if (gitCommand === 'cat-file' && args.includes('-s')) {
      return { stdout: `${Buffer.byteLength(svg, 'utf8')}\n`, stderr: '' };
    }
    if (gitCommand === 'cat-file' && args.includes('blob')) {
      return { stdout: Buffer.from(svg, 'utf8'), stderr: Buffer.alloc(0) };
    }
    throw new Error('unexpected git command');
  }

  assert.deepEqual(
    await validateRepository({ cwd, env: sourceEnvironment, execFileImpl }),
    { deviceSnapshots: 0, profileCandidates: 0, cards: 1 },
  );
  assert.equal(observed.length, 4);
  for (const call of observed) {
    assert.equal(call.command, 'git');
    assert.deepEqual(
      call.args.slice(0, 2),
      ['-c', `safe.directory=${path.resolve(cwd)}`],
    );
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.env.PATH, 'safe-path');
    assert.equal(call.options.env.SystemRoot, 'C:\\Windows');
    assert.equal(call.options.env.LC_ALL, 'C');
    assert.equal(call.options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(call.options.env.GIT_CONFIG_NOSYSTEM, '1');
    assert.ok(['NUL', '/dev/null'].includes(call.options.env.GIT_CONFIG_GLOBAL));
    assert.equal(
      Object.keys(call.options.env)
        .some((key) => key.toLowerCase() === 'codex_bearer_token'),
      false,
    );
    assert.equal(Object.hasOwn(call.options.env, 'HOME'), false);
    assert.equal(Object.hasOwn(call.options.env, 'USERPROFILE'), false);
    assert.equal(Object.hasOwn(call.options.env, 'ANTHROPIC_API_KEY'), false);
    assert.equal(Object.hasOwn(call.options.env, 'GIT_DIR'), false);
  }
});

test('tracked raw JSONL과 injected path traversal 후보를 fail closed 처리한다', async (t) => {
  const cwd = await createTempDirectory(t, 'agent-card-validate-raw-');
  await execFile('git', ['init', '--quiet'], { cwd });
  await writePublicFile(cwd, 'captures/raw.jsonl', '{"raw":"event"}\n');
  await execFile('git', ['add', 'captures/raw.jsonl'], { cwd });

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'RAW_LOG_PATH',
    'captures/raw.jsonl',
  );

  const plainCwd = await createTempDirectory(t, 'agent-card-validate-path-');
  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: '../outside.json', mode: '100644' }],
    }),
    'PUBLIC_PATH_TRAVERSAL',
    '<unsafe-path>',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'cards/overview.svg', mode: '120000' }],
    }),
    'PUBLIC_SYMLINK',
    'cards/overview.svg',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'cards/overview.svg', mode: '160000' }],
    }),
    'PUBLIC_GIT_MODE',
    'cards/overview.svg',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'cards', mode: '120000' }],
    }),
    'PUBLIC_SYMLINK',
    'cards',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'Cards/overview.svg', mode: '120000' }],
    }),
    'PUBLIC_PATH_CASE',
    'Cards/overview.svg',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'Data/Devices/example.json', mode: '100644' }],
    }),
    'PUBLIC_PATH_CASE',
    'Data/Devices/example.json',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'data/devices', mode: '160000' }],
    }),
    'PUBLIC_GIT_MODE',
    'data/devices',
  );

  await assertRepositoryError(
    () => validateRepository({
      cwd: plainCwd,
      listGitEntries: async () => [{ path: 'cards/overview.svg', mode: '100644', stage: '2' }],
    }),
    'GIT_INDEX_CONFLICT',
    'cards/overview.svg',
  );
});

test('public filename 자체의 secret 모양은 오류에도 echo하지 않는다', async (t) => {
  const cwd = await createTempDirectory(t);
  const secretName = `sk-proj-${'x'.repeat(32)}.svg`;
  await writePublicFile(cwd, `cards/${secretName}`, validSvg());

  await assert.rejects(() => validateRepository({ cwd }), (error) => {
    assert.ok(error instanceof RepositoryValidationError);
    assert.equal(error.code, 'PUBLIC_API_KEY');
    assert.equal(error.path, '<unsafe-path>');
    assert.doesNotMatch(error.message, /sk-proj|x{16}/i);
    return true;
  });

  const caseVariantSecret = `Cards/sk-proj-${'y'.repeat(32)}.svg`;
  await assert.rejects(
    () => validateRepository({
      cwd,
      listGitEntries: async () => [{ path: caseVariantSecret, mode: '100644' }],
    }),
    (error) => {
      assert.ok(error instanceof RepositoryValidationError);
      assert.equal(error.code, 'PUBLIC_API_KEY');
      assert.equal(error.path, '<unsafe-path>');
      assert.doesNotMatch(error.message, /sk-proj|y{16}/i);
      return true;
    },
  );
});

test('public file symlink를 읽기 전에 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writePublicFile(cwd, 'outside.json', `${JSON.stringify(validDeviceSnapshot())}\n`);
  await mkdir(path.join(cwd, 'data', 'devices'), { recursive: true });
  try {
    await symlink(
      path.join(cwd, 'outside.json'),
      path.join(cwd, 'data', 'devices', `${DEVICE_ID}.json`),
      'file',
    );
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('이 Windows 환경에서는 symlink 생성 권한이 없습니다.');
      return;
    }
    throw error;
  }

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_SYMLINK',
    `data/devices/${DEVICE_ID}.json`,
  );
});

test('empty public directory junction도 repository 밖으로 빠져나갈 수 없다', async (t) => {
  const cwd = await createTempDirectory(t);
  const outside = await createTempDirectory(t, 'agent-card-validate-outside-');
  await mkdir(path.join(outside, 'devices'), { recursive: true });
  try {
    await symlink(outside, path.join(cwd, 'data'), 'junction');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('이 Windows 환경에서는 junction 생성 권한이 없습니다.');
      return;
    }
    throw error;
  }

  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_SYMLINK',
    'data/devices',
  );
});

test('oversize public 파일을 parse 전에 거절한다', async (t) => {
  const cwd = await createTempDirectory(t);
  await writePublicFile(cwd, 'data/devices/oversize.json', 'x'.repeat((1024 * 1024) + 1));
  await assertRepositoryError(
    () => validateRepository({ cwd }),
    'PUBLIC_FILE_SIZE',
    'data/devices/oversize.json',
  );
});

test('오류와 CLI 출력은 실제 secret이나 absolute path를 echo하지 않는다', async (t) => {
  const cwd = await createTempDirectory(t);
  const secret = `Bearer ${'do-not-echo-'.repeat(4)}`;
  await writePublicFile(cwd, 'cards/leak.svg', validSvg(`<text x="12" y="24">${secret}</text>`));

  await assert.rejects(() => validateRepository({ cwd }), (error) => {
    assert.equal(error.code, 'PUBLIC_BEARER');
    assert.doesNotMatch(error.message, /do-not-echo|agent-card-validate-/i);
    assert.equal(error.path, 'cards/leak.svg');
    return true;
  });

  const capture = captureIo();
  assert.equal(await runValidate([], capture.io, { cwd }), 1);
  const output = capture.output();
  assert.equal(output.stdout, '');
  assert.match(output.stderr, /Validation failed: PUBLIC_BEARER at cards[/\\]leak\.svg/);
  assert.doesNotMatch(output.stderr, /do-not-echo|agent-card-validate-/i);

  const helpCapture = captureIo();
  assert.equal(await runValidate(['--help'], helpCapture.io, { cwd }), 0);
  assert.match(helpCapture.output().stdout, /Usage: agent-card validate/);

  await assert.rejects(
    () => validateRepository({
      cwd,
      listGitEntries: async () => {
        throw new Error(`git failed with ${secret}`);
      },
    }),
    (error) => {
      assert.ok(error instanceof RepositoryValidationError);
      assert.equal(error.code, 'GIT_INDEX_READ');
      assert.equal(error.path, '<repository>');
      assert.doesNotMatch(error.message, /do-not-echo/i);
      return true;
    },
  );
});
