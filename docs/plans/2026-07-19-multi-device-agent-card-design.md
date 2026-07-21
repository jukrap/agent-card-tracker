> **Superseded:** The current product is Codex-only, uses public schema v2, and renders six RPG usage cards. This document remains historical context.

> [!IMPORTANT]
> Superseded on 2026-07-22 by [Codex Renown design](2026-07-21-codex-renown-design.md) and [implementation plan](2026-07-22-codex-renown-implementation.md). Retained only as historical context; do not use it as the current product or provider contract.

# Multi-device AI usage card design

## Purpose

Build a GitHub profile card system that combines Codex and Claude Code usage from multiple computers without operating a personal server. The public repository stores only anonymous daily aggregates and generated static SVG files.

## Constraints

- Codex account-wide profile statistics are useful but come from an experimental, undocumented endpoint and must never be the only data source.
- GitHub-hosted runners cannot read logs stored on a user's computers.
- Claude Code usage is collected from local logs on every participating computer.
- Raw prompts, responses, paths, session identifiers, hostnames, credentials, and access tokens must never enter public artifacts.
- The repository must operate with GitHub Actions and local schedulers at no personal server cost.

## Architecture

The system has four stages:

1. A local collector invokes a pinned ccusage version for focused Claude Code and Codex daily reports.
2. Each computer overwrites one anonymous device snapshot under `data/devices/` and may publish one sanitized profile candidate under `data/profiles/`.
3. A merger selects the Codex source, combines daily usage, and derives period statistics.
4. A deterministic renderer writes self-contained SVG cards under `cards/`.

The local sync command collects, validates, and pushes only the current device's data paths. GitHub Actions validates the merged dataset and exclusively publishes generated cards on data pushes and on a daily schedule, which removes card-file conflicts between devices. Local rendering remains available for inspection; an explicit recovery command can publish cards when Actions is unavailable.

## Source selection

Claude Code always uses the sum of all valid device snapshots.

Codex uses exactly one of these sources:

1. The newest fresh, valid account profile candidate from `data/profiles/`.
2. The sum of Codex entries in all device snapshots.

Profile and local Codex values are never added together. A profile snapshot is fresh for a configurable interval. Missing, stale, malformed, or failed profile data automatically selects the local fallback.

The experimental profile adapter starts the signed-in Codex CLI App Server over local stdio, enables the experimental API during initialization, validates `account/usage/read`, and persists only sanitized daily token totals and the optional lifetime total. Process execution and protocol responses are injected in tests. It never logs CLI authentication state, stderr, an error cause, or a raw App Server response.

## Public data contract

Each device has a user-generated opaque identifier that is unrelated to its hostname. A device snapshot contains:

- schema version
- opaque device ID
- one-way hash of a local random writer key for accidental ID-collision detection
- generation timestamp and configured timezone
- collector version
- per-source collection status
- daily input, output, cache-read, cache-write, total token, and session counts

The snapshot does not contain model names, project names, paths, message/request/session IDs, prompt or response text, account IDs, email addresses, or credentials.

Each profile candidate contains only schema version, sanitized collection time, provider calendar-date basis, daily total tokens, lifetime total when available, and coverage metadata. If several devices publish candidates, the merger selects the newest valid and fresh candidate and never sums them.

All files are validated before merging. Exact field allowlists reject unknown fields, invalid dates and non-finite or negative counts are rejected, and a schema-version mismatch fails closed.

## Multi-device behavior

Every computer writes only its own device snapshot and optional profile candidate. Re-running a collector replaces those files rather than appending usage. The sync command operates in a dedicated clone, pulls before collection, stages only that device's explicit data paths, and retries a non-fast-forward push after rebasing a bounded number of times. A public hash of the ignored local writer key catches accidental reconstruction of an existing device ID; copying the entire local config remains unsupported because no local-only design can distinguish the copies.

Snapshots remain part of historical aggregation when a computer is offline. A stale flag is exposed to validation and diagnostics but past usage is not removed. Copying the same Codex or Claude log directory between computers can create duplicates and is documented as unsupported.

## Statistics

The merger derives all presentation data from daily records using one explicit IANA timezone and Monday-based weeks:

- today and previous-day change
- rolling 7 days and previous 7-day change
- rolling 30 days and previous 30-day change
- month to date and the matching elapsed period of the previous month
- lifetime total
- Codex versus Claude Code share
- input, output, cache-read, and cache-write mix
- active days, current streak, longest streak, and peak day
- daily, weekly, and monthly trend series
- 53-week activity heatmap using quantiles from the displayed period

Missing dates are filled with zero. Missing data and observed zero usage remain distinguishable in source diagnostics.

## Cards

The renderer produces:

- `cards/overview.svg` for period totals, changes, source share, and token mix
- `cards/trends.svg` for daily, weekly, and monthly trends
- `cards/activity.svg` for the 53-week heatmap and activity statistics

Every card is a static SVG with no script, remote font, external image, or foreign object. It includes `<title>` and `<desc>`, an explicit `viewBox`, XML-escaped dynamic text, light and dark palettes through `prefers-color-scheme`, and readable empty/error states.

Rendering accepts an explicit `--as-of` date so tests and scheduled runs are deterministic.

## Automation

The local workflow supports setup, collect, render, validate, and sync commands. Setup creates an ignored local configuration with a random device ID and timezone. Windows Task Scheduler, launchd, and cron examples call the same sync command.

GitHub Actions uses pinned action revisions, minimal permissions, concurrency control, timeouts, and explicit output paths. Continuous integration runs syntax checks and tests with read-only repository permissions. The rendering workflow grants `contents: write` only to its update job and commits only validated data and card files when the generated content changes.

The daily schedule refreshes rolling period labels even if no device publishes new usage. Local rendering remains a fallback when scheduled workflows are delayed or disabled.

## Failure handling

- A malformed JSONL line is handled by ccusage and cannot leak into the snapshot.
- A failed local source records a sanitized error code while preserving the previous valid snapshot on disk.
- Profile requests use a timeout and fail over to local Codex data.
- Atomic temporary-file replacement prevents partial JSON and SVG files.
- Invalid public input stops rendering before existing cards are replaced.
- Sync retries only bounded non-fast-forward conflicts and leaves recoverable local commits when it cannot push.
- Empty data produces valid explanatory cards and a successful validation result.

## Verification

Automated tests cover:

- focused ccusage JSON normalization for Claude Code and Codex
- malformed and unsupported data
- source selection without Codex double counting
- multi-device merge and stale snapshots
- timezone, day, Monday-week, month, leap-day, and comparison boundaries
- streak, peak, share, token-mix, and heatmap quantiles
- forbidden public fields and secret-shaped values
- deterministic XML-valid SVG output, escaping, accessibility metadata, and external-resource absence
- sync command safety decisions without pushing in tests

Manual verification renders representative empty, single-source, multi-source, and extreme-value fixtures, then inspects all cards at desktop and narrow widths in light and dark modes.

## Delivery boundary

Only product source, tests, workflows, public documentation, sanitized aggregate data, and generated cards are eligible for Git staging. Local agent instructions, playbooks, reference archives, local configuration, credentials, raw logs, and temporary output are excluded.
