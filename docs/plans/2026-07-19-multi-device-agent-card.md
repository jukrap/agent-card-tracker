# Multi-device AI Usage Card Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 여러 컴퓨터의 Codex·Claude Code 사용량을 개인 서버 없이 안전하게 합산하고, GitHub 프로필에 삽입할 수 있는 정적 SVG 카드로 자동 게시한다.

**Architecture:** 각 컴퓨터에서 고정 버전의 ccusage를 실행해 익명 일별 스냅샷을 만들고 Git 저장소로 동기화한다. 집계기는 Codex 계정 프로필 스냅샷이 신선할 때만 이를 우선하고, 그렇지 않으면 기기별 Codex 합계를 사용해 이중 집계를 막는다. GitHub Actions와 동일한 로컬 명령이 공개 JSON을 검증한 뒤 결정론적 SVG 세 장을 생성한다.

**Tech Stack:** Node.js 24+ ESM, npm, ccusage 20.0.17, Node test runner, saxes, GitHub Actions, 정적 SVG

---

## 구현 원칙

- 모든 기능은 실패 테스트를 먼저 추가한 뒤 최소 구현으로 통과시킨다.
- 공개 파일에는 일별 집계값과 익명 기기 ID만 허용한다.
- Codex 프로필과 기기별 Codex 통계는 같은 결과에 절대 더하지 않는다.
- 시간 계산은 설정된 IANA timezone과 월요일 시작 주를 기준으로 한다.
- 렌더링은 `--as-of YYYY-MM-DD`를 받아 동일 입력에 byte-for-byte 같은 결과를 낸다.
- `.ai-agent-playbook/`, `AGENTS.md`, 원본 로그, 인증정보, 로컬 설정은 어떤 커밋에도 포함하지 않는다.

### Task 1: Node 프로젝트와 검증 골격 만들기

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `.gitattributes`
- Create: `src/cli.mjs`
- Create: `scripts/check-syntax.mjs`
- Create: `test/cli.test.mjs`

**Step 1: 실패하는 CLI 도움말 테스트 작성**

`test/cli.test.mjs`에서 `node src/cli.mjs --help`가 종료 코드 0과 `setup`, `collect`, `profile`, `render`, `validate`, `sync`, `publish-cards` 명령을 출력하는지 검증한다.

**Step 2: 테스트를 실행해 실패 확인**

Run: `node --test test/cli.test.mjs`

Expected: `src/cli.mjs`가 없어 `ERR_MODULE_NOT_FOUND`로 실패한다.

**Step 3: 최소 프로젝트 설정과 CLI 라우터 구현**

- `package.json`에 `type: module`, `engines.node: >=24`, `bin`, `test`, `check`, `check:syntax`, `check:determinism`, `setup`, `collect`, `profile`, `render`, `validate`, `sync`, `publish-cards` 스크립트를 둔다.
- `ccusage`는 정확히 `20.0.17`, `saxes`는 정확히 `6.0.0`으로 잠근다.
- CLI는 알 수 없는 명령을 종료 코드 2로 거절하고 도움말을 제공한다.
- `.gitattributes`에서 MJS/JSON/YML/MD/SVG를 LF로 고정해 Windows와 Ubuntu의 결정론을 맞춘다.
- MIT 라이선스와 직접 포함·실행하는 오픈소스 고지를 작성한다.

**Step 4: 의존성과 테스트 검증**

Run: `npm install --save-exact ccusage@20.0.17`

Run: `npm install --save-dev --save-exact saxes@6.0.0`

Run: `npm test`

Expected: lockfile이 생성되고 CLI 테스트가 통과한다.

**Step 5: 커밋**

```bash
git add package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md .gitattributes src/cli.mjs scripts/check-syntax.mjs test/cli.test.mjs
git commit -m "build: 사용량 카드 CLI 기반 구성"
```

### Task 2: 공개 스냅샷 스키마와 안전한 JSON 입출력 구현

**Files:**
- Create: `src/domain/schema.mjs`
- Create: `src/lib/atomic-file.mjs`
- Create: `test/schema.test.mjs`
- Create: `test/atomic-file.test.mjs`

**Step 1: 실패하는 스키마 테스트 작성**

다음 계약을 테스트한다.

