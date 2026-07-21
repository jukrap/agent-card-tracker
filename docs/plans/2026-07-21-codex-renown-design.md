# Codex Renown design

Status: Final design approved for implementation on 2026-07-22. Product identity, public copy, iconography, achievement surfaces and catalog, contained rarity treatment, theme family, and rename compatibility scope are approved.

Last updated: 2026-07-21

## Intent

Codex Renown turns a user's account-wide Codex token history into compact, deterministic GitHub profile cards. It should make cumulative usage feel personal and collectible through ranks, crests, records, and milestones without presenting token volume as productivity, work quality, or a global leaderboard.

The primary surface remains a set of static SVG images embedded in a GitHub profile README. The design must feel native beside GitHub contribution graphs and repository cards while adding a restrained RPG identity.

## Approved public copy

- English tagline: `Your Codex usage, told through milestones.`
- Korean tagline: `Codex 사용량을 마일스톤으로 보여줍니다.`
- English disclaimer: `Codex Renown is an unofficial community project. It is not affiliated with or endorsed by OpenAI.`
- Korean disclaimer: `Codex Renown은 비공식 커뮤니티 프로젝트이며 OpenAI와 제휴하거나 OpenAI의 보증을 받지 않습니다.`
- The tagline appears in the README title block and may be reused as the repository description. It is not repeated as visible copy inside the compact SVG cards.
- The disclaimer appears near the first product description in `README.md` and `README.ko.md`, with the same third-party boundary carried into `SECURITY.md`.
- SVG `<title>` and `<desc>` remain factual and accessibility-oriented. They may identify the card as unofficial but do not carry marketing copy.
- Product copy must not describe token volume as productivity, quality, expertise, percentile, or competitive standing.

## Current baseline

- Public schema v2 contains Codex-only device snapshots and account profile candidates.
- A fresh App Server profile is authoritative; after 48 hours the renderer falls back to summed device observations and marks lifetime values as lower bounds.
- Six public URLs exist: `overview.svg`, `achievements.svg`, `records.svg`, `trends.svg`, `activity.svg`, and `compact.svg`.
- The current live account is Rank XV, Mythic, with about 19.4B lifetime tokens and 62% progress toward Ascendant at 25B.
- Current rank presentation uses a rarity-colored rectangle and Roman numeral. Current milestone seals use text markers rather than distinct icons.

## Confirmed product decisions

### Name

- Visible product name: **Codex Renown**.
- Repository/folder rename target: `codex-renown`; execution is intentionally deferred until the design and migration plan are complete.
- Public documentation must identify the project as an unofficial, third-party Codex usage visualization and must not imply OpenAI sponsorship or endorsement.

### Public identity

- Cards display the GitHub repository owner handle, currently `@jukrap`.
- The handle is derived deterministically from the validated target repository identity, not scraped from Codex account data and not accepted from raw logs.
- No email, account display name, hostname, or private identity field is collected.
- Identity placement uses the **Identity anchors only** model:
  - `overview.svg`: the top eyebrow reads `CODEX RENOWN · @jukrap`.
  - `achievements.svg`: `@jukrap` appears once in the compact header metadata beside the unlocked count.
  - `trophy-case.svg`: `@jukrap` is the right-aligned owner anchor in the top header.
  - `compact.svg`: the leading identity line reads `@jukrap · RANK XV MYTHIC` for the current baseline.
  - `records.svg`, `trends.svg`, and `activity.svg` do not repeat the handle.
- If a valid repository owner cannot be established, the handle is omitted rather than inferred from local or account metadata.

### Visual direction

- Direction: **Primer-native Heraldry**.
- Icons follow a 16px/24px optical grid, 1.5px stroke, round caps and joins, restrained one-pixel corner radii, and flat 2D construction.
- Icons supplement Roman numerals and text; color and icon silhouette are never the only source of meaning.
- Final card assets are inline deterministic SVG paths. Generated transparent PNG files may be used only for concept exploration, not as runtime card assets.
- No gradients, glow, drop shadows, textures, external fonts, external images, animation, or network-loaded resources.

## Style dials

- Product type: developer profile widget plus compact analytics surface.
- Visual variance: medium. The crest system may be memorable, but card layout remains conventional and scannable.
- Motion intensity: none. Cards are deterministic static SVG.
- Visual density: medium-high. Metrics remain compact enough for GitHub's 49% two-column layout.
- Geometry: small-radius, border-first, technical, and flat.
- Typography: system UI plus monospace for exact token values and compact technical metadata.
- Color: GitHub-neutral surfaces with one rarity accent at a time.

## Approved theme family

The canonical seven URLs use the GitHub theme. Four optional theme families are published as flat, deterministic filename variants so GitHub profile READMEs can select them without a server or query-string endpoint:

