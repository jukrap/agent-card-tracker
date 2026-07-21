import {
  cardDocument,
  escapeXml,
  formatCompactNumber,
  metricText,
} from './svg.mjs';

function presentation(rank) {
  if (rank.status === 'unranked') {
    return {
      roman: '—',
      title: 'UNRANKED',
      rarity: 'common',
      progress: 0,
      progressText: 'Lifetime total required',
    };
  }
  if (rank.maxRank) {
    return {
      roman: rank.current.roman,
      title: rank.current.title.toUpperCase(),
      rarity: rank.current.rarity,
      progress: 100,
      progressText: 'MAX RANK',
    };
  }
  return {
    roman: rank.current.roman,
    title: rank.current.title.toUpperCase(),
    rarity: rank.current.rarity,
    progress: rank.progressPercentage,
    progressText: `${rank.lowerBound ? '≥' : ''}${Math.round(rank.progressPercentage)}% to ${rank.next.title.toUpperCase()} · ${formatCompactNumber(rank.next.threshold)}`,
  };
}

export function renderCompact(statistics) {
  const rank = presentation(statistics.rank);
  const progressWidth = Math.round((rank.progress / 100) * 304 * 100) / 100;
  const total = metricText(statistics.lifetime.totalTokens);
  const body = [
    `<rect class="rarity-${rank.rarity}" x="16" y="16" width="62" height="64" rx="6"/>`,
    `<text class="rank-roman" x="47" y="54" text-anchor="middle">${escapeXml(rank.roman)}</text>`,
    `<text class="label" x="94" y="25">CODEX · RANK ${escapeXml(rank.roman)} ${escapeXml(rank.title)}</text>`,
    `<text class="rank-title" x="94" y="52">${escapeXml(total)} TOKENS</text>`,
    '<rect class="progress-track" x="94" y="63" width="304" height="7" rx="3"/>',
    ...(progressWidth > 0
      ? [`<rect class="progress-fill" x="94" y="63" width="${progressWidth}" height="7" rx="3"/>`]
      : []),
    `<text class="meta" x="94" y="84">${escapeXml(rank.progressText)}</text>`,
    `<text class="meta" x="400" y="84" text-anchor="end">Updated ${escapeXml(statistics.asOf)}</text>`,
  ].join('\n');

  return cardDocument({
    id: 'codex-rank-badge',
    width: 416,
    height: 96,
    title: 'Codex rank badge',
    description: `Compact Codex lifetime token total and lifetime-based rank as of ${statistics.asOf}.`,
    body,
  });
}