- device snapshot: `schemaVersion`, opaque `deviceId`, public `writerKeyHash`, `generatedAt`, `timezone`, `collectorVersion`, `sources`
- source record: `status`, 선택적 `errorCode`, `lastSuccessfulAt`, `days`
- day record: `date`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`, `sessions`
- profile candidate: `schemaVersion`, `kind`, `deviceId`, `writerKeyHash`, `collectedAt`, `dateBasis`, `daily`, 선택적 `lifetimeTotalTokens`, `coverage`
- 음수·무한대·소수 token, 잘못된 날짜/timezone, schema mismatch를 거절한다.
- hostname, username, path, project, model, prompt, response, session ID, email, token/secret-shaped 문자열과 모든 unknown field를 공개 JSON 어디서든 거절한다.

**Step 2: 실패 확인**

Run: `node --test test/schema.test.mjs test/atomic-file.test.mjs`

Expected: 대상 모듈이 없어 실패한다.

**Step 3: validator와 atomic writer 구현**

- upstream 응답은 exact allowlist serializer로 필요한 값만 뽑고, 이미 공개 snapshot이 된 뒤에는 unknown field까지 fail closed로 처리한다.
- JSON은 key 순서를 고정하고 마지막 newline을 포함한다.
- 같은 디렉터리의 임시 파일에 쓴 뒤 rename하여 기존 유효 파일이 부분 파일로 바뀌지 않게 한다.

**Step 4: 경계 테스트 통과 확인**

Run: `node --test test/schema.test.mjs test/atomic-file.test.mjs`

Expected: 모든 스키마·원자적 쓰기 테스트 통과.

**Step 5: 커밋**

```bash
git add src/domain/schema.mjs src/lib/atomic-file.mjs test/schema.test.mjs test/atomic-file.test.mjs
git commit -m "feat(data): 공개 사용량 스냅샷 계약 추가"
```

### Task 3: ccusage Claude/Codex 일별 결과 정규화 구현

**Files:**
- Create: `src/collectors/ccusage.mjs`
- Create: `test/ccusage.test.mjs`
- Create: `test/ccusage-contract.test.mjs`
- Create: `test/fixtures/ccusage/claude-daily.json`
- Create: `test/fixtures/ccusage/codex-daily.json`
- Create: `test/fixtures/ccusage/empty-daily.json`

**Step 1: 실패하는 fixture 기반 테스트 작성**

- `claude daily --json`과 `codex daily --json`의 현재 `{ daily, totals }` 계약에서 `daily[]`를 공통 day record로 바꾼다.
- `cacheCreationTokens`를 `cacheWriteTokens`로 매핑한다.
- 모델명과 비용은 버린다.
- 일별 출력에는 session count가 없으므로 별도 무필터 `session --json` 결과의 각 session을 `lastActivity`가 속한 설정 timezone 날짜에 한 번만 세고 session ID/path 원문은 즉시 버린다. 수집하지 못하면 `sessions: null`로 두어 관측된 0과 구분한다.
- card의 session 표기는 양쪽 모두 '마지막 활동일 기준 unique session 수'라고 정의한다.
- 중복 날짜, 비정상 JSON, 명령 실패를 안전하게 거절한다. 공개 구성요소에 나타나지 않는 token이 있을 수 있으므로 ccusage의 `totalTokens`는 재계산하지 않는다.

**Step 2: 실패 확인**

Run: `node --test test/ccusage.test.mjs`

Expected: collector 모듈이 없어 실패한다.

**Step 3: 순수 normalizer와 주입 가능한 runner 구현**

- 로컬 설치된 ccusage 진입 파일을 `process.execPath`로 실행해 Windows `.cmd` 의존성을 피한다.
- timezone을 먼저 엄격한 IANA 값으로 검증한 뒤 명령을 각각 `claude daily --json --offline --no-cost --timezone <zone>`, `codex daily --json --offline --no-cost --timezone <zone> --speed auto`로 제한한다.
- session count를 켠 경우 같은 안전 옵션으로 `claude session`과 `codex session`을 호출하고, 원본 stdout을 디스크에 쓰지 않는다.
- stderr 원문이나 원본 로그 경로를 공개 오류에 넣지 않고 정해진 error code만 반환한다.
- 최대 출력 크기와 실행 timeout을 둔다.
- 설치된 pinned binary를 빈 격리 HOME/CODEX_HOME/CLAUDE_CONFIG_DIR에서 실행하는 contract smoke test로 top-level `{ daily, totals }`와 package version drift를 fail closed 검증한다.

**Step 4: 정규화·실패 테스트 통과 확인**

Run: `node --test test/ccusage.test.mjs test/ccusage-contract.test.mjs`

Expected: Claude/Codex/empty/error fixture 테스트 통과.

**Step 5: 커밋**

```bash
git add src/collectors/ccusage.mjs test/ccusage.test.mjs test/ccusage-contract.test.mjs test/fixtures/ccusage
git commit -m "feat(collect): ccusage 일별 통계 정규화 추가"
```

### Task 4: 익명 기기 설정과 로컬 수집 명령 구현

**Files:**
- Create: `.agent-card.local.example.json`
- Create: `src/config.mjs`
- Create: `src/commands/setup.mjs`
- Create: `src/commands/collect.mjs`
- Modify: `src/cli.mjs`
- Create: `test/config.test.mjs`
- Create: `test/collect-command.test.mjs`

**Step 1: 실패하는 setup/collect 테스트 작성**

- setup은 hostname과 무관한 `device-` 접두사의 128-bit random ID, 별도 random writer key, IANA timezone을 `.agent-card.local.json`에 만든다.
- 이미 있는 설정은 항상 덮어쓰지 않는다. 새 identity가 기존 공개 snapshot과 같은 로컬 이력을 중복 집계할 수 있으므로 강제 overwrite 경로를 제공하지 않는다.
- collect는 공개 snapshot의 `writerKeyHash`가 로컬 writer key와 일치할 때만 `data/devices/<deviceId>.json` 하나를 덮어쓴다.
- 한 source가 실패하면 해당 source의 직전 유효 days를 보존하고 sanitized `errorCode`와 상태만 갱신한다.
- 두 source 모두 처음부터 실패해도 유효한 빈 스냅샷을 만든다.

**Step 2: 실패 확인**

Run: `node --test test/config.test.mjs test/collect-command.test.mjs`

Expected: command/config 모듈이 없어 실패한다.

**Step 3: setup과 collect 구현**

- filesystem, clock, random bytes, ccusage runner를 주입 가능하게 만들어 실제 홈 디렉터리 없이 테스트한다.
- 콘솔에는 기기 ID, 날짜 수, source status만 출력하고 raw output은 출력하지 않는다.
- snapshot 생성 직전에 Task 2 validator를 적용한다.
- local config 전체를 다른 컴퓨터에 복사한 경우는 구분할 수 없으므로 unsupported로 안내한다.

**Step 4: 테스트와 도움말 회귀 확인**

Run: `node --test test/config.test.mjs test/collect-command.test.mjs test/cli.test.mjs`

Expected: 모든 테스트 통과.

**Step 5: 커밋**

```bash
git add .agent-card.local.example.json src/config.mjs src/commands/setup.mjs src/commands/collect.mjs src/cli.mjs test/config.test.mjs test/collect-command.test.mjs
git commit -m "feat(collect): 익명 기기별 수집 명령 추가"
```

### Task 5: 실험적 Codex 계정 프로필 어댑터 구현

**Files:**
- Create: `src/collectors/codex-profile.mjs`
- Create: `src/commands/profile.mjs`
- Modify: `src/cli.mjs`
- Create: `test/codex-profile.test.mjs`
- Create: `test/fixtures/profile/success.json`
- Create: `test/fixtures/profile/partial.json`

**Step 1: 실패하는 profile adapter 테스트 작성**

- bearer는 매개변수 또는 `CODEX_BEARER_TOKEN` 환경변수에서만 읽는다.
- endpoint는 `https://chatgpt.com/backend-api/wham/profiles/me`로 고정하고 redirect를 거절한다. 테스트만 injected fetch를 사용한다.
- `stats.daily_usage_buckets[].start_date/tokens`, `stats.lifetime_tokens`만 sanitizer가 읽는다.
- timeout, 401/403, HTML 응답, schema drift, 음수 값을 정해진 error code로 변환한다.
- token, Authorization header, response body, Error cause는 오류와 로그에 포함하지 않는다.
- JSON content type과 1 MiB 이하 응답 크기를 요구한다.
- 성공할 때만 `data/profiles/<deviceId>.json`을 원자적으로 교체한다.

