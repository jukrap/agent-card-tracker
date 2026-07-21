import { TOKEN_RANKS } from '../domain/rank.mjs';
import { PUBLIC_HANDLE } from '../product.mjs';
import { renderCrest, renderUnrankedCrest } from './crest.mjs';
import { renderAchievementIcon } from './icons.mjs';
import { renderContainedPrestige } from './prestige.mjs';
import {
  cardDocument,
  escapeXml,
  formatCompactNumber,
} from './svg.mjs';

const BADGE_X = Object.freeze([16, 112, 208, 304]);

function presentation(rank) {
  if (rank.status === 'unranked') {
    return {
      roman: '—', title: 'UNRANKED', currentRank: 0, progress: 0,
      progressText: 'Lifetime total required',
    };
  }
  if (rank.maxRank) {
    return {
      roman: rank.current.roman,
      title: rank.current.title.toUpperCase(),
      currentRank: rank.current.rank,
      progress: 100,
      progressText: 'MAX RANK',
    };
  }
  return {
    roman: rank.current.roman,
    title: rank.current.title.toUpperCase(),
    currentRank: rank.current.rank,
    progress: rank.progressPercentage,
    progressText: `${rank.lowerBound ? '≥' : ''}${Math.round(rank.progressPercentage)}% to ${rank.next.title.toUpperCase()} · ${formatCompactNumber(rank.next.threshold)}`,
  };
}

function rankNodes(currentRank) {
  const slot = 302 / TOKEN_RANKS.length;
  return TOKEN_RANKS.map(({ rank }, index) => {
    const x = Math.round((98 + index * slot + 3) * 100) / 100;
    const className = rank === currentRank
      ? 'rank-node-current'
      : rank < currentRank
        ? 'rank-node-unlocked'
        : 'rank-node';
    return `<rect class="${className}" x="${x}" y="119" width="8" height="8" rx="2"/>`;
  });
}

function representativeBadge(entry, x) {
  const stateClass = `seal-${entry.state}`;
  const marker = entry.state === 'unlocked' ? '◆' : entry.state === 'locked' ? '◇' : '—';
  return [
    `<rect class="representative-badge ${stateClass}" x="${x}" y="148" width="88" height="32" rx="5"/>`,
    `<g class="achievement-state-${entry.state}">${renderAchievementIcon(entry.iconId, { x: x + 5, y: 153, size: 18 })}</g>`,
    `<text class="badge-label" x="${x + 27}" y="162">${escapeXml(entry.label)}</text>`,
    `<text class="meta" x="${x + 27}" y="174">${marker} ${escapeXml(entry.category.toUpperCase())}</text>`,
  ].join('\n');
}

export function renderAchievements(statistics, {
  theme = 'github',
  identity = PUBLIC_HANDLE,
} = {}) {
  if (!Array.isArray(statistics.achievementRepresentatives)
    || statistics.achievementRepresentatives.length !== 4) {
    throw new TypeError('rank achievements require four representatives');
  }
  const rank = presentation(statistics.rank);
  const progressWidth = Math.round((rank.progress / 100) * 302 * 100) / 100;
  const crest = statistics.rank.status === 'ranked'
    ? renderCrest(statistics.rank.current.rank, { x: 16, y: 55, size: 64 })
    : renderUnrankedCrest({ x: 16, y: 55, size: 64 });
  const body = [
    renderContainedPrestige({ width: 416, height: 190 }),
    `<text class="heading" x="16" y="27">CODEX RENOWN · ${escapeXml(identity)}</text>`,
    `<text class="subheading" x="16" y="43">RANK ACHIEVEMENTS · ${statistics.rank.unlockedCount} / 20 ranks unlocked</text>`,
    crest,
    '<text class="label" x="98" y="63">CURRENT TOKEN RANK</text>',
    `<text class="value" x="98" y="87">RANK ${escapeXml(rank.roman)} · ${escapeXml(rank.title)}</text>`,
    '<rect class="progress-track" x="98" y="98" width="302" height="8" rx="4"/>',
    ...(progressWidth > 0
      ? [`<rect class="progress-fill" x="98" y="98" width="${progressWidth}" height="8" rx="4"/>`]
      : []),
    `<text class="meta" x="98" y="116">${escapeXml(rank.progressText)}</text>`,
    ...rankNodes(rank.currentRank),
    '<line class="divider" x1="16" y1="138" x2="400" y2="138"/>',
    ...statistics.achievementRepresentatives.map((entry, index) => (
      representativeBadge(entry, BADGE_X[index])
    )),
  ].join('\n');

  return cardDocument({
    id: 'codex-renown-achievements',
    width: 416,
    height: 190,
    theme,
    title: `Codex Renown rank achievements for ${identity}`,
    description: `Current crest, twenty-rank lifetime ladder, and four representative personal milestones as of ${statistics.asOf}.`,
    body,
  });
}