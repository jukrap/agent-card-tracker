# Codex Renown Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the existing six Codex usage cards into the complete Codex Renown product: seven card types, rank and achievement iconography, identity, five static theme families, compatibility-aware renaming, documentation, and a merged GitHub delivery.

**Architecture:** Keep schema v2 and the account-profile/device-fallback data pipeline unchanged. Add shared product and card catalogs, compute the 16 coverage-aware achievements in the domain layer, render all cards from reusable crest/icon/prestige primitives, and publish one canonical GitHub set plus four flat filename theme variants. Preserve fail-closed validation and the stable local config, environment-variable, lock, snapshot, schema, and npm-script contracts.

**Tech Stack:** Node.js 24 ESM, `node:test`, deterministic inline SVG, `saxes`, npm, Git, GitHub Actions, GitHub CLI.

---

### Task 1: Centralize the product, card, and theme contracts

**Files:**
- Create: `src/product.mjs`
- Create: `src/card-catalog.mjs`
- Create: `src/render/themes.mjs`
- Create: `test/product.test.mjs`
- Modify: `test/render.test.mjs`

**Steps:**

1. Write failing tests for the visible name, tagline, disclaimer, validated repository owner handle, target repository, primary CLI and legacy alias.
2. Assert exactly seven card names, approved viewBoxes, five theme names, 35 unique flat artifact paths, and stable canonical filenames.
3. Run `node --test test/product.test.mjs test/render.test.mjs` and confirm failure because the catalogs and trophy case do not exist.
4. Implement immutable product, card, viewBox, theme, filename, and artifact-path catalogs.
5. Run the focused tests; catalog assertions pass and later renderer assertions may remain red.
6. Commit as `feat(core): 제품·카드·테마 계약 추가`.