**Step 2: 실패 확인**

Run: `node --test test/codex-profile.test.mjs`

Expected: profile collector가 없어 실패한다.

**Step 3: opt-in profile 명령 구현**

- injected `fetch`와 `AbortSignal.timeout`을 사용하되, production host/path는 주입하거나 설정할 수 없게 한다.
- endpoint가 비공식·변경 가능하다는 경고를 도움말에 표시한다.
- 실패 시 기존 profile snapshot은 유지하고 명령은 비영 종료한다.
- `daily_usage_buckets`의 날짜 중복·비정렬·부분 오류를 통째로 거절하고, total-only인 Codex profile의 token breakdown/session은 unknown으로 유지한다.

**Step 4: 보안·schema drift 테스트 통과 확인**

Run: `node --test test/codex-profile.test.mjs test/cli.test.mjs`

Expected: 정상/부분/인증 실패/timeout/schema drift 테스트 통과.

**Step 5: 커밋**

```bash
git add src/collectors/codex-profile.mjs src/commands/profile.mjs src/cli.mjs test/codex-profile.test.mjs test/fixtures/profile
git commit -m "feat(codex): 계정 프로필 통계 어댑터 추가"
```

### Task 6: 다중 기기 병합과 Codex 단일 source 선택 구현

**Files:**
- Create: `src/domain/merge.mjs`
- Create: `test/merge.test.mjs`

