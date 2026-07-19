# Security policy

## Supported scope

Only the current `main` branch, its checked-in lockfile, and Node.js 24 or newer are supported. There are no maintained older release lines at this time. Security fixes are applied to `main`; users should update their dedicated clones with a clean install before the next collection.

The supported deployment is the repository's documented flow: one private local config per computer, sanitized schema-version 1 snapshots, the fixed target repository, and the checked-in GitHub Actions workflows. Fork-specific changes, copied device configs, custom profile endpoints, modified validators, and unpinned dependencies are outside the supported security boundary.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled: open the repository's **Security** tab and choose **Report a vulnerability**, or visit [the private report form](https://github.com/jukrap/agent-card-tracker/security/advisories/new). This creates a private draft security advisory for coordinated disclosure.

If the private form is unavailable, open a public issue asking the maintainer for a private contact channel, but include no vulnerability details, proof of concept, path, token, account information, or aggregate data in that issue. Do not report a secret by pasting the secret itself.

A useful private report includes:

- the affected commit and operating system
- the smallest safe reproduction, using synthetic data only
- expected and observed behavior
- impact on confidentiality, integrity, or card publication
- any proposed mitigation

Please allow time to reproduce and fix the issue before public discussion. The maintainer and reporter should agree on coordinated disclosure after a fix or mitigation is available. Do not access data that you do not own or disrupt another user's repository while researching a report.

## High-priority issues

Please report these privately:

- a way to publish raw logs, prompts, responses, paths, session IDs, identity, or credentials through a snapshot or SVG
- a validator bypass for a secret-shaped value or an active/external SVG resource
- command, argument, path, or Git injection
- writer-key ownership bypass or cross-device file overwrite
- leakage of `CODEX_BEARER_TOKEN`, Git credentials, upstream response bodies, or private error details
- unsafe conflict recovery that can overwrite remote history or another device's snapshot

Availability or schema changes in the unofficial provider endpoint, inaccurate upstream usage totals, and vulnerabilities in GitHub or `ccusage` should also be reported to their respective maintainers. They become in scope here only when this repository handles the failure unsafely.

## Privacy and threat boundary

Raw logs remain on each computer. Collection reduces them in memory to an intentionally public aggregate: opaque device ID, writer-key hash, timestamps/timezone, sanitized status, daily token categories/totals, optional session counts, and coverage. A profile candidate contains only sanitized provider calendar-date totals, optional lifetime total, and coverage.

The validator is designed to reject raw prompts and responses, project/file paths, session IDs, hostname, username, account identity, email, credentials, unknown fields, secret-shaped text, active SVG elements, and external SVG resources. The repository never needs the original log files or an authentication token to render cards.

Public aggregates are not anonymous in the statistical sense. Repository history may reveal token volume, active dates, timezone, collection cadence, session counts, and stale-device events. Users must decide whether that metadata is acceptable before publishing. Removing a file from the latest commit does not remove it from Git history or existing clones.

The controls reduce accidental disclosure and unsafe automation; they do not protect a workstation that is already compromised, a malicious repository writer, a compromised dependency or GitHub account, or a user who deliberately bypasses validation. Copying the same raw logs between devices can also create duplicate aggregates and is not a security-grade deduplication mechanism.

## Credential handling

`CODEX_BEARER_TOKEN` is an optional account credential for the experimental fixed profile endpoint. Supply it only through the local process environment. Never place it in Git, a CLI argument, task/cron/plist text, GitHub Actions secrets for this project, captured terminal output, or a public issue. The example environment file intentionally contains no value and is not automatically loaded.

Git push credentials belong in the platform's credential manager or another access-controlled mechanism available to the scheduled user. Use the least privilege needed for this one repository and protect local config, credential stores, scheduler definitions, and logs with user-only permissions.

If any credential may have been exposed:

1. revoke or rotate it at its issuer immediately;
2. stop scheduled collection and profile calls;
3. inspect Git history, Actions logs, local scheduler logs, and forks without copying the secret again;
4. remove the exposed material from all reachable history and caches where possible;
5. resume only after validation and authentication are clean.

History cleanup does not make a previously published credential safe; rotation is mandatory.

## Safe operation

- Run sync from a dedicated, clean clone with the expected upstream and branch.
- Give every computer its own generated local config; never copy it to another machine.
- Keep all devices on the same IANA timezone.
- Run `npm ci` from the lockfile and `npm run validate` before manual publication.
- Do not force-push to recover from collection or card conflicts.
- Treat scheduled GitHub Actions as best effort and review unexpected card or data diffs before publishing locally.
- Keep optional bearer access out of GitHub Actions; rendering uses public sanitized data only.

The public artifacts are data, not a backup of the raw usage history. Keep any needed private backup under your own access controls.
