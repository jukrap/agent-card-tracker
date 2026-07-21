# Agent Card Tracker

[한국어 문서](README.ko.md)

Agent Card Tracker publishes account-wide Codex token usage as six deterministic SVG cards for a GitHub profile. Local jobs collect sanitized data, Git synchronizes it, and GitHub Actions renders the cards. No continuously running personal server is required.

The cards describe token activity and personal milestones. They do not rank users or measure productivity, code quality, or engineering impact.

## Cards

- `overview.svg` — lifetime tokens, exact total, current rank, next-rank progress, today, 7 days, 30 days, and active days
- `achievements.svg` — crest, 20-rank track, unlocked ranks, and four milestone seals
- `records.svg` — peak day, best 7-day and 30-day windows, and best complete calendar month
- `trends.svg` — compact 30-day, 12-week, and 12-month charts
- `activity.svg` — a 53×7 heatmap, active days, streaks, and peak usage
- `compact.svg` — an optional 416×96 rank badge

Use this layout in a GitHub profile README:

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

Use `compact.svg` instead when a small badge fits the profile better:

```html
<img width="416" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/compact.svg" alt="Codex rank badge">
```

Every SVG is self-contained, has light/dark palettes and `<title>/<desc>` accessibility metadata, and uses no external font, image, animation, or gradient. GitHub may cache raw files briefly after an update.

## Token ranks

The representative rank depends only on lifetime tokens. Progress between two thresholds is linear. It is a project-defined personal milestone, not a global percentile or productivity score.

| Rank | Title | Minimum |
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

Ranks I–IV are Common, V–VIII Uncommon, IX–XII Rare, XIII–XVI Epic, and XVII–XX Legendary. Roman numerals and titles remain visible so rarity never depends on color alone.

An exact account lifetime of 19.3B is `Rank XV · Mythic` and 62% of the way from 10B to `Ascendant · 25B`. A local fallback is an observed lower bound, so the cards show `At least Rank …`, `≥…%`, and `≥` totals. Unknown lifetime is `Unranked`; 1T or more is `MAX RANK`.

## Coverage and records

Missing dates become zero only inside declared coverage. Outside coverage they remain Unknown:

- `≥` and dashed outlines mean Partial, known lower-bound data.
- `—` and outline-only bars or cells mean Unknown.
- `0` means an observed zero and is not Unknown.

Normal fully covered values do not carry a technical status pill. Account profile dates use the `Codex account calendar`; device fallback dates use the configured IANA timezone. The two date systems are never added together.

Records consider only fully covered candidates. Missing dates inside that coverage count as zero, ties choose the earlier date, and an incomplete 7-day, 30-day, or calendar-month window is not eligible.

## How it works

1. On each computer, the pinned collector runs `ccusage codex` against that user's local history and reduces it to daily aggregates.
2. The computer owns one `data/devices/<opaque-device-id>.json` file and may publish one sanitized account profile candidate.
3. `npm run sync` validates and pushes only that computer's device/profile paths.
4. GitHub Actions merges the public snapshots and deterministically renders all six files under `cards/`.

Git is the synchronization layer. GitHub Actions cannot read local logs or local CLI authentication.

## Requirements

- Node.js 24 or newer and npm
- Git
- A dedicated clone of `https://github.com/jukrap/agent-card-tracker.git` on every participating computer
- Push access to `main`, including non-interactive Git authentication for scheduled runs
- One shared IANA timezone, such as `Asia/Seoul`

Scheduled sync expects the target repository, `main`, an upstream, and a clean tracked worktree. Use a dedicated operational clone, not a development worktree.

## Quick start on every computer