**Step 1: 실패하는 병합 테스트 작성**

- Claude는 모든 유효 device snapshot의 일별 값을 합친다.
- `data/profiles/`의 후보 중 newest valid profile이 freshness window 안이면 그 profile 하나만 쓰고 local Codex를 무시한다.
- profile 후보가 없거나 모두 stale/malformed이면 모든 device Codex를 합친다.
- 동일 device ID 파일 두 개, snapshot 내부 중복 날짜, 서로 다른 timezone을 거절한다.
- stale device는 과거 합계에는 남기고 diagnostics에만 표시한다.
- profile 후보는 절대 합산하지 않으며 동일 수집 시각 후보의 결정론적 tie-break를 정의한다.
- 선택 결과에 `codexSource: profile|devices`, coverage, selected profile age, stale device count를 포함한다.

**Step 2: 실패 확인**

Run: `node --test test/merge.test.mjs`

Expected: merge 모듈이 없어 실패한다.

**Step 3: 결정론적 병합 구현**

- 입력 경로와 배열 순서에 상관없이 날짜와 device ID를 정렬한다.
- integer overflow를 검사한다.
- source별 token mix와 sessions의 unknown 상태를 보존하고, profile 사용 시 Codex breakdown이 없다는 사실을 Claude-only mix로 오해하지 않게 partial coverage를 표시한다.

**Step 4: 이중 집계 방지 테스트 통과 확인**

Run: `node --test test/merge.test.mjs`

Expected: profile 우선·fallback·multi-device·stale 테스트 통과.

**Step 5: 커밋**

```bash
git add src/domain/merge.mjs test/merge.test.mjs
git commit -m "feat(data): 다중 기기 병합과 Codex source 선택 추가"
```

### Task 7: 기간·추세·활동 통계 구현

**Files:**
- Create: `src/domain/calendar.mjs`
- Create: `src/domain/statistics.mjs`
- Create: `test/calendar.test.mjs`
- Create: `test/statistics.test.mjs`

**Step 1: 실패하는 시간 경계 테스트 작성**

- 지정 timezone의 today와 전일
- rolling 7/30일과 바로 앞 비교 구간
- month-to-date와 이전 달의 같은 경과 일수
- 월요일 시작 주, 연말/연초, 윤일, DST가 있는 timezone
- 누락 날짜 zero-fill과 관측 범위 밖 unknown 구분

**Step 2: 실패하는 통계 테스트 작성**

