# Windows scheduled sync

This guide runs the same `npm run sync` command with Windows Task Scheduler. Use a dedicated clone; scheduled sync refuses a linked worktree, the wrong repository/branch, or unrelated tracked changes.

## 1. Prepare the dedicated clone

Install Git, Node.js 24 or newer, and npm. Clone and initialize this computer with the same IANA timezone used by every other device:

```powershell
git clone https://github.com/jukrap/agent-card-tracker.git D:\agent-card-tracker
Set-Location D:\agent-card-tracker
npm ci
npm run setup -- --timezone Asia/Seoul
npm run sync
```

The first manual sync proves that local collection, validation, the `origin/main` upstream, and Git push authentication all work. Run it as the same Windows user that will own the scheduled task. Do not copy `.agent-card.local.json` from another computer.

The clone is an operational directory, not a development checkout. Keep its tracked working tree clean. When `package-lock.json` changes after an update, run `npm ci` again from this directory.

## 2. Resolve the npm executable

Task Scheduler does not load an interactive PowerShell profile and may have a smaller `PATH`. Resolve the executable once:

```powershell
(Get-Command npm.cmd).Source
```

Record the absolute `npm.cmd` path returned on this computer. Do not guess a path from another machine.

## 3. Create the Task Scheduler task

Open **Task Scheduler** and choose **Create Task**.

On **General**:

- use the same user that completed the manual Git push;
- use the least privilege needed and leave **Run with highest privileges** off;
- choose **Run only when user is logged on** if your Git credential manager requires an interactive user session.

On **Triggers**, add a daily trigger after normal development activity. The exact minute does not need to match GitHub Actions.

On **Actions**, create **Start a program** with:

- **Program/script**: the absolute `npm.cmd` path found above
- **Add arguments**: `run sync`
- **Start in (optional)**: `D:\agent-card-tracker`

The **Start in** value is required in practice: it is the sync working directory containing `.agent-card.local.json`, `package.json`, and the target Git repository. Do not include quotes around the value in that field.

On **Conditions**, enable network availability if appropriate for the computer. On **Settings**:

- allow the task to run as soon as possible after a missed start;
- stop it after a bounded period suitable for the connection;
- if the task is already running, choose **Do not start a new instance**.

The application also takes a process lock, but preventing an overlapping task gives clearer Task Scheduler history.

## 4. Environment and credentials

The IANA timezone and anonymous writer identity are in the ignored local config, so they do not depend on the scheduler environment. Git credentials must be available non-interactively to the task's user. Prefer Git Credential Manager or another user-scoped credential facility with access limited to this repository.

`CODEX_BEARER_TOKEN` is optional and is intentionally absent from the task example. Never put it in **Add arguments**, a PowerShell command string, exported task XML, repository file, or captured log. If you cannot inject it with an access-controlled OS facility, omit it; sync still publishes local Codex and Claude Code aggregates, and rendering falls back to local Codex when no fresh profile candidate exists.

Do not store secrets in a wrapper merely to make Task Scheduler inherit them. Any wrapper, task definition, and log that you add must remain outside the repository and readable only by the scheduled user.

## 5. Test and monitor

In Task Scheduler, right-click the task and choose **Run**. Confirm:

1. the task finishes successfully;
2. `data/devices/` receives only this device's sanitized snapshot change;
3. the commit reaches `origin/main` or the command reports no change;
4. the **Render usage cards** GitHub Actions workflow finishes afterward.

The command output is deliberately limited, but scheduler history and any extra logs still reveal execution times. Restrict their access and retention. Never enable shell tracing around a process that may receive a credential.

For a manual check from the same working directory and user:

```powershell
Set-Location D:\agent-card-tracker
npm run sync
npm run validate
```

## Recovery

- **Task cannot find npm or node:** re-check the absolute `npm.cmd` path and the scheduled user's environment, then run the task interactively as that user.
- **Authentication failure:** repair Git credentials for that user and rerun. The local commit is preserved; do not force-push.
- **Dirty working tree:** remove the operational clone's unrelated edits or create a fresh dedicated clone and a fresh device config. Do not copy the old config between computers.
- **Device/profile ownership collision:** stop every task using the duplicated config, identify the real owner, and create a fresh config for the duplicate device. Resolve overlapping raw logs before syncing.
- **Stale card:** run `npm run sync`, then manually dispatch **Render usage cards**. If Actions is unavailable, follow the `npm run publish-cards -- --as-of YYYY-MM-DD` recovery described in the README.

When retiring this computer, disable the task first. Keeping its public device snapshot preserves its historical contribution and eventually marks it stale; deleting that snapshot removes its history from later cards.