```console
git clone https://github.com/jukrap/agent-card-tracker.git
cd agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

`setup` generates a different anonymous device ID and private writer key on each computer. Never copy `.agent-card.local.json`; copied identities create ownership conflicts and can double-count copied history.

For unattended collection, follow the [Windows Task Scheduler guide](docs/setup-windows.md) or the [macOS/Linux launchd and cron guide](docs/setup-unix.md).

## Account profile and device fallback

`npm run profile` and `npm run sync` start the signed-in Codex CLI App Server with shell-free JSONL stdio, initialize experimental API support, then call `account/usage/read`. This is not screen scraping and does not use an unofficial HTTP endpoint or bearer environment variable.

Account-wide collection requires:

- a recent Codex CLI on `PATH`
- a ChatGPT sign-in for the same operating-system user that runs sync

On Windows, discovery prefers the npm-installed native Codex binary beside the shim before a packaged desktop binary. Set the non-secret `AGENT_CARD_CODEX_BIN` environment variable to an absolute executable path only when automatic discovery is insufficient.

Source selection is deterministic:

1. the newest fresh, valid account profile candidate collected within 48 hours; otherwise
2. the sum of local Codex snapshots from all valid devices.

The merger never adds account profile totals to local totals and never sums several profile candidates. `npm run sync` reports `account profile updated` or `device fallback` explicitly.

Authentication failure, missing CLI, unsupported method, timeout, early exit, protocol drift, or malformed output preserves the last valid profile candidate. Once it becomes older than 48 hours, rendering falls back to all devices' local Codex totals. API-key-only users and environments without App Server account usage can still publish cards from local Codex logs.

The account payload provides daily totals and an optional exact lifetime total. It does not provide the local session count or token breakdown used here, so those fields are omitted from the primary account card instead of being displayed as zero.

Test profile collection independently with:

```console
npm run profile
```

## Public schema and privacy boundary

Public device snapshots and profile candidates use schema version 2. Device `sources` permits only `codex`; schema v1 and unknown provider fields are rejected.

Public artifacts contain only:

- opaque device ID and one-way writer-key hash
- collection time, timezone, schema/collector versions, and sanitized status code
- local daily input, output, cache-read, cache-write, total token, and optional session counts
- account daily totals, optional lifetime total, and coverage metadata

They do not contain raw logs, prompts, responses, project names, file paths, session IDs, account identity, email, hostname, username, Git credentials, API keys, access tokens, CLI authentication state, stderr, or App Server response bodies. Exact allowlists and repository validation reject unknown fields, active/external SVG resources, and secret- or path-shaped public content.

The aggregate is intentionally public and can reveal token volume, active dates, timezone, collection cadence, and stale-device events. Use a private repository if that metadata is too sensitive, while noting that unauthenticated profile image URLs and Actions billing differ.

Copying the same raw logs to multiple computers can duplicate overlapping days. Keep one authoritative copy of each history or explicitly remove the superseded public snapshot before syncing its replacement.

See [SECURITY.md](SECURITY.md) for reporting and threat boundaries.

## Automation and recovery

The render workflow runs after data pushes, daily on an off-the-hour schedule, and by manual dispatch. GitHub scheduled workflows are best effort and may be delayed, dropped, or disabled after 60 days without repository activity.

If cards are stale:

1. run `npm run sync`;
2. inspect or dispatch **Render usage cards** in GitHub Actions;
3. if Actions is unavailable, run:

```console
npm run publish-cards -- --as-of YYYY-MM-DD
```

The recovery command renders, validates, and stages only the six card paths with bounded conflict handling.

Sync never force-pushes. Authentication failures preserve a recoverable local commit. `REMOTE_UPDATE_REQUIRES_RESTART` means code, dependencies, workflow, or configuration changed upstream: stop the scheduler, update the dedicated clone, run `npm ci --ignore-scripts` and `npm run validate`, then start a fresh sync.

`sync`, standalone `render`, and `publish-cards` share `.git/agent-card-sync.lock`. On `SYNC_STALE_LOCK`, stop the scheduler and verify that no process is using that exact clone before deleting only that exact lock file. Use the platform guide for the full procedure; never recursively clean `.git`.

## Device lifecycle

To add a computer, use a fresh dedicated clone, install dependencies, run `setup` with the shared timezone, then run `sync`.

To retire one, stop its scheduler first. Keeping its device snapshot preserves history and eventually marks it stale; deleting its device/profile files removes that history. If a replacement has copied local history, resolve overlapping snapshots before syncing a new identity.

## Limitations

- The experimental App Server protocol can change and may report a different scope from local logs.
- Provider calendar dates are preserved because daily payloads have no time-of-day or timezone.
- Token totals follow upstream `ccusage` and account-profile semantics; they are not billing records.
- Device aggregation cannot deduplicate copied logs.
- Public Git history retains previously committed aggregates.
- Scheduled Actions are best effort.

## Local commands

```console
npm run collect
npm run profile
npm run render -- --as-of YYYY-MM-DD
npm run validate
npm run check:determinism -- --as-of YYYY-MM-DD
npm run check
```

`render` and determinism checks require an explicit date so identical input produces byte-for-byte identical SVG output.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