- lifetime, active days, current/longest streak, peak day
- Codex/Claude share와 input/output/cache mix
- daily 30개, weekly 12개, monthly 12개 추세 bucket
- 53주 heatmap과 displayed non-zero values의 quantile level
- 비교 분모가 0일 때 `new`, 둘 다 0일 때 `flat`, 그 외 percentage

**Step 3: 실패 확인**

Run: `node --test test/calendar.test.mjs test/statistics.test.mjs`

Expected: calendar/statistics 모듈이 없어 실패한다.

**Step 4: 순수 함수로 구현**

- 호스트 locale에 의존하지 않고 `Intl.DateTimeFormat`의 지정 timezone만 사용한다.
- 표시 rounding과 원본 integer 집계를 분리한다.
- 모든 출력 배열을 oldest-to-newest로 고정한다.

**Step 5: 경계 테스트 통과 확인**

Run: `node --test test/calendar.test.mjs test/statistics.test.mjs`

Expected: 기간·윤일·DST·streak·quantile 테스트 통과.

**Step 6: 커밋**

```bash
git add src/domain/calendar.mjs src/domain/statistics.mjs test/calendar.test.mjs test/statistics.test.mjs
git commit -m "feat(stats): 기간별 추세와 활동 통계 추가"
```

### Task 8: 접근 가능한 정적 SVG 카드 렌더러 구현

**Files:**
- Create: `src/render/svg.mjs`
- Create: `src/render/overview.mjs`
- Create: `src/render/trends.mjs`
- Create: `src/render/activity.mjs`
- Create: `src/commands/render.mjs`
- Create: `scripts/check-render-determinism.mjs`
- Modify: `src/cli.mjs`
- Create: `test/render.test.mjs`
- Create: `test/fixtures/public/multi-device.json`

**Step 1: 실패하는 renderer 테스트 작성**

- overview/trends/activity 세 SVG가 생성된다.
- XML parser로 유효하며 `<title>`, `<desc>`, `role="img"`, `viewBox`를 포함한다.
- script, `foreignObject`, event handler, remote font/image, 외부 URL을 포함하지 않는다.
- 모든 동적 문자열은 XML escape된다.
- light/dark palette를 `prefers-color-scheme`으로 제공한다.
- empty, single source, extreme number에서도 text overflow를 제한한다.
- 같은 `--as-of`, input, timezone은 byte-for-byte 동일하다.

**Step 2: 실패 확인**

Run: `node --test test/render.test.mjs`

Expected: render 모듈이 없어 실패한다.

**Step 3: 세 카드와 원자적 render command 구현**

- `overview.svg`: today/7d/30d/month/lifetime, 비교, source share, token mix
- `trends.svg`: daily/weekly/monthly series와 명확한 scale/empty state
- `activity.svg`: 53주 heatmap, active days, streak, peak
- 세 결과를 임시 디렉터리에 모두 렌더·검증한 뒤에만 `cards/`를 파일 단위로 교체한다.
- timestamp 대신 `as-of`와 공개 데이터의 generation date만 사용한다.
- `check:determinism`은 별도 임시 디렉터리 두 곳에 렌더하고 세 SVG의 byte를 비교한다.

**Step 4: XML·보안·결정론 테스트 통과 확인**

Run: `node --test test/render.test.mjs test/merge.test.mjs test/statistics.test.mjs`

Expected: 모든 렌더 테스트 통과.

**Step 5: 커밋**

```bash
git add src/render src/commands/render.mjs src/cli.mjs scripts/check-render-determinism.mjs test/render.test.mjs test/fixtures/public
git commit -m "feat(card): 기간별 정적 SVG 카드 생성"
```

### Task 9: 공개 산출물 privacy validator 구현

**Files:**
- Create: `src/commands/validate.mjs`
- Modify: `src/cli.mjs`
- Create: `test/validate-command.test.mjs`

**Step 1: 실패하는 repository validation 테스트 작성**

- `data/devices/*.json`과 `data/profiles/*.json`을 schema validate한다.
- `cards/*.svg`를 XML/보안 validate한다.
- email, Windows/Unix home path, bearer/JWT/API-key 모양, 금지 필드명, control character를 탐지한다.
- `.ai-agent-playbook`, `.agent-card.local.json`, raw JSONL이 staged/public 대상에 들어오면 실패한다.
- 정상 빈 저장소와 정상 산출물은 성공한다.