| Theme | Intent | Filename example |
| --- | --- | --- |
| GitHub | Canonical neutral Primer-adjacent palette | `overview.svg` |
| Midnight | Blue-indigo technical palette | `overview-midnight.svg` |
| Aurora | Teal-cyan activity palette | `overview-aurora.svg` |
| Ember | Amber-orange high-energy palette | `overview-ember.svg` |
| Monochrome | Low-chroma black, white, and slate palette | `overview-monochrome.svg` |

Each theme has light and dark color-scheme tokens inside the static SVG. Theme selection may change surfaces, charts, and activity colors, but never rank rarity semantics, achievement state semantics, layout, text, dimensions, or data. The renderer publishes seven canonical files plus 28 optional variants, for 35 static SVG artifacts total. No gradient, image, font, animation, network resource, query endpoint, or additional validator directory is introduced.

## Approved rank crest system

Every rank has a unique 24px central glyph. Five rarity frame families communicate progression through silhouette and keylines, while one to four bottom pips show progression within the current rarity band.

| Rarity | Ranks | Frame progression | Central glyph progression |
| --- | --- | --- | --- |
| Common | I–IV | Single border badge | Spark, Key, Book, Code |
| Uncommon | V–VIII | Small shield with doubled lower keyline | Compass, Map, Shield, Shield Check |
| Rare | IX–XII | Hex crest with restrained side tabs | Gem, Trophy, Star, Banner |
| Epic | XIII–XVI | Crown notch with four corner marks | Dominion, Radiant Gem, Mythic Star, Ascending Halo |
| Legendary | XVII–XX | Double shield with short outer rays | Infinity, Crown, Eternal Orbit, Transcendent Sun |

The current Rank XV Mythic crest uses the Epic frame, three progression pips, and an asymmetric eight-direction Mythic Star. The same crest primitive is shared by overview, achievements, and compact cards.

## Accessibility and state rules

- Every meaningful icon has an adjacent text label or an accessible text equivalent in the card title/description.
- Decorative icon paths are not individually announced.
- Meaningful foreground icons maintain at least 3:1 contrast; all ordinary text maintains at least 4.5:1 contrast.
- Locked achievements use outline treatment; unknown states use dashed outline; unlocked states use fill plus a check marker.
- Partial and lower-bound values continue to use `≥` and explicit text.
- Light and dark themes use the same geometry and information hierarchy.

## Asset strategy

Image generation can produce a concept sheet for the five frame families, 20 glyphs, and achievement badges. Selected concepts must then be redrawn on the approved SVG grid and stored as project-owned path data. The renderer should expose reusable crest and icon primitives rather than copy path markup across cards.

Using inline vectors preserves theme adaptation, small-size sharpness, deterministic output, validator safety, and repository-only hosting. Introducing `<image>` or base64 PNG data into public cards is out of scope.

## Approved achievement surfaces

- `achievements.svg` remains a 416px paired card. It shows the current rank crest, rank progress, and four representative achievement badges for fast profile scanning.
- A new optional full-width `trophy-case.svg` shows the complete achievement collection with category grouping, unlocked count, locked thresholds, and unknown coverage states.
- The compact card selects one representative achievement per approved category rather than attempting to show the entire catalog.
- The trophy case uses real adjacent labels; it does not depend on hover tooltips that may be unavailable in a GitHub profile README.
- Existing six card filenames remain stable. `trophy-case.svg` is an additive seventh URL.
- README's default layout remains overview at full width and paired cards at 49%. The trophy case is documented as an optional full-width row below achievements and records.
- The approved catalog contains 16 achievements in four categories. The compact card selects the highest unlocked achievement in each category, or the first unresolved achievement when none is unlocked.

## Approved achievement catalog

The full-width trophy case uses four category columns with four labeled badges each. The compact achievements card shows the highest unlocked badge from each category. If a category has no confirmed unlock, it shows the first unresolved badge using its locked or unknown treatment.

| Category | Achievement | Condition | Icon metaphor |
| --- | --- | ---: | --- |
| Renown | Billion Club | Lifetime 1B | Token Stack |
| Renown | Mythic Realm | Lifetime 10B | Mythic Star |
| Renown | Sovereign Scale | Lifetime 100B | Crown |
| Renown | Transcendent Trillion | Lifetime 1T | Transcendent Sun |
| Momentum | Heavy Day | Peak day 250M | Bolt |
| Momentum | Billion Day | Peak day 1B | Radiant Token |
| Momentum | Seven-Day Siege | Best complete 7-day window 5B | Calendar Shield |
| Momentum | Ten-Billion Month | Best complete calendar month 10B | Crowned Calendar |
| Consistency | Weekwalker | 7-day streak | Flame |
| Consistency | Monthbound | 30-day streak | Chain |
| Consistency | Iron Century | 100-day streak | Shield Clock |
| Consistency | Yearlong Signal | 365-day streak | Infinity Signal |
| Journey | First Expedition | 10 active days | Footsteps |
| Journey | Trailblazer | 50 active days | Route |
| Journey | Active Centurion | 100 active days | Calendar Check |
| Journey | Year of Code | 365 active days | Orbit Calendar |

