# Agent Card Tracker

[English](README.md)

Agent Card Tracker는 여러 컴퓨터의 Codex 및 Claude Code 사용량을 GitHub 프로필용 정적 SVG 카드 세 장으로 게시합니다. 각 컴퓨터가 자기 로컬 사용량을 수집하고, Git에는 익명 일별 집계만 저장하며, GitHub Actions가 전체 결과를 렌더링합니다. 계속 실행되는 개인 서버는 필요하지 않습니다.

이 카드는 토큰 활동을 보여줄 뿐 작업 품질이나 생산성을 측정하지 않습니다. 공개 저장소에서 사용하기 전에 [공개 범위와 개인정보](#공개-범위와-개인정보)를 확인하세요.

## 카드 구성

- `overview.svg`: 오늘, 최근 7일/30일, 이번 달, lifetime 합계, source 비율, token mix
- `trends.svg`: 최근 30일, 월요일 기준 12주, 최근 12개월 추세
- `activity.svg`: 53주 heatmap, 활동일, 연속 활동, peak day

GitHub 프로필 README에는 아래 Markdown을 그대로 넣습니다.

```markdown
![AI usage overview](https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/overview.svg)
```

```markdown
![AI usage trends](https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/trends.svg)
```

```markdown
![AI usage activity](https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/activity.svg)
```

SVG는 외부 리소스가 없는 단일 파일이며 light/dark palette와 접근성 메타데이터를 포함합니다. GitHub raw 콘텐츠 캐시 때문에 새 카드가 모든 화면에 반영되기까지 잠시 걸릴 수 있습니다.

### 관측 상태 읽는 법

누락된 관측값을 조용히 0으로 바꾸지 않습니다.

- **Complete**: 표시 구간에 필요한 모든 source가 완전히 관측됐습니다.
- **Partial**: 구간 일부 또는 source 하나가 누락되어 현재 값이 하한입니다. 카드에서 `≥`와 점선 표현을 사용합니다.
- **Mixed**: 하나 이상의 bucket이 설정 IANA timezone으로 정확히 대응할 수 없는 provider calendar date를 사용합니다. 표시 합계는 근삿값이며 하한이 아닙니다. 카드에서 `≈`와 별도의 점선 표현을 사용합니다.
- **Unknown**: 신뢰할 수 있는 관측값이 없습니다. 카드에서 `—` 또는 테두리만 있는 cell/bar로 표시합니다.
- `0`: 실제로 관측했고 사용량이 0입니다. Unknown과 다릅니다.

Mixed 관측이 포함된 구간에서는 날짜 경계가 일치한다고 보장할 수 없어 비교와 연속 활동을 표시하지 않습니다. source 비율, token mix, 추세 bar, heatmap cell, 활동일 수, peak day는 근삿값임을 명시합니다. provider가 보고한 lifetime 합계는 calendar bucket으로 계산하지 않으므로 이 불일치에 영향받지 않고 정확한 값으로 유지되지만, 일별 추적 lifetime은 Mixed일 수 있습니다.

stale source 표시는 기기 snapshot 중 하나 이상이 72시간보다 오래됐다는 뜻입니다. 과거 값은 계속 포함됩니다. 계정 profile이 token 종류별 breakdown 없이 Codex 합계만 제공하면 해당 토큰은 Claude 사용량으로 오인되지 않도록 **Unknown mix**에 표시됩니다.

## 동작 구조

1. 각 컴퓨터에서 고정 버전의 `ccusage`가 로컬 Codex와 Claude Code 기록을 읽고 일별 합계로 축약합니다.
2. 컴퓨터마다 `data/devices/<opaque-device-id>.json` 하나를 덮어쓰며, 선택적으로 정제된 Codex profile candidate 하나를 게시합니다.
3. `npm run sync`는 해당 컴퓨터의 집계 경로만 검증하고 Git으로 push합니다. 카드 파일은 게시하지 않습니다.
4. GitHub Actions가 공개 데이터를 모두 검증·병합한 뒤 `cards/` 아래 SVG 세 장을 결정론적으로 생성합니다. `npm run publish-cards`는 명시적인 로컬 복구 경로입니다.

Git이 동기화 계층이고 GitHub Actions가 renderer입니다. GitHub Actions나 다른 컴퓨터는 한 기기에 남아 있는 로컬 로그를 읽을 수 없습니다.

## 요구 사항

- Node.js 24 이상과 npm
- Git
- 참여하는 컴퓨터마다 `https://github.com/jukrap/agent-card-tracker.git`의 전용 clone
- `main` push 권한과 예약 실행 계정에서 사용할 수 있는 비대화형 Git 인증
- 모든 기기에 동일하게 설정할 `Asia/Seoul` 같은 IANA timezone

sync 안전 검사는 대상 저장소, 기본 `main` branch, upstream, 깨끗한 tracked working tree를 요구합니다. 개발 worktree나 다른 수정이 섞인 clone을 예약 수집에 쓰지 마세요.

## 모든 컴퓨터에서 빠른 시작

아래 흐름을 컴퓨터마다 따로 실행합니다. `setup`은 각 기기에 서로 다른 익명 device ID와 비공개 writer key를 생성합니다.

```console
git clone https://github.com/jukrap/agent-card-tracker.git
cd agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

모든 기기에서 같은 timezone을 사용하세요. 서로 다른 timezone이 섞이면 잘못된 일별 합계를 만들지 않고 병합이 실패합니다. `.agent-card.local.json`을 다른 컴퓨터에 복사하지 마세요. 복사된 config는 두 기기를 같은 writer로 보이게 하므로 지원하지 않습니다.

자동 실행은 [Windows Task Scheduler 설정](docs/setup-windows.md) 또는 [macOS launchd/Linux cron 설정](docs/setup-unix.md)을 참고하세요. 모두 전용 clone을 working directory로 삼아 같은 `npm run sync`를 호출합니다.

## Source 선택과 이중 집계 방지

Claude Code는 항상 모든 유효한 기기 snapshot의 합계를 사용합니다.

Codex는 아래 둘 중 정확히 하나만 사용합니다.

1. 가장 최신이면서 유효 기간 안에 있는 profile candidate
2. 그런 candidate가 없을 때 모든 유효한 기기의 로컬 Codex 합계

profile과 로컬 Codex 값은 절대 서로 더하거나 합산하지 않습니다. 여러 컴퓨터가 만든 profile candidate도 합치지 않고 가장 최신 유효 candidate 하나만 고릅니다. profile candidate 유효 기간은 48시간이며, 없거나 잘못됐거나 만료됐거나 오래됐으면 결정론적으로 로컬 값으로 fallback합니다.

session count를 얻을 수 있을 때는 session IDs 원문을 버리고 마지막 활동 시각이 속하는 설정 timezone 날짜별 unique session 수만 셉니다. session 조회 실패는 유효한 token 합계를 버리지 않고 session만 Unknown으로 둡니다.

## 실험적 Codex 계정 profile

`ccusage`는 현재 컴퓨터에 존재하는 로그만 읽습니다. Codex 프로필에서 보이는 계정 단위 token 통계를 가져오려고 시도하는 부분은 선택적 profile adapter입니다. 이 adapter는 고정된 비공식 endpoint `https://chatgpt.com/backend-api/wham/profiles/me`만 호출하고, 인증은 `CODEX_BEARER_TOKEN` process environment에서만 읽습니다.

이 endpoint는 문서화되지 않았으며 언제든 바뀌거나 중단될 수 있습니다. bearer는 계정 credential입니다. 저장소에 commit하거나, command-line argument에 넣거나, scheduler 정의에 평문으로 적거나, GitHub Actions로 보내거나, 로그에 남기지 마세요. 이 프로젝트는 `.env.example`을 자동으로 읽지 않습니다. 해당 파일은 변수 이름만 안내합니다. 대화형 실행에 환경을 주입할 때는 OS credential 기능이나 접근 권한이 제한된 로컬 수단을 권장합니다.

현재 process environment에 bearer를 준비한 뒤 adapter만 확인하려면 다음을 실행합니다.

```console
npm run profile
```

`npm run sync`에서도 profile 수집은 선택 사항입니다. 인증 만료, schema 변경, timeout, endpoint 실패가 발생하면 마지막 유효 candidate를 보존합니다. 그 candidate가 48시간 freshness를 넘으면 renderer는 모든 기기의 로컬 Codex 데이터로 자동 fallback합니다. GitHub Actions에는 bearer가 필요하지 않으며 전달하지도 않습니다.

profile bucket은 시각과 timezone이 없는 provider calendar date만 제공합니다. 프로젝트는 이를 설정 timezone의 날짜인 것처럼 변환하지 않고 원래 label을 유지합니다. input/output/cache breakdown과 session 수가 없는 경우 해당 값은 Unknown입니다.

## 공개 범위와 개인정보

공개 snapshot에 허용되는 값은 다음뿐입니다.

- hostname과 무관한 random device ID 및 writer key의 one-way hash
- 수집 시각, 설정 timezone, schema/collector version, 정제된 상태 코드
- 일별 input, output, cache-read, cache-write, total token 및 선택적 session 수
- profile candidate의 정제된 일별 합계, 제공되는 경우 lifetime 합계, coverage metadata

raw logs, raw prompts나 responses, project 이름, 파일 경로, session IDs, 계정 identity, email, hostname, username, Git credential, API key, bearer secret는 저장하지 않습니다. exact allowlist와 repository validator가 알 수 없는 필드 및 secret/path 형태의 공개 콘텐츠를 거절합니다.

집계 데이터 자체는 의도적으로 공개됩니다. token 양, 활동 날짜, timezone, session 수, 수집 freshness로 작업 패턴을 유추할 수 있습니다. 이 metadata가 민감하다면 private repository를 사용해야 하지만, private repository의 GitHub Actions 비용 조건은 다르며 여기의 공개 profile URL도 비로그인 독자에게 동작하지 않습니다.

동일한 raw logs를 여러 컴퓨터에 복사하면 collector가 같은 이벤트임을 증명할 수 없어 해당 날짜가 중복 집계될 수 있습니다. 각 로그 이력은 한 기기만 authoritative source로 유지하거나, 교체된 기기의 snapshot을 새 기기 sync 전에 제거하세요.

보안 경계와 비공개 취약점 제보 방법은 [SECURITY.md](SECURITY.md)를 확인하세요.

## 자동화와 비용

이 저장소는 공개 저장소의 standard GitHub-hosted runner를 사용합니다. 현재 [GitHub Actions billing 문서](https://docs.github.com/en/actions/concepts/billing-and-usage)에 따르면 이 조건의 runner 사용은 무료입니다. private repository, larger runner, 제3자 서비스, 네트워크 사용료, 향후 GitHub 정책 변경은 개인 서버 비용 없음이라는 범위에 포함되지 않습니다.

render workflow는 data push, 매일 정각을 피한 schedule, 수동 dispatch로 실행됩니다. GitHub 공식 문서에 따르면 scheduled workflow는 높은 부하에서 지연되거나 dropped(누락)될 수 있고, 공개 저장소에 60일 동안 활동이 없으면 자동 비활성화될 수 있습니다. 자세한 내용은 [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)를 참고하세요. schedule은 best effort로 취급해야 합니다.

카드가 없거나 오래됐다면 다음 순서로 복구합니다.

1. 기기에서 `npm run sync`를 실행해 공개 snapshot을 갱신합니다.
2. 저장소 Actions 탭에서 **Render usage cards** 상태를 확인하거나 수동 실행합니다.
3. Actions를 계속 사용할 수 없으면 로컬에서 검증된 결정론적 카드를 게시합니다.

```console
npm run publish-cards -- --as-of YYYY-MM-DD
```

`YYYY-MM-DD`에는 기준 calendar date를 넣습니다. 복구 명령은 render와 validation을 수행하고 카드 세 경로만 stage하며 sync와 같은 제한적 충돌 처리를 사용합니다.

## 기기 수명주기와 복구

### 기기 추가

새 전용 clone을 만들고 `npm ci`, 같은 timezone의 `setup`, `sync` 순서로 실행합니다. 다른 기기의 local config를 재사용하지 않습니다.

### 기기 교체 또는 폐기

local config를 교체하거나 기기를 대체하기 전에 먼저 해당 scheduler를 중단합니다. 기기 JSON을 유지하면 과거 사용량도 유지되고 시간이 지나 stale로 표시됩니다. device/profile JSON을 제거하면 그 기기의 과거 기여분도 합계에서 사라집니다.

교체 컴퓨터나 새 config가 같은 raw log 이력을 사용한다면 이전 snapshot과 새 snapshot을 함께 두지 마세요. 겹치는 날짜가 두 번 합산됩니다. 새 identity를 sync하기 전에 이전 device/profile snapshot과 겹치는 이력을 명시적으로 정리합니다. 새 컴퓨터가 새 로그로만 시작한다면 이전 snapshot은 과거 이력용으로 유지하고 새 config를 만듭니다. config를 잃었지만 같은 로그를 유지하는 경우에도 같은 중복 기준으로 판단해야 합니다. `setup`은 기존 config를 덮어쓰지 않으며, 이를 임의로 재구성하거나 복사하면 안 됩니다.

### Push 또는 ownership 충돌

sync는 먼저 fetch하고, 자신의 device/profile 경로가 원격에서 바뀌지 않은 경우에만 non-fast-forward push를 최대 세 번 재시도합니다. force push나 conflict side 자동 선택은 하지 않습니다. 인증 실패라면 예약 실행 사용자에게 보이는 Git credential을 고치고 sync를 다시 실행하세요. path ownership/collision 오류라면 해당 config를 쓰는 모든 writer를 중단하고 실제 소유 기기를 정한 다음, 중복 기기에 새 config를 만들고 겹치는 로그를 정리한 뒤 재시도합니다.

`REMOTE_UPDATE_REQUIRES_RESTART`는 가져온 branch에서 공개 snapshot/card 외의 코드, 의존성, workflow, 설정이 바뀌었다는 뜻입니다. scheduler를 중지하고 force push 없이 전용 clone을 `origin/main`으로 갱신한 뒤 `npm ci --ignore-scripts`, `npm run validate`를 실행하고 새 `npm run sync` process를 시작하세요. 실패한 실행이 게시 commit 하나를 보존했다면 검증된 그 commit만 `origin/main` 위로 rebase하고, conflict가 발생하면 한쪽을 자동 선택하지 말고 abort한 뒤 원인을 확인하세요.

그 밖의 push 실패에서도 복구 가능한 local commit은 보존됩니다. 전용 clone을 깨끗하게 유지하고 `main` 최신 상태를 반영한 뒤 `npm run validate`와 `npm run sync`를 다시 실행하세요. 복구를 위해 force push하지 마세요.

### 오래된 저장소 lock

`sync`, 단독 `render`, `publish-cards`는 정확히 `.git/agent-card-sync.lock` 파일 하나를 공유합니다. `SYNC_STALE_LOCK`은 의도적인 fail-closed 오류입니다. 확인과 삭제 사이에 다른 process가 lock을 교체하거나 다시 획득할 수 있으므로 명령이 오래돼 보이는 lock을 자동 삭제하지 않습니다.

다음 순서를 지키세요. 먼저 해당 clone의 scheduler를 중지하고 비활성화합니다. 그 정확한 clone에서 `sync`, `render`, `publish-cards`를 실행 중인 `agent-card`, `npm`, `node` process가 하나도 없는지 확인합니다. `.git/agent-card-sync.lock` 내용을 점검하고 그 파일 하나만 삭제한 뒤 원래 명령을 다시 실행합니다. wildcard, 재귀 삭제, 광범위한 `.git` 정리를 사용하지 마세요. 정확한 명령은 [Windows 가이드](docs/setup-windows.md#sync_stale_lock) 또는 [macOS/Linux 가이드](docs/setup-unix.md#sync_stale_lock)를 따르세요.

## 한계

- 실험적 profile endpoint의 안정성은 보장되지 않으며 로컬 로그와 집계 범위가 다를 수 있습니다.
- provider calendar date에는 시각/timezone 정보가 없어 timezone 변환하지 않습니다.
- token 종류와 합계는 upstream `ccusage`/profile 의미를 따르며 billing 기록이 아닙니다.
- token 수, session, streak, activity는 생산성, 정확성, engineering impact를 측정하지 않습니다.
- 기기별 집계만으로 여러 기기에 복사된 로그를 deduplicate할 수 없습니다.
- 공개 Git 저장소는 commit된 집계와 그 history를 모두 노출합니다.
- scheduled Actions는 best effort이므로 local scheduler와 `publish-cards` 복구 경로가 필요합니다.

## 로컬 명령

```console
npm run collect
npm run render -- --as-of YYYY-MM-DD
npm run validate
npm run check:determinism -- --as-of YYYY-MM-DD
npm run check
```

`render`와 결정론 검사는 명시적인 `--as-of` 날짜를 요구하므로 입력이 같으면 byte-for-byte 같은 SVG를 생성합니다.
단독 `render`는 `sync`, `publish-cards`와 같은 저장소 lock을 사용하며, 이미 그 lock을 보유한 호출자를 위한 programmatic renderer는 lock을 다시 획득하지 않습니다.

## 라이선스

MIT. [LICENSE](LICENSE)와 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 확인하세요.