### Task 2: Rename public package and CLI surfaces with compatibility

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/cli.mjs`
- Modify: `src/commands/collect.mjs`
- Modify: `src/commands/profile.mjs`
- Modify: `src/commands/publish-cards.mjs`
- Modify: `src/commands/render.mjs`
- Modify: `src/commands/setup.mjs`
- Modify: `src/commands/sync.mjs`
- Modify: `src/commands/validate.mjs`
- Modify: `src/git/repository.mjs`
- Modify: `test/cli.test.mjs`
- Modify: `test/git-sync.test.mjs`

**Steps:**

1. Write failing tests for package name `codex-renown`, both bin entries, primary `codex-renown` help text, alias documentation, and `jukrap/codex-renown` repository validation.
2. Assert `.agent-card.local.json`, `AGENT_CARD_CODEX_BIN`, `.git/agent-card-sync.lock`, temp prefixes, schema v2, and npm script names remain unchanged.
3. Run `node --test test/product.test.mjs test/cli.test.mjs test/config.test.mjs test/git-sync.test.mjs` and confirm the old names fail.
4. Implement the progressive rename without touching stable local contracts.
5. Run `npm install --package-lock-only --ignore-scripts` and the focused tests.
6. Commit as `feat(cli): 공개 명칭 전환과 기존 명령 호환 유지`.

### Task 3: Compute the complete 16-achievement catalog

**Files:**
- Create: `src/domain/achievements.mjs`
- Create: `test/achievements.test.mjs`
- Modify: `src/domain/statistics.mjs`
- Modify: `test/statistics.test.mjs`

**Steps:**

1. Write failing tests for all 16 IDs, categories, thresholds, icon IDs, coverage states, exact boundaries, lower-bound unlocks, and unknown states.
2. Assert representative selection chooses the highest unlocked item per category and the baseline set is Mythic Realm, Seven-Day Siege, Monthbound, and Active Centurion.
3. Run `node --test test/achievements.test.mjs test/statistics.test.mjs` and confirm the four-item legacy model fails.
4. Implement the immutable catalog and pure evaluator over lifetime, records, longest streak, active days, and peak day.
5. Compute records before achievements and expose all 16 plus four representatives without changing public schema v2.
6. Run `node --test test/achievements.test.mjs test/statistics.test.mjs test/rank.test.mjs`.
7. Commit as `feat(domain): 16개 업적과 대표 선택 규칙 추가`.

### Task 4: Build Primer-native heraldry and prestige primitives

**Files:**
- Create: `src/render/icons.mjs`
- Create: `src/render/crest.mjs`
- Create: `src/render/prestige.mjs`
- Create: `test/render-icons.test.mjs`
- Modify: `src/domain/rank.mjs`
- Modify: `test/rank.test.mjs`
- Modify: `src/render/svg.mjs`

**Steps:**

1. Write failing tests for 20 unique rank glyph IDs, five frames, one-to-four pips, Rank XV's Epic/three-pip crest, 16 achievement icons, contained-prestige geometry, XML safety, and deterministic output.
2. Parse every theme's light/dark variables and enforce 4.5:1 text and 3:1 meaningful-icon contrast.
3. Run `node --test test/render-icons.test.mjs test/rank.test.mjs test/svg-validator.test.mjs` and confirm failure.
4. Implement reusable 24px glyphs, frames, pips, achievement icons, bounded prestige ornament, and theme-aware `cardDocument()`.
5. Preserve the no-image, no-link, no-gradient, no-animation validator boundary.
6. Run focused tests and commit as `design(cards): 계급 crest와 테마 토큰 시스템 추가`.

### Task 5: Redesign the seven card renderers

**Files:**
- Create: `src/render/trophy-case.mjs`
- Modify: `src/render/overview.mjs`
- Modify: `src/render/achievements.mjs`
- Modify: `src/render/compact.mjs`
- Modify: `src/render/records.mjs`
- Modify: `src/render/trends.mjs`
- Modify: `src/render/activity.mjs`
- Modify: `test/render.test.mjs`

**Steps:**

1. Write failing tests for all seven viewBoxes, `CODEX RENOWN · @jukrap`, token hierarchy, crest reuse, four representatives, 16 trophy badges, category labels, identity anchors, 20 rank nodes, 371 heatmap cells, records, coverage glyphs, long values, and bounded geometry.
2. Run `node --test test/render.test.mjs test/render-icons.test.mjs` and confirm legacy layout failures.
3. Implement the approved layouts, keeping the six existing dimensions and adding an 846×276 trophy case.
4. Pass `{ theme, identity }` through every renderer; keep analytical colors and state semantics independent of rarity.
5. Run renderer and validator tests.
6. Commit as `design(cards): 사용량 계급 7종 카드 재구성`.

### Task 6: Publish all 35 deterministic theme artifacts safely

**Files:**
- Create: `scripts/list-card-paths.mjs`
- Modify: `src/commands/render.mjs`
- Modify: `src/commands/publish-cards.mjs`
- Modify: `src/git/publish.mjs`
- Modify: `scripts/check-render-determinism.mjs`
- Modify: `test/render.test.mjs`
- Modify: `test/git-sync.test.mjs`
- Modify: `test/validate-command.test.mjs`

**Steps:**

1. Write failing tests for 35 safe flat SVG paths, seven root canonical files, four suffix sets, pre-validation, rollback, bounded scope, determinism, and rejection of nested/unlisted artifacts.
2. Run `node --test test/render.test.mjs test/git-sync.test.mjs test/validate-command.test.mjs` and confirm six-artifact failures.
3. Render seven card types for each theme; map GitHub to canonical names and variants to flat suffixed names.
4. Drive staging, rollback, remote allowlisting, determinism, and the fixed workflow path list from `CARD_ARTIFACT_PATHS`.
5. Keep the validator's non-recursive `cards/` directory boundary unchanged.
6. Run focused pipeline and staging tests.
7. Commit as `feat(cards): 5개 테마 정적 산출물 게시 지원`.

### Task 7: Update workflows, docs, and the migration runbook

**Files:**
- Create: `docs/migration-codex-renown.md`
- Modify: `README.md`
- Modify: `README.ko.md`
- Modify: `SECURITY.md`
- Modify: `docs/setup-windows.md`
- Modify: `docs/setup-unix.md`
- Modify: `.github/workflows/render-cards.yml`
- Modify: `.github/workflows/ci.yml`
- Modify: `test/docs.test.mjs`
- Modify: `test/workflows.test.mjs`

**Steps:**

1. Write failing tests for product copy, seven-card layout, trophy row, five themes, alias, stable local contracts, new repository URLs, scheduler path migration, exact path-list staging, and 35-artifact wording.
2. Run `node --test test/docs.test.mjs test/workflows.test.mjs` and confirm old-name/six-card failures.
3. Rewrite English/Korean usage and theme examples, security boundaries, scheduler guidance, and a stop-update-verify-resume migration runbook for every machine.
4. Update workflows to stage only catalog-listed paths.
5. Run docs/workflow tests.
6. Commit as `docs: 제품 전환과 다중 테마 사용법 정리`.

### Task 8: Generate real artifacts and complete quality/visual gates

**Files:**
- Modify: `cards/*.svg`
- Modify local-only: `.ai-agent-playbook/CURRENT.md`
- Modify local-only: `.ai-agent-playbook/workflows/handoffs/2026-07-21-codex-renown-design.md`
- Create local-only: `.ai-agent-playbook/workflows/worklogs/2026-07-22-codex-renown-implementation.md`

**Steps:**

1. Run `npm run render -- --as-of 2026-07-22` and confirm exactly 35 SVGs.
2. Run `npm run check:syntax`, `npm test`, `npm run validate`, and `npm run check:determinism -- --as-of 2026-07-22` with Node 24.
3. Inspect all seven canonical cards and representative cards from every theme in light/dark at GitHub 100% and 49% widths.
4. Verify hierarchy, handle placement, crests, 16 badge states, long values, empty/partial/unknown states, and no clipping.
5. Record actual evidence in ignored playbook files and confirm they remain untracked.
6. Commit generated artifacts as `chore(cards): 계급 카드 산출물 갱신`.

### Task 9: Review, PR, merge, and rename migration

**Files:** No new product files unless review identifies defects.

**Steps:**

1. Use `frontend-ui-polish`, `frontend-accessibility-review`, `ci-quality-gate`, and `finishing-a-development-branch` to review the branch, diff, artifact set, local-only exclusions, action pins, and verification evidence.
2. Push `feat/codex-renown`, create a ready PR against `main` with actual risk, checks, and rendered previews.
3. Wait for hosted CI, fix branch failures, and merge through GitHub.
4. Rename `jukrap/agent-card-tracker` to `jukrap/codex-renown`, update origins, and verify Actions plus canonical/theme raw URLs.
5. Stop schedulers and complete the local root-folder rename last while preserving `.agent-card.local.json` and updating working directories.
6. If Windows holds the active folder open, leave the merged and GitHub-renamed repository intact and hand off the exact final local move commands rather than forcing a destructive move.