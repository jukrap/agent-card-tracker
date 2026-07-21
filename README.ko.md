# Agent Card Tracker

[English](README.md)

Agent Card Tracker는 Codex 계정 토큰 사용량을 GitHub 프로필용 정적 SVG 카드 6종으로 게시합니다. 로컬 작업이 정제된 데이터를 수집하고, Git으로 동기화한 뒤 GitHub Actions가 카드를 렌더링합니다. 계속 운영할 개인 서버는 필요하지 않습니다.

카드의 칭호와 배지는 개인 milestone입니다. 사용자 간 순위, 생산성, 코드 품질, 개발 성과를 뜻하지 않습니다.

## 카드 구성

- `overview.svg` — 누적 토큰, 정확한 전체 숫자, 현재 칭호, 다음 등급 진행률, 오늘·7일·30일·활동일
- `achievements.svg` — crest, 20단계 rank track, 해제 등급 수, milestone seal 4개
- `records.svg` — peak day, 최고 7일·30일 구간, 최고 완전한 달
- `trends.svg` — 30일·12주·12개월 micro chart
- `activity.svg` — 53×7 heatmap, 활동일, current/longest streak, peak
- `compact.svg` — 선택형 416×96 rank badge

GitHub 프로필 README의 기본 배치는 다음과 같습니다.

```html
<p>
  <img width="100%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/overview.svg" alt="Codex player profile">
</p>
<p>
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/achievements.svg" alt="Codex achievements">
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/records.svg" alt="Codex personal records">
</p>
<p>
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/trends.svg" alt="Codex usage trends">
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/activity.svg" alt="Codex activity">
</p>
```

작은 배지가 더 어울리면 `compact.svg`만 사용할 수 있습니다.

```html
<img width="416" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/compact.svg" alt="Codex rank badge">
```

SVG는 외부 font·image·animation·gradient 없이 한 파일로 완결됩니다. light/dark palette와 접근성 `<title>/<desc>`도 포함합니다. GitHub raw cache 때문에 갱신 직후에는 잠시 이전 이미지가 보일 수 있습니다.

## 토큰 칭호

대표 등급은 lifetime token만으로 정합니다. 두 threshold 사이 진행률은 선형입니다.

| Rank | 칭호 | 최소 토큰 |
|---:|---|---:|
| I | Novice | 0 |
| II | Initiate | 10K |
| III | Apprentice | 50K |
| IV | Adept | 100K |
| V | Scout | 500K |
| VI | Adventurer | 1M |
| VII | Knight | 5M |
| VIII | Veteran | 10M |
| IX | Elite | 50M |
| X | Champion | 100M |
| XI | Hero | 500M |
| XII | Warlord | 1B |
| XIII | Overlord | 2.5B |
| XIV | Paragon | 5B |
| XV | Mythic | 10B |
| XVI | Ascendant | 25B |
| XVII | Immortal | 50B |
| XVIII | Sovereign | 100B |
| XIX | Eternal | 250B |
| XX | Transcendent | 1T |

Rank I–IV는 Common, V–VIII는 Uncommon, IX–XII는 Rare, XIII–XVI는 Epic, XVII–XX는 Legendary입니다. 색상만으로 상태를 구분하지 않도록 Roman numeral과 칭호를 항상 함께 표시합니다.

계정 lifetime이 정확히 19.3B라면 `Rank XV · Mythic`이며 `Ascendant · 25B`까지 약 62%입니다. 로컬 fallback 합계는 관측된 하한이므로 `At least Rank …`, `≥…%`, `≥` total로 표시합니다. lifetime이 없으면 `Unranked`, 1T 이상이면 `MAX RANK`입니다.

## Coverage와 기록

누락 날짜는 선언된 coverage 안에서만 0으로 취급합니다. coverage 밖은 Unknown입니다.

- `≥`와 점선은 알려진 하한인 Partial을 뜻합니다.
- `—`와 outline-only bar/cell은 Unknown을 뜻합니다.
- `0`은 실제로 관측된 0이며 Unknown과 다릅니다.

정상적인 완전 관측 값에는 기술적인 상태 pill을 표시하지 않습니다. 계정 profile은 `Codex account calendar`를, device fallback은 설정한 IANA timezone을 사용합니다. 서로 다른 날짜 체계를 더하지 않습니다.

Records는 coverage가 완전한 후보만 비교합니다. 그 안의 누락 날짜는 0이며, 동률이면 더 이른 날짜를 선택합니다. 일부만 관측된 7일·30일·달력 월은 후보가 아닙니다.

## 동작 구조

1. 각 컴퓨터의 고정 collector가 로컬 기록에 `ccusage codex`를 실행하고 일별 집계로 축약합니다.
2. 컴퓨터마다 `data/devices/<opaque-device-id>.json` 하나를 소유하며 정제된 account profile candidate 하나를 게시할 수 있습니다.
3. `npm run sync`는 그 컴퓨터의 device/profile 경로만 검증하고 push합니다.
4. GitHub Actions가 공개 snapshot을 병합해 `cards/` 아래 SVG 6종을 결정론적으로 생성합니다.

Git은 동기화 계층입니다. GitHub Actions는 로컬 로그나 로컬 CLI 인증 상태를 읽을 수 없습니다.

## 요구 사항

- Node.js 24 이상과 npm
- Git
- 참여 컴퓨터마다 `https://github.com/jukrap/agent-card-tracker.git` 전용 clone
- 예약 실행에서도 동작하는 `main` push 인증
- 모든 기기에서 같은 IANA timezone(예: `Asia/Seoul`)

예약 sync는 올바른 저장소·`main`·upstream·깨끗한 tracked worktree를 요구합니다. 개발용 worktree가 아닌 전용 운영 clone을 사용하세요.

## 컴퓨터마다 시작하기