**Step 2: 실패 확인**

Run: `node --test test/validate-command.test.mjs`

Expected: validate command가 없어 실패한다.

**Step 3: validator와 `npm run check` 구현**

- 오류에는 파일의 repository-relative path와 안전한 규칙 이름만 표시한다.
- secret처럼 보이는 실제 match 원문은 출력하지 않는다.
- `npm run check`가 syntax check, test, public validation을 순차 실행하게 한다.

**Step 4: 전체 보안 회귀 확인**

Run: `npm run check`

Expected: 전체 테스트와 공개 산출물 검증 통과.

**Step 5: 커밋**

```bash
git add package.json src/commands/validate.mjs src/cli.mjs test/validate-command.test.mjs
git commit -m "feat(security): 공개 산출물 privacy 검증 추가"
```

### Task 10: 충돌 복구 가능한 Git sync 구현

**Files:**
- Create: `src/git/repository.mjs`
- Create: `src/git/publish.mjs`
- Create: `src/commands/sync.mjs`
- Create: `src/commands/publish-cards.mjs`
- Modify: `src/cli.mjs`
- Create: `test/git-sync.test.mjs`

**Step 1: 실패하는 sync 상태 머신 테스트 작성**

- 전용 clone 여부, repository identity, process lock, clean tracked worktree를 확인한 뒤 시작한다.
- `git fetch` 후 fast-forward 또는 제한적 rebase를 먼저 수행하고, 최신 own-device snapshot을 기준으로 temp에 collect와 선택적 profile을 만든 뒤 strict validate한다.
- 최신 원격 상태에서 writer key hash를 다시 확인하고 자신의 device JSON과 profile candidate(성공 시)만 명시적으로 stage한다. cards는 local sync가 stage하지 않는다.
- diff가 없으면 commit/push하지 않는다.
- non-fast-forward이면 fetch 후 base 이후 자신의 device/profile path가 원격에서 바뀌지 않았을 때만 rebase/data 재검증 후 최대 3회 재시도한다. 자신의 path가 바뀌었으면 device ID/config collision으로 즉시 중단한다.
- 충돌, auth 실패, 다른 push 실패는 로컬 커밋을 보존하고 안전한 복구 안내로 종료한다.
- shell string 결합 없이 argv 배열로 runner를 호출한다.
- `publish-cards`는 local fallback으로 render/validate 후 정확히 세 card path만 stage하고 sync와 같은 bounded push 규칙을 적용한다.

**Step 2: 실패 확인**

Run: `node --test test/git-sync.test.mjs`

Expected: sync 모듈이 없어 실패한다.

**Step 3: 주입 가능한 Git runner와 sync 구현**

- 기본 branch/remote는 현재 upstream에서 읽되 target repository identity와 default branch를 검증한다.
- commit message에는 hostname, device ID 전체, token 값이 들어가지 않는다.
- profile 실패는 local Codex fallback을 허용하지만 validation 실패는 push를 막는다.
- 모든 Git 호출은 shell string이 아닌 argv 배열, timeout, `--` path separator를 사용한다.
- rebase conflict에서는 `git rebase --abort` 후 로컬 commit을 보존하며 force push나 자동 ours/theirs 해결을 하지 않는다.

**Step 4: 충돌·no-op·실패 테스트 통과 확인**

Run: `node --test test/git-sync.test.mjs`

Expected: 모든 sync 상태 테스트 통과.

**Step 5: 커밋**

```bash
git add src/git/repository.mjs src/git/publish.mjs src/commands/sync.mjs src/commands/publish-cards.mjs src/cli.mjs test/git-sync.test.mjs
git commit -m "feat(sync): 다중 기기 Git 동기화 명령 추가"
```

