import { TOKEN_RANKS } from '../domain/rank.mjs';
import {
  cardDocument,
  escapeXml,
  formatCompactNumber,
} from './svg.mjs';

const SEAL_X = Object.freeze([16, 112, 208, 304]);

function presentation(rank) {
  if (rank.status === 'unranked') {
    return {
      roman: '—',
      title: 'UNRANKED',
      rarity: 'common',
      currentRank: 0,
      progress: 0,
      progressText: 'Lifetime total required',
    };
  }
  if (rank.maxRank) {
    return {
      roman: rank.current.roman,
      title: rank.current.title.toUpperCase(),
      rarity: rank.current.rarity,
      currentRank: rank.current.rank,
      progress: 100,
      progressText: 'MAX RANK',
    };
  }
  return {
    roman: rank.current.roman,
    title: rank.current.title.toUpperCase(),
    rarity: rank.current.rarity,
    currentRank: rank.current.rank,
    progress: rank.progressPercentage,
    progressText: `${rank.lowerBound ? '≥' : ''}${Math.round(rank.progressPercentage)}% to ${rank.next.title.toUpperCase()} · ${formatCompactNumber(rank.next.threshold)}`,
  };
}

function rankNodes(currentRank) {
  const slot = 284 / TOKEN_RANKS.length;
  return TOKEN_RANKS.map(({ rank }, index) => {
    const x = Math.round((116 + index * slot + 3) * 100) / 100;
    const className = rank === currentRank
      ? 'rank-node-current'
      : rank < currentRank
        ? 'rank-node-unlocked'
        : 'rank-node';
    return `<rect class="${className}" x="${x}" y="121" width="8" height="8" rx="2"/>`;
  });
}

function seal(entry, x) {
  const className = entry.state === 'unlocked'
    ? 'seal-unlocked'
    : entry.state === 'locked'
      ? 'seal-locked'
      : 'seal-unknown';
  const marker = entry.state === 'unlocked' ? '◆' : entry.state === 'locked' ? '◇' : '—';
  return [
    `<rect class="${className}" x="${x}" y="153" width="88" height="26" rx="4"/>`,
    `<text class="meta" x="${x + 44}" y="169" text-anchor="middle">${marker} ${escapeXml(entry.label)}</text>`,
  ].join('\n');
}

export function renderAchievements(statistics) {
  const rank = presentation(statistics.rank);
  const progressWidth = Math.round((rank.progress / 100) * 284 * 100) / 100;
  const body = [
    '<text class="heading" x="16" y="27">Codex Achievements</text>',
    `<text class="subheading" x="16" y="43">${statistics.rank.unlockedCount} / 20 ranks unlocked · lifetime milestones</text>`,
    `<rect class="rarity-${rank.rarity}" x="16" y="55" width="84" height="72" rx="6"/>`,
    `<text class="rank-roman" x="58" y="87" text-anchor="middle">${escapeXml(rank.roman)}</text>`,
    `<text class="rarity-label" x="58" y="108" text-anchor="middle">${escapeXml(rank.title)}</text>`,
    '<text class="label" x="116" y="64">CURRENT TOKEN RANK</text>',
    `<text class="value" x="116" y="87">RANK ${escapeXml(rank.roman)} · ${escapeXml(rank.title)}</text>`,
    `<text class="meta" x="400" y="87" text-anchor="end">${statistics.rank.unlockedCount} / 20</text>`,
    '<rect class="progress-track" x="116" y="99" width="284" height="8" rx="4"/>',
    ...(progressWidth > 0
      ? [`<rect class="progress-fill" x="116" y="99" width="${progressWidth}" height="8" rx="4"/>`]
      : []),
    `<text class="meta" x="116" y="117">${escapeXml(rank.progressText)}</text>`,
    ...rankNodes(rank.currentRank),
    '<line class="divider" x1="16" y1="141" x2="400" y2="141"/>',
    ...statistics.achievements.map((entry, index) => seal(entry, SEAL_X[index])),
  ].join('\n');

  return cardDocument({
    id: 'codex-achievements',
    width: 416,
    height: 190,
    title: 'Codex achievements',
    description: `A 20-rank lifetime token ladder and four personal milestones as of ${statistics.asOf}. Locked and unknown achievements use distinct outlines.`,
    body,
  });
}