Achievement evaluation follows the same coverage contract as statistics. A complete metric below its threshold is Locked. An incomplete lower-bound metric above the threshold is confidently Unlocked; when it remains below the threshold it is Unknown rather than Locked. Unknown uses a dashed outline, Locked uses a solid outline, and Unlocked uses fill plus a check marker. Unlock dates are not displayed because the current public data cannot prove them for every metric.

At the 2026-07-21 baseline, about 10 of 16 achievements are unlocked. The representative compact set is Mythic Realm, Seven-Day Siege, Monthbound, and Active Centurion.

## Approved card-wide rarity treatment

The selected model is **Contained Prestige**. GitHub-neutral backgrounds, ordinary borders, typography, chart colors, and data-state colors stay stable at every rank. Rarity enhancement is confined to identity decoration and never turns the entire card border into a colored game frame.

- Common: 32px single accent rail with the plain crest frame.
- Uncommon: 48px rail plus one restrained keyline tick.
- Rare: 64px rail plus paired header ticks and the hex crest tabs.
- Epic: 96px rail plus paired crest-region corner marks and the crown-notch frame.
- Legendary: 128px double rail plus four short ray notches around the crest region.
- Unranked or unknown lifetime: neutral dashed rail with no prestige ornament.

Overview, achievements, trophy case, and compact cards use the full contained-prestige treatment. Records, trends, and activity use only the short header rail so their analytical colors and chart semantics remain unchanged. No rarity level changes card dimensions, text positions, background color, ordinary border color, or metric meaning.

## Approved rename and compatibility scope

The selected model is **Progressive full rename with compatibility**:

- GitHub repository: `jukrap/agent-card-tracker` → `jukrap/codex-renown`.
- Local folder: `agent-card-tracker` → `codex-renown`.
- npm package name: `agent-card-tracker` → `codex-renown`.
- Primary CLI binary: `agent-card` → `codex-renown`.
- Compatibility CLI alias: `agent-card` remains available until a separate deprecation plan is explicitly approved.
- Stable local contracts remain unchanged: `.agent-card.local.json`, `AGENT_CARD_CODEX_BIN`, `.git/agent-card-sync.lock`, and existing temporary-file prefixes.
- Existing device identity, writer key, snapshots, account profile candidate, card filenames, schema v2, and npm script names remain compatible and require no data reset.
- Existing scheduler task or service labels may remain unchanged. Only their repository working directory and commands that embed the old path must be updated.

Renaming remains a separate, explicit migration after final design approval and acceptance of an implementation plan. The migration must update at least:

- GitHub repository name and local folder name.
- Local `origin` URL and validated `TARGET_REPOSITORY` identity.
- README clone commands, raw SVG URLs, badges, alt text, and security documentation.
- Scheduler working directories on every participating computer.
- Tests, fixtures, workflow assertions, recovery commands, and local playbook references.
- Profile README image URLs, even where GitHub provides repository redirects.
- Final CI, render workflow, `npm run profile`, `npm run sync`, and seven raw SVG checks after the rename.

The six existing card filenames remain stable and `trophy-case.svg` is added as the seventh. Removing the legacy CLI alias or renaming any stable local contract requires a later breaking-change decision.

## Design decision status

No section-level design questions remain. The user granted final approval on 2026-07-22 and requested implementation, Git/PR/merge completion, and multiple static theme choices.

## Non-goals

- No percentile, global ranking, competitive leaderboard, or productivity claim.
- No prompt, response, project, session identity, or private account metadata publication.
- No hosted image service, custom server, dynamic endpoint, or paid infrastructure.
- Implementation follows the separate execution plan and preserves every compatibility and security boundary in this design.

## Reference evidence

- Primer Octicons design guidelines: <https://primer.style/octicons/design-guidelines/>
- Primer Octicons usage and accessibility guidelines: <https://primer.style/octicons/usage-guidelines>
- OpenAI design and marks guidance: <https://openai.com/brand/>
- GitHub repository rename behavior: <https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository>
- GitHub profile README behavior: <https://docs.github.com/en/account-and-profile/concepts/personal-profile>

## Resume point

Execute `docs/plans/2026-07-22-codex-renown-implementation.md` in the isolated `feat/codex-renown` worktree, then complete review, PR, merge, repository rename, and the local-folder migration runbook.