```console
git clone https://github.com/jukrap/agent-card-tracker.git
cd agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

`setup`은 컴퓨터마다 서로 다른 익명 device ID와 private writer key를 만듭니다. `.agent-card.local.json`을 다른 컴퓨터에 복사하지 마세요. 같은 identity를 재사용하면 ownership conflict와 중복 집계가 생길 수 있습니다.

자동 실행은 [Windows Task Scheduler 안내](docs/setup-windows.md) 또는 [macOS/Linux launchd·cron 안내](docs/setup-unix.md)를 따르세요.

## 계정 profile과 device fallback

`npm run profile`과 `npm run sync`는 로그인된 Codex CLI App Server를 shell 없이 JSONL stdio로 시작합니다. experimental API를 initialize한 뒤 `account/usage/read`를 호출합니다. 화면 scraping이나 비공식 HTTP endpoint, bearer 환경변수는 사용하지 않습니다.

계정 전체 수집 전제는 다음과 같습니다.

- `PATH`에서 찾을 수 있는 최신 Codex CLI
- 명령을 실행하는 같은 OS 사용자 계정의 ChatGPT 로그인

Windows에서는 desktop package보다 npm으로 설치된 shim 옆 native Codex binary를 우선 탐색합니다. 자동 탐색이 부족한 경우에만 비밀값이 아닌 `AGENT_CARD_CODEX_BIN`에 실행 파일 절대 경로를 지정하세요.

Source 선택은 항상 하나입니다.

1. 48시간 안에 수집된 가장 최신의 유효한 account profile candidate
2. 그런 candidate가 없으면 모든 기기의 로컬 Codex 합계로 자동 fallback

계정 profile과 로컬 합계를 절대 더하지 않으며 여러 profile candidate도 합산하지 않습니다. `npm run sync` 출력은 `account profile updated` 또는 `device fallback`을 명시합니다.

인증 실패, CLI 미설치, 미지원 method, timeout, 조기 종료, protocol 변경, 잘못된 응답이 발생하면 마지막 유효 profile candidate를 보존합니다. 48시간이 지나면 device fallback을 사용합니다. API key만 쓰거나 App Server account usage를 지원하지 않는 환경도 로컬 Codex 로그 카드 기능은 계속 사용할 수 있습니다.

계정 응답에는 일별 total과 선택적인 정확한 lifetime total만 있습니다. 로컬 session 수와 token breakdown은 account profile에 없으므로 주 카드에서 0으로 표시하지 않고 제외합니다.

계정 수집만 확인하려면 다음을 실행합니다.

```console
npm run profile
```

## 공개 schema와 개인정보 경계

공개 device snapshot과 profile candidate는 schema version 2입니다. device `sources`에는 `codex`만 허용하며 schema v1과 알 수 없는 provider field는 거부합니다.

공개 artifact에는 다음만 들어갑니다.

- 무작위 device ID와 writer key의 단방향 hash
- 수집 시각, timezone, schema/collector version, 정제된 상태 code
- 로컬 일별 input/output/cache-read/cache-write/total token 및 선택적인 session count
- 계정 일별 total, 선택적인 lifetime total, coverage metadata

raw logs, prompts, responses, project name, file path, session ID, account identity, email, hostname, username, Git credential, API key, access token, CLI authentication state, stderr, App Server response body는 공개하지 않습니다. 정확한 allowlist와 repository validator가 unknown field, active/external SVG resource, secret/path 형태 값을 거부합니다.

집계 데이터 자체는 공개이며 token volume, active date, timezone, collection cadence, stale-device event를 드러낼 수 있습니다. 이 metadata가 민감하면 private repository를 사용해야 하지만 unauthenticated profile image URL과 Actions billing 조건은 달라집니다.

같은 raw logs를 여러 컴퓨터에 복사하면 겹치는 날짜가 중복될 수 있습니다. log history마다 authoritative copy 하나를 유지하거나 대체된 공개 snapshot을 명시적으로 제거하세요.

보안 제보와 위협 경계는 [SECURITY.md](SECURITY.md)를 참고하세요.

## 자동화와 복구

Render workflow는 data push, 매일 off-the-hour schedule, 수동 dispatch에서 실행됩니다. GitHub 예약 workflow는 best effort이므로 지연·누락되거나 저장소 활동이 60일 없으면 비활성화될 수 있습니다.

카드가 오래됐다면 다음 순서로 확인합니다.

1. `npm run sync` 실행
2. GitHub Actions의 **Render usage cards** 확인 또는 수동 실행
3. Actions를 쓸 수 없으면 다음 local recovery 실행

```console
npm run publish-cards -- --as-of YYYY-MM-DD
```

복구 명령은 SVG 6종만 렌더·검증·stage하며 conflict retry 범위도 제한합니다.

Sync는 force-push하지 않습니다. 인증 실패 시 복구 가능한 local commit을 보존합니다. `REMOTE_UPDATE_REQUIRES_RESTART`는 upstream의 code·dependency·workflow·config가 바뀌었다는 뜻입니다. scheduler를 멈추고 전용 clone을 갱신한 뒤 `npm ci --ignore-scripts`와 `npm run validate`를 실행하고 새 sync를 시작하세요.

`sync`, standalone `render`, `publish-cards`는 `.git/agent-card-sync.lock`을 공유합니다. `SYNC_STALE_LOCK`이면 scheduler를 멈추고 해당 clone을 사용하는 process가 없음을 확인한 뒤 정확히 그 lock file 하나만 삭제하세요. 자세한 절차는 OS별 안내를 따르고 `.git` 전체를 재귀 삭제하지 마세요.

## 기기 수명주기

기기를 추가할 때는 새 전용 clone에서 dependency를 설치하고 같은 timezone으로 `setup`한 뒤 `sync`합니다.

기기를 폐기할 때는 scheduler부터 멈춥니다. device snapshot을 남기면 history를 보존하고 나중에 stale로 표시하며, device/profile 파일을 지우면 이후 카드에서 그 history도 제거됩니다. 대체 컴퓨터가 기존 local history를 복사했다면 새 identity를 sync하기 전에 겹치는 snapshot을 정리하세요.

## 제한 사항

- experimental App Server protocol은 바뀔 수 있고 local log와 범위가 다를 수 있습니다.
- provider 일별 payload에 시각/timezone이 없어 calendar date를 그대로 보존합니다.
- token total은 upstream `ccusage`와 account profile 의미를 따르며 billing record가 아닙니다.
- device aggregation은 복사된 log를 deduplicate할 수 없습니다.
- public Git history에는 과거 aggregate가 남습니다.
- scheduled Actions는 best effort입니다.

## 로컬 명령

```console
npm run collect
npm run profile
npm run render -- --as-of YYYY-MM-DD
npm run validate
npm run check:determinism -- --as-of YYYY-MM-DD
npm run check
```

`render`와 determinism 검사는 명시적인 날짜를 요구하므로 같은 입력에서 byte-for-byte 같은 SVG가 나옵니다.

## 라이선스

MIT. [LICENSE](LICENSE)와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
