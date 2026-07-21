# Migrating from Agent Card Tracker to Codex Renown

This runbook applies to every clone and every computer after the GitHub repository is renamed from `jukrap/agent-card-tracker` to `jukrap/codex-renown`.

Use the same sequence everywhere: **Stop → Update → Verify → Resume**. Finish one computer before starting the next. Do not let an old scheduler run while its clone is being updated or renamed.

## Contracts that do not change

The public product, repository, package, and primary executable become `codex-renown`. The following local contracts intentionally remain unchanged:

- `.agent-card.local.json`
- `AGENT_CARD_CODEX_BIN`
- `.git/agent-card-sync.lock`
- npm commands such as `npm run sync`, `npm run profile`, and `npm run render`
- the compatibility executable alias `agent-card`
- public snapshot schema version 2

Do not recreate or copy `.agent-card.local.json`. Each computer must retain its own existing device ID and writer key.

## 1. Stop

1. Disable the exact Task Scheduler, launchd, or cron entry for this clone.
2. Wait for any current `sync`, `render`, or `publish-cards` run to finish.
3. Inspect candidate `codex-renown`, `agent-card`, `npm`, and `node` processes and confirm their working directory. Do not stop unrelated processes.
4. If `.git/agent-card-sync.lock` exists, inspect it. Remove only that exact file and only after proving that no process uses the clone. Never recursively clean `.git`.
5. Record the clone path, scheduler name, scheduler working directory, and whether `AGENT_CARD_CODEX_BIN` is set.

Keep the scheduler disabled through the Update and Verify phases.

## 2. Update

Run these commands inside the existing clone:

```console
git remote set-url origin https://github.com/jukrap/codex-renown.git
git remote -v
git fetch --no-tags origin main
git checkout main
git pull --ff-only origin main
npm ci --ignore-scripts
```

The remote must be exactly `https://github.com/jukrap/codex-renown.git`. Do not force-push, reset away a preserved publication commit, or replace the clone while a local commit is pending. Resolve that state before continuing.

## 3. Verify

From the same operating-system user and working directory used by the scheduler:

```console
npm run check:syntax
npm test
npm run validate
npm run profile
npm run sync
```

`npm run profile` may report an App Server failure while local fallback remains usable. `npm run sync` must finish with either `account profile updated` or `device fallback` and must not report a repository identity mismatch.

Also verify:

- `.agent-card.local.json` still exists and was not copied from another machine;
- `AGENT_CARD_CODEX_BIN`, if used, still points to an absolute executable path;
- `git remote -v` shows only the renamed repository for `origin`;
- the worktree is clean after the manual sync;
- GitHub Actions can render the 35 allowlisted SVG files;
- canonical raw URLs use `/jukrap/codex-renown/main/cards/`.

Do not resume automation if validation, Git authentication, profile/device ownership, or repository identity is uncertain.

## 4. Rename the local folder

Folder renaming is optional for functionality but recommended for clarity. Do it only after verification and with the scheduler still disabled.

### Windows

Close terminals, editors, and Explorer windows whose current directory is the clone. From its parent directory:

```powershell
Set-Location 'D:\parent\directory'
Rename-Item -LiteralPath 'agent-card-tracker' -NewName 'codex-renown'
```

Update the Task Scheduler action's **Start in** directory to the new absolute path. Keep the executable and npm arguments unchanged. If Windows reports that the folder is in use, do not force the move; close the owning process or leave the old folder name until the next maintenance window.

### macOS/Linux

Unload the launchd job or keep the cron entry disabled, then run from the parent directory:

```sh
cd -- '/parent/directory'
mv -- 'agent-card-tracker' 'codex-renown'
```

Update `WorkingDirectory`, plist paths, wrapper scripts, or the cron `cd` path to the new absolute directory. Reload daemon configuration only after checking the edited path.

Renaming the folder preserves `.agent-card.local.json`, `.git/agent-card-sync.lock` history, and Git metadata because the directory contents move together.

## 5. Resume

1. Run one final manual `npm run sync` from the scheduler's updated working directory.
2. Confirm the expected `account profile updated` or `device fallback` message.
3. Re-enable only that computer's scheduler.
4. Observe its first scheduled run and check the GitHub Actions result.
5. Repeat Stop → Update → Verify → Resume on the next computer.

## Recovery notes

- `REMOTE_UPDATE_REQUIRES_RESTART`: keep the scheduler disabled, fetch `main`, run `npm ci --ignore-scripts` and `npm run validate`, then start a fresh manual sync.
- `SYNC_STALE_LOCK`: verify process ownership first, then delete only `.git/agent-card-sync.lock`.
- repository identity failure: re-run `git remote set-url origin https://github.com/jukrap/codex-renown.git` and inspect upstream configuration.
- missing cards: manually dispatch **Render Codex Renown cards** or run `npm run publish-cards -- --as-of YYYY-MM-DD` from a clean dedicated clone.
- folder rename blocked by Windows: leave the verified clone at its old local path and update it later; the GitHub rename and remote URL are independent of the local directory name.