### Task 11: GitHub Actions 무료 검증·렌더 자동화 추가

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/render-cards.yml`
- Create: `.github/dependabot.yml`
- Create: `test/workflows.test.mjs`

**Step 1: 실패하는 workflow 정적 테스트 작성**

- action은 full commit SHA로 고정한다.
- CI는 `contents: read`, render job만 `contents: write`이다.
- timeout과 concurrency가 있다.
- `npm ci --ignore-scripts`, `npm test`, `npm run validate`, deterministic render를 실행한다.
- schedule은 정각 혼잡 시간을 피하고 `workflow_dispatch`를 제공한다.
- render commit은 정확히 세 `cards/*.svg`만 명시적으로 stage하고 `cards/**` push는 workflow를 재실행하지 않는다.

**Step 2: 실패 확인**

Run: `node --test test/workflows.test.mjs`

Expected: workflow 파일이 없어 실패한다.

**Step 3: CI와 render workflow 구현**

- `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0`
- `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
- Node 24, npm cache, 최소 권한, bounded timeout, `persist-credentials: false`를 사용한다.
- render는 공개 JSON만 읽고 profile bearer나 로컬 로그를 요구하지 않는다.
- scheduled workflow가 지연·비활성화될 수 있음을 문서화하고 local sync를 기본 복구 경로로 둔다.
- renderer push가 device push와 경합하면 최신 main으로 rebase한 뒤 install/validate/render를 다시 수행하고 최대 3회만 재시도한다.
- workflow token은 최종 push 단계에만 주입하며 third-party auto-commit action을 사용하지 않는다.

**Step 4: workflow 정책 테스트와 전체 check 확인**

Run: `node --test test/workflows.test.mjs && npm run check`

Expected: workflow 정책과 전체 테스트 통과.

**Step 5: 커밋**

```bash
git add .github/workflows/ci.yml .github/workflows/render-cards.yml .github/dependabot.yml test/workflows.test.mjs
git commit -m "ci: 사용량 카드 검증과 렌더 자동화 추가"
```

### Task 12: 설치·운영·프로필 삽입 문서화

**Files:**
- Create: `README.md`
- Create: `README.ko.md`
- Create: `SECURITY.md`
- Create: `docs/setup-windows.md`
- Create: `docs/setup-unix.md`
- Create: `.env.example`
- Create: `test/docs.test.mjs`

**Step 1: 실패하는 문서 smoke test 작성**

- README에 architecture, privacy boundary, card URL, multi-device setup, source-selection 설명이 있다.
- Windows Task Scheduler와 macOS launchd/Linux cron 예제가 같은 `npm run sync`를 호출한다.
- Codex profile adapter가 비공식 endpoint이며 bearer 취급 주의와 local fallback을 명시한다.
- 동일 raw log를 여러 컴퓨터에 복사하면 중복될 수 있음을 경고한다.
- GitHub Actions public repo 무료 사용 조건, schedule 지연/60일 비활성 가능성, local fallback을 설명한다.
- `.env.example`에는 값 없는 변수명만 둔다.

**Step 2: 실패 확인**

Run: `node --test test/docs.test.mjs`

Expected: 공개 문서가 없어 실패한다.

**Step 3: 한국어/영문 문서와 scheduler 가이드 작성**

- 빠른 시작은 clone → `npm ci` → `npm run setup` → `npm run sync` 한 흐름으로 쓴다.
- 프로필 README에 넣을 raw GitHub SVG Markdown 예제를 제공한다.
- 기기 추가/교체/폐기, stale snapshot, profile token 만료, push 충돌 복구를 설명한다.

**Step 4: 문서와 전체 검증**

Run: `node --test test/docs.test.mjs && npm run check`

Expected: 문서 smoke test와 전체 검증 통과.

**Step 5: 커밋**

```bash
git add README.md README.ko.md SECURITY.md docs/setup-windows.md docs/setup-unix.md .env.example test/docs.test.mjs
git commit -m "docs: 다중 기기 설치와 GitHub 프로필 연동 안내"
```

### Task 13: 실제 로컬 집계와 대표 카드 생성

**Files:**
- Create locally only: `.agent-card.local.json`
- Create: `data/devices/<opaque-device-id>.json`
- Create when available: `data/profiles/<opaque-device-id>.json`
- Create: `cards/overview.svg`
- Create: `cards/trends.svg`
- Create: `cards/activity.svg`

**Step 1: 로컬 설정과 수집 실행**

Run: `npm run setup -- --timezone Asia/Seoul`

Expected: ignored `.agent-card.local.json` 생성, hostname/username 미포함.

Run: `npm run collect`

Expected: 기존 Codex/Claude Code 로그가 있으면 해당 일별 값만 익명 snapshot에 기록하고, 없으면 status가 드러나는 유효한 빈 snapshot 생성.

**Step 2: 선택적 profile 수집**

Run only when `CODEX_BEARER_TOKEN` is present: `npm run profile`

Expected: 성공 시 sanitized `data/profiles/<opaque-device-id>.json`; 인증정보가 없거나 endpoint가 바뀌었으면 기존 candidate를 보존하고 local Codex fallback 사용.

**Step 3: 고정 날짜로 렌더·검증**

Run: `npm run render -- --as-of 2026-07-19`

Run: `npm run validate`

Expected: 세 SVG 생성 및 공개 데이터/privacy/XML 검증 통과.

**Step 4: 시각 검수**

- overview/trends/activity를 실제 렌더링해 light/dark와 좁은 폭에서 확인한다.
- 긴 숫자, 0 사용량, 단일 source, stale 상태에서 잘림·겹침·낮은 대비가 없는지 확인한다.
- 문제가 있으면 먼저 재현 테스트를 추가한 뒤 renderer를 보정한다.

**Step 5: 결정론과 공개 경계 재검증**

Run: `npm run check:determinism -- --as-of 2026-07-19`

Expected: 독립된 두 렌더의 card bytes가 모두 동일함.

Run: `git status --short && git check-ignore -v .ai-agent-playbook/START_HERE.md .agent-card.local.json AGENTS.md`

Expected: 로컬 전용 파일은 ignored이고 stage 대상에 없음.

**Step 6: 산출물 커밋**

```bash
git add data/devices/<opaque-device-id>.json data/profiles/<opaque-device-id>.json
git commit -m "feat(data): 익명 기기 사용량 snapshot 추가"
```

profile candidate가 실제로 생성되지 않았으면 해당 경로는 staging에서 제외한다. cards는 GitHub Actions가 게시하고, Actions 장애 시에만 별도 `publish-cards` 복구 명령으로 명시적으로 게시한다.

### Task 14: 전체 검증과 GitHub 배포

**Files:**
- Verify: all tracked product files

**Step 1: clean install부터 전체 검증**

Run: `npm ci`

Expected: lockfile 그대로 설치 성공.

Run: `npm test && npm run check && npm run render -- --as-of 2026-07-19 && npm run validate`

Expected: 모든 parser/schema/calendar/merge/privacy/XML/determinism/sync/workflow 테스트 통과.

**Step 2: 공개 파일과 staged 경계 감사**

Run: `git status --short && git diff --check && git ls-files`

Expected: `.ai-agent-playbook/`, `AGENTS.md`, `.agent-card.local.json`, raw logs, secret files가 tracked 목록에 없음.

Run: `git grep -n -I -E "(Authorization:|Bearer [A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+|C:\\\\Users\\\\|/Users/|/home/)" -- ':!.github/workflows/*'`

Expected: 실제 secret/path 노출 없음. 문서의 안전한 placeholder만 있으면 수동 확인 후 유지.

**Step 3: remote와 branch 확인**

Run: `git remote -v && git branch --show-current && git log --oneline --decorate -15`

Expected: `origin`이 `https://github.com/jukrap/agent-card-tracker.git`, branch가 `main`, 모든 구현 커밋 존재.

필요할 때만 실행:

```bash
git remote add origin https://github.com/jukrap/agent-card-tracker.git
git branch -M main
```

**Step 4: 명시적 최종 staging 감사와 push**

Run: `git diff --cached --name-only`

Expected: 의도한 공개 product 파일만 표시되거나, 모든 작업이 이미 커밋되어 빈 출력.

Run: `git push -u origin main`

Expected: GitHub `jukrap/agent-card-tracker`의 main에 push 성공.

**Step 5: 원격 검증**

- GitHub Actions CI 결과를 확인한다.
- raw GitHub URL로 세 SVG가 열리고 GitHub profile Markdown에서 표시되는지 확인한다.
- render workflow가 실패하거나 scheduled workflow가 비활성화되어 첫 cards가 없으면 `npm run publish-cards -- --as-of 2026-07-19`로 동일 검증과 bounded push를 실행한다.
- 실패하면 로그의 공개 정보만 사용해 재현 테스트를 먼저 추가하고 수정한다.
