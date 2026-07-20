# Agent Card Tracker

[한국어 문서](README.ko.md)

Agent Card Tracker publishes Codex and Claude Code usage as three static SVG cards for a GitHub profile. Each computer collects its own local usage, Git stores only anonymous daily aggregates, and GitHub Actions renders the shared result. No continuously running personal server is required.

The cards report token activity, not work quality or productivity. Read [Privacy boundary](#privacy-boundary) before using this project in a public repository.

## Cards

- `overview.svg`: today, rolling 7/30 days, month to date, lifetime totals, source share, and token mix
- `trends.svg`: 30 daily, 12 Monday-based weekly, and 12 monthly buckets
- `activity.svg`: a 53-week heatmap, active days, streaks, and peak day

Use this HTML layout in your GitHub profile README. The overview uses the full row; trends and activity share the next row at 49% each:

```html
<p>
  <img width="100%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/overview.svg" alt="AI usage overview">
</p>
<p>
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/trends.svg" alt="AI usage trends">
  <img width="49%" src="https://raw.githubusercontent.com/jukrap/agent-card-tracker/main/cards/activity.svg" alt="AI usage activity">
</p>
```

The SVG files are self-contained and include light/dark palettes and accessibility metadata. GitHub may cache raw content, so a newly rendered card can take a short time to appear everywhere.

### Reading coverage states

The renderer does not silently turn missing observations into zero:

- **Complete**: the displayed interval is fully covered by all required sources.
- **Partial**: a known value is a lower bound because part of the interval or one source is unavailable. The card prefixes the value with `≥` and uses a dashed treatment.
- **Mixed**: at least one bucket uses a provider calendar date that cannot be mapped exactly to the configured IANA timezone. The displayed sum is approximate, not a lower bound; the card prefixes it with `≈` and uses a distinct dashed treatment.
- **Unknown**: no reliable value is available. The card shows `—` or an outlined cell/bar.
- `0`: usage was observed and was actually zero; it is different from Unknown.

Comparisons and streaks are unavailable when Mixed observations participate because calendar-day boundaries may not align. Source shares, token mix, trend bars, heatmap cells, active-day counts, and peak days remain visibly approximate. A provider-reported lifetime total is unaffected and stays exact because it is not calculated from calendar buckets; a tracked-daily lifetime can still be Mixed.

A stale-source label means at least one device snapshot is older than 72 hours. Historical values remain included. When the account profile supplies Codex totals without a token breakdown, those tokens appear as **Unknown mix**, not as Claude-only usage.

## How it works

1. On each computer, the pinned `ccusage` collector reads local Codex and Claude Code history and reduces it to daily totals.
2. That computer overwrites one `data/devices/<opaque-device-id>.json` file and may publish one sanitized Codex profile candidate.
3. `npm run sync` validates and pushes only that computer's aggregate paths through Git. It does not publish card files.
4. GitHub Actions validates all public data, merges devices, and deterministically writes the three files under `cards/`. `npm run publish-cards` is the explicit local recovery path.

Git is the synchronization layer and GitHub Actions is the renderer; neither GitHub Actions nor another computer can read logs that remain on a device.

## Requirements

- Node.js 24 or newer and npm
- Git
- A dedicated clone of `https://github.com/jukrap/agent-card-tracker.git` on every participating computer
- Push access to `main`, with non-interactive Git authentication available to scheduled runs
- One shared IANA timezone, such as `Asia/Seoul`, configured on every device

The sync safety checks expect the target repository, its default `main` branch, an upstream, and a clean tracked working tree. Do not use a development worktree or a clone containing unrelated edits for scheduled collection.

## Quick start on every computer

Run the complete flow separately on each computer. `setup` generates a different anonymous device ID and private writer key on each one.

```console
git clone https://github.com/jukrap/agent-card-tracker.git
cd agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

Use the same timezone on every device; mixed timezones fail closed instead of producing misleading daily totals. Do not copy `.agent-card.local.json` to another computer. A copied config makes two machines look like the same writer and is unsupported.

For unattended updates, follow [Windows Task Scheduler setup](docs/setup-windows.md) or [launchd/cron setup for macOS and Linux](docs/setup-unix.md). Both call the same `npm run sync` command from the dedicated clone.

## Source selection and double-counting protection

Claude Code always uses the sum of all valid device snapshots.

Codex uses exactly one source:

1. the newest fresh, valid account profile candidate; or
2. if no such candidate exists, the sum of local Codex values from all valid device snapshots.

The merger never adds a profile total to local Codex totals. It also never sums profile candidates from several computers. A profile candidate is fresh for 48 hours; missing, malformed, expired, or stale candidates cause the deterministic local fallback.

Session counts, when available, are unique sessions assigned to the configured timezone date of their last activity. A failed session query makes the count Unknown without discarding valid token totals.

## Experimental Codex account profile

`ccusage` reads only the logs present on one computer. For account-wide Codex totals, `npm run profile` and `npm run sync` start the signed-in Codex CLI's experimental App Server over local JSONL stdio, initialize it with experimental API support, and read `account/usage/read`. This is a local CLI protocol call, not a screen scrape of the Codex app and not a direct unofficial HTTP request.

Account-wide collection requires:

- a recent Codex CLI available on `PATH`
- an existing ChatGPT sign-in for the same operating-system user that runs the command

On Windows, an npm-installed native Codex binary beside the `codex` shim is preferred before the packaged app's `codex.exe`. This avoids a WindowsApps executable collision when the desktop app and npm CLI are both installed. If the executable is not on the scheduler's `PATH` or uses a custom layout, set the non-secret `AGENT_CARD_CODEX_BIN` environment variable to its absolute path. The project does not accept an executable path as a CLI argument and does not read an account credential or endpoint override.

`npm run sync` reports `account profile updated` when account-wide collection succeeded and `device fallback` when it published local-log totals instead.

API-key-only users, older CLI versions, and environments without App Server account usage support still get the local-log Codex and Claude Code cards. An authentication failure, missing CLI, unsupported method, timeout, early exit, protocol drift, or invalid response preserves the last valid profile candidate. After that candidate is older than 48 hours, rendering automatically falls back to the sum of all devices' local Codex totals. GitHub Actions never starts the App Server and never receives local CLI authentication state.

To test account-wide collection independently:

```console
npm run profile
```

The public schema remains version 1. Only sanitized daily token totals, an optional provider lifetime total, and coverage metadata are written. App Server streak, peak, turn-duration, identity, and raw response fields are not published. Provider calendar dates are preserved rather than pretending they belong to the configured IANA timezone; missing input/output/cache breakdown and session counts remain Unknown.

## Privacy boundary

Public snapshots contain only:

- an opaque random device ID and a one-way writer-key hash
- collection time, configured timezone, schema/collector versions, and sanitized status codes
- daily input, output, cache-read, cache-write, total token, and optional session counts
- for a profile candidate, sanitized daily totals, optional provider lifetime total, and coverage metadata

They do **not** contain raw logs, raw prompts or responses, project names, file paths, session IDs, account identity, email, hostname, username, Git credentials, API keys, access tokens, CLI authentication state, or App Server response bodies. Exact allowlists and repository validation reject unknown fields and secret/path-shaped public content.

The aggregate data itself is intentionally public. Token volume, active dates, timezone, session counts, and collection freshness can reveal working patterns. Use a private repository instead if that metadata is too sensitive, but note that private-repository GitHub Actions billing differs and this repository's public-profile URLs will not work for unauthenticated readers.

Copying the same raw logs to multiple computers can duplicate those days because the collectors cannot prove that two local records represent the same event. Keep one authoritative copy of each log history or remove the superseded snapshot before syncing the replacement.

See [SECURITY.md](SECURITY.md) for threat boundaries and private vulnerability reporting.

## Automation and cost

The repository uses standard GitHub-hosted runners in a public repository. Under the current [GitHub Actions billing documentation](https://docs.github.com/en/actions/concepts/billing-and-usage), that runner usage is free. Private repositories, larger runners, third-party services, network access, and future GitHub policy changes are outside this no-personal-server-cost claim.

The render workflow runs on data pushes, a daily off-the-hour schedule, and manual dispatch. GitHub documents that scheduled workflows can be delayed or dropped during high load and are automatically disabled after 60 days without repository activity; see [Events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Treat the schedule as best effort.

If cards are missing or stale:

1. run `npm run sync` on a device to refresh its public snapshot;
2. inspect or manually dispatch **Render usage cards** in the repository's Actions tab;
3. if Actions remains unavailable, publish the locally validated deterministic cards:

```console
npm run publish-cards -- --as-of YYYY-MM-DD
```

Use the intended calendar date in place of `YYYY-MM-DD`. The recovery command renders, validates, stages only the three card paths, and uses the same bounded conflict handling as sync.

## Device lifecycle and recovery

### Add a device

Create a fresh dedicated clone, run `npm ci`, run `setup` with the shared timezone, and then run `sync`. Never reuse another device's local config.

### Replace or retire a device

Stop its scheduler before rotating or replacing its local config. Keeping its device JSON preserves historical usage and eventually marks it stale. Removing its device and profile JSON removes that device's historical contribution too.

If a replacement computer or new config receives the same raw log history, do not keep both the old and new snapshots: their overlapping days will be counted twice. Resolve the old device/profile snapshot and overlapping history explicitly before syncing the new identity. If the replacement starts with new logs only, keep the old snapshot for history and create a new config for the new computer. Losing a config while retaining the same logs requires the same overlap decision; `setup` will not overwrite an existing config, and you must not reconstruct or copy it casually.

### Push or ownership conflict

Sync fetches first and retries a non-fast-forward push up to three times only while its own device/profile paths are unchanged remotely. It does not force-push or auto-select conflict sides. On an authentication failure, repair the Git credential available to that scheduled user and rerun sync. On a path ownership/collision error, stop all writers using that device config, determine which machine owns it, create a fresh config for the duplicate machine, and resolve any overlapping logs before retrying.

`REMOTE_UPDATE_REQUIRES_RESTART` means the fetched branch changed code, dependencies, workflows, or configuration rather than only public snapshots/cards. Stop the scheduler, update the dedicated clone from `origin/main` without a force push, run `npm ci --ignore-scripts` and `npm run validate`, then start a new `npm run sync` process. If the failed run preserved one publication commit, rebase only that verified commit onto `origin/main`; abort and inspect any conflict instead of choosing a side automatically.

Other failures preserve recoverable local commits. Keep the dedicated clone clean, update it from `main`, validate with `npm run validate`, and rerun `npm run sync`. Never use a force push as recovery.

### Stale repository lock

`sync`, standalone `render`, and `publish-cards` share the exact lock file `.git/agent-card-sync.lock`. A `SYNC_STALE_LOCK` error is intentionally fail-closed: the command does not auto-delete a stale-looking lock because another process could replace or reacquire it between inspection and deletion.

Recover in this order: stop and disable the clone's scheduler; verify that no `agent-card`, `npm`, or `node` process is running `sync`, `render`, or `publish-cards` for that exact clone; inspect `.git/agent-card-sync.lock`; delete only that exact file; then rerun the original command. Never use a wildcard, recursive deletion, or a broad `.git` cleanup. Follow the exact platform steps in the [Windows guide](docs/setup-windows.md#sync_stale_lock) or [macOS/Linux guide](docs/setup-unix.md#sync_stale_lock).

## Limitations

- The experimental App Server account usage method has no stability guarantee and may report a different scope from local logs.
- Provider calendar dates are not timezone-converted because the upstream payload has no time-of-day or timezone.
- Token categories and totals follow upstream `ccusage`/profile semantics; they are not billing records.
- Token count, sessions, streaks, and activity are not measures of productivity, correctness, or engineering impact.
- Device-level aggregation cannot deduplicate logs copied between devices.
- A public Git repository exposes every committed aggregate and its history.
- Scheduled Actions are best effort, so the local scheduler and `publish-cards` recovery path remain necessary.

## Local commands

```console
npm run collect
npm run render -- --as-of YYYY-MM-DD
npm run validate
npm run check:determinism -- --as-of YYYY-MM-DD
npm run check
```

`render` and determinism checks require an explicit `--as-of` date so identical input produces byte-for-byte identical SVG files.
Standalone `render` uses the same repository lock as `sync` and `publish-cards`; the programmatic renderer remains lock-free for callers that already hold that lock.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
