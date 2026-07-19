# macOS and Linux scheduled sync

Both examples run the same `npm run sync` command from a dedicated clone. Use `launchd` on macOS and a user `cron` entry on Linux. Run the scheduler as the user whose local Codex/Claude Code logs and Git credentials should be used.

## 1. Prepare the dedicated clone

Install Git, Node.js 24 or newer, and npm. Choose an absolute operational path, then initialize this computer with the same IANA timezone used on every device:

```sh
git clone https://github.com/jukrap/agent-card-tracker.git /absolute/path/to/agent-card-tracker
cd /absolute/path/to/agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

The first manual run must push successfully as the scheduler's user. Sync requires the expected target repository/default branch/upstream and a clean tracked working tree. Do not use a linked development worktree, and never copy `.agent-card.local.json` from another computer.

Shell startup files are normally not loaded by `launchd` or `cron`. Resolve stable executable locations:

```sh
command -v node
command -v npm
```

If these commands point into a shell-only version manager, install a stable Node.js 24+ runtime available to background processes or provide its absolute binary directory in the scheduler `PATH`. Re-run `npm ci` in the clone whenever `package-lock.json` changes.

## macOS: launchd

Create `io.github.jukrap.agent-card-tracker.plist` under your user LaunchAgents directory. Replace every `/absolute/...` placeholder with a literal path from this computer:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.jukrap.agent-card-tracker</string>

  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/npm</string>
    <string>run</string>
    <string>sync</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/absolute/path/to/agent-card-tracker</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/absolute/path/to/node-bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>1</integer>
    <key>Minute</key>
    <integer>27</integer>
  </dict>

  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
```

This `ProgramArguments` array is the non-shell form of `npm run sync`; `WorkingDirectory` must be the clone root. The `PATH` must contain the directory of the resolved `node` executable. If local history uses a customized `CODEX_HOME` or `CLAUDE_CONFIG_DIR`, add only the required non-secret path to `EnvironmentVariables` in this private local plist.

Protect and load the file:

```sh
chmod 600 "$HOME/Library/LaunchAgents/io.github.jukrap.agent-card-tracker.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.jukrap.agent-card-tracker.plist"
launchctl kickstart -k "gui/$(id -u)/io.github.jukrap.agent-card-tracker"
```

Inspect status with:

```sh
launchctl print "gui/$(id -u)/io.github.jukrap.agent-card-tracker"
```

Before editing or removing the job, unload it with:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.jukrap.agent-card-tracker.plist"
```

## Linux: cron

Edit the current user's crontab with `crontab -e`. Use literal absolute paths. A user crontab normally supplies `HOME`; verify that it belongs to the user whose local logs should be collected.

```cron
PATH=/absolute/path/to/node-bin:/usr/local/bin:/usr/bin:/bin
27 1 * * * cd /absolute/path/to/agent-card-tracker && npm run sync
```

The `cd` establishes the required working directory. The explicit environment `PATH` makes npm and node available without sourcing an interactive shell. The application lock rejects overlap; if the previous run can last a long time, also use the scheduler's own non-overlap facility where available.

Cron may email command output depending on system configuration. Sync output is sanitized, but execution times and device status are still metadata. If you redirect output to a file, create that file outside the repository with mode `0600`, limit retention, and never enable shell tracing.

## Credentials and optional profile collection

Git authentication must work without a prompt for the scheduler's user. Prefer an OS credential helper or a narrowly scoped SSH/Git credential protected by user-only permissions. Do not put a token in the remote URL, crontab, plist, command argument, or log.

`CODEX_BEARER_TOKEN` is intentionally absent from both examples. It is optional; without it, sync still publishes local Codex and Claude Code aggregates. When no fresh profile candidate exists, rendering uses the all-device local Codex fallback.

If you choose the experimental profile adapter, inject the bearer through an access-controlled local credential mechanism that ultimately executes the same `npm run sync`. Do not store the bearer directly in a plist, crontab, repository file, shell history, or wrapper readable by other users. GitHub Actions neither needs nor receives it.

## Verify and recover

After installing either schedule, trigger it once and verify:

1. the job exits successfully under the intended user and `HOME`;
2. only this device's sanitized data path changes;
3. the commit reaches `origin/main` or sync reports no change;
4. the **Render usage cards** workflow completes.

Manual verification uses the same context:

```sh
cd /absolute/path/to/agent-card-tracker
npm run sync
npm run validate
```

- On a missing npm/node error, fix the absolute executable and `PATH`; do not rely on `.profile`, `.zshrc`, or `.bashrc`.
- On missing local usage, confirm the scheduler user and its `HOME`, `CODEX_HOME`, or `CLAUDE_CONFIG_DIR` without printing private paths into public logs.
- On Git authentication failure, repair the scheduled user's credential and rerun. A recoverable local commit is preserved; never force-push.
- On a device/profile ownership collision, stop duplicate writers, give the duplicate computer a fresh setup, and resolve any overlapping raw logs before retrying.
- On stale cards, run sync, manually dispatch **Render usage cards**, or use `npm run publish-cards -- --as-of YYYY-MM-DD` as documented in the README.

When retiring a device, unload/remove its scheduler first. Keeping the public snapshot preserves history and eventually shows as stale; deleting it removes that device's past contribution from future cards.
