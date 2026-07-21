# Codex Renown macOS and Linux scheduled sync

Existing Agent Card Tracker installations must complete the [migration runbook](migration-codex-renown.md) before changing scheduler paths.

Both examples run the same `npm run sync` command from a dedicated clone. Use `launchd` on macOS and a user `cron` entry on Linux. Run the scheduler as the user whose local Codex logs, ChatGPT sign-in, and Git credentials should be used.

## 1. Prepare the dedicated clone

Install Git, Node.js 24 or newer, and npm. Choose an absolute operational path, then initialize this computer with the same IANA timezone used on every device:

```sh
git clone https://github.com/jukrap/codex-renown.git /absolute/path/to/codex-renown
cd /absolute/path/to/codex-renown
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

Create `io.github.jukrap.codex-renown.plist` under your user LaunchAgents directory. Replace every `/absolute/...` placeholder with a literal path from this computer:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.jukrap.codex-renown</string>

  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/npm</string>
    <string>run</string>
    <string>sync</string>
  </array>

  <key>WorkingDirectory</key>
  <string>/absolute/path/to/codex-renown</string>

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

This `ProgramArguments` array is the non-shell form of `npm run sync`; `WorkingDirectory` must be the clone root. The `PATH` must contain the directories of the resolved `node` and Codex CLI executables. If local history uses a customized `CODEX_HOME`, add only that required non-secret path to `EnvironmentVariables` in this private local plist.

Protect and load the file:

```sh
chmod 600 "$HOME/Library/LaunchAgents/io.github.jukrap.codex-renown.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.jukrap.codex-renown.plist"
launchctl kickstart -k "gui/$(id -u)/io.github.jukrap.codex-renown"
```

Inspect status with:

```sh
launchctl print "gui/$(id -u)/io.github.jukrap.codex-renown"
```

Before editing or removing the job, unload it with:

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/io.github.jukrap.codex-renown.plist"
```

## Linux: cron

Edit the current user's crontab with `crontab -e`. Use literal absolute paths. A user crontab normally supplies `HOME`; verify that it belongs to the user whose local logs should be collected.

```cron
PATH=/absolute/path/to/node-bin:/usr/local/bin:/usr/bin:/bin
27 1 * * * cd /absolute/path/to/codex-renown && npm run sync
```

The `cd` establishes the required working directory. The explicit environment `PATH` makes npm and node available without sourcing an interactive shell. The application lock rejects overlap; if the previous run can last a long time, also use the scheduler's own non-overlap facility where available.

Cron may email command output depending on system configuration. Sync output is sanitized, but execution times and device status are still metadata. If you redirect output to a file, create that file outside the repository with mode `0600`, limit retention, and never enable shell tracing.

## Credentials and optional profile collection

Git authentication must work without a prompt for the scheduler's user. Prefer an OS credential helper or a narrowly scoped SSH/Git credential protected by user-only permissions. Do not put a token in the remote URL, crontab, plist, command argument, or log.

For account-wide Codex totals, install a recent Codex CLI and complete its ChatGPT sign-in as the same user that owns the launchd job or crontab. Background jobs often have a smaller `PATH`; add the CLI directory to the private scheduler environment or set the non-secret `AGENT_CARD_CODEX_BIN` environment variable to the executable's absolute path.

A successful run reports `account profile updated` when account-wide usage is available and `device fallback` when it publishes only local Codex aggregates.

Do not copy CLI authentication files or place credentials in a plist, crontab, repository file, shell history, wrapper, or log. If the CLI is missing, signed in only with an API key, or does not support App Server account usage, sync still publishes local Codex aggregates and rendering uses the all-device local Codex fallback. GitHub Actions neither starts the App Server nor receives local CLI authentication state.

## Verify and recover

After installing either schedule, trigger it once and verify:

1. the job exits successfully under the intended user and `HOME`;
2. only this device's sanitized data path changes;
3. the commit reaches `origin/main` or sync reports no change;
4. the **Render Codex Renown cards** workflow completes.

Manual verification uses the same context:

```sh
cd /absolute/path/to/codex-renown
npm run sync
npm run validate
```

- On a missing npm/node error, fix the absolute executable and `PATH`; do not rely on `.profile`, `.zshrc`, or `.bashrc`.
- On missing local usage, confirm the scheduler user and its `HOME` or `CODEX_HOME` without printing private paths into public logs.
- On Git authentication failure, repair the scheduled user's credential and rerun. A recoverable local commit is preserved; never force-push.
- On a device/profile ownership collision, stop duplicate writers, give the duplicate computer a fresh setup, and resolve any overlapping raw logs before retrying.
- On `REMOTE_UPDATE_REQUIRES_RESTART`, unload/disable the scheduler, update the dedicated clone from `origin/main` without force-pushing, run `npm ci --ignore-scripts` and `npm run validate`, then launch a fresh sync. If one verified publication commit was preserved, rebase only that commit and abort on any conflict.
- On stale cards, run sync, manually dispatch **Render Codex Renown cards**, or use `npm run publish-cards -- --as-of YYYY-MM-DD` as documented in the README.

### SYNC_STALE_LOCK

The lock is fail-closed to avoid deleting a lock that another process replaced or reacquired after inspection. Do not remove it merely because its timestamp looks old.

1. Stop and disable the scheduler before inspecting the lock. On macOS, use the `launchctl bootout` command above and do not bootstrap the job again yet. On Linux, comment out or remove the exact agent-card crontab entry, save the crontab, and wait for any current run to finish.
2. List `codex-renown`, `agent-card`, `npm`, and `node` candidates, then inspect each candidate's command and current working directory. There must be no `sync`, `render`, or `publish-cards` process whose working directory is `/absolute/path/to/codex-renown`.

   ```sh
   pgrep -af 'agent-card|npm|node'
   lsof -a -p PID -d cwd
   ```

   Replace `PID` with each candidate process ID. On macOS, where `pgrep -a` output differs, use `pgrep -fl 'agent-card|npm|node'` and the same `lsof` check. Do not kill unrelated processes. If ownership is uncertain, keep the scheduler disabled and do not delete the lock until the candidate has exited.
3. Inspect the exact lock file without editing it:

   ```sh
   cat -- '/absolute/path/to/codex-renown/.git/agent-card-sync.lock'
   ```

4. Only after the process check is clear, delete that one file:

   ```sh
   rm -- '/absolute/path/to/codex-renown/.git/agent-card-sync.lock'
   ```

5. Keep the scheduler disabled, rerun the original `npm run sync`, `npm run render -- --as-of YYYY-MM-DD`, or `npm run publish-cards -- --as-of YYYY-MM-DD` command manually, and restore the scheduler only after it finishes.

Never use `rm -r`, `rm -f`, a wildcard, or a command targeting `.git` as a whole for this recovery.

When retiring a device, unload/remove its scheduler first. Keeping the public snapshot preserves history and eventually shows as stale; deleting it removes that device's past contribution from future cards.
