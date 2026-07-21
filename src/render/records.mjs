import {
  cardDocument,
  escapeXml,
  metricText,
} from './svg.mjs';

const RECORDS = Object.freeze([
  { key: 'peakDay', label: 'PEAK DAY', x: 16, labelY: 66, valueY: 91, detailY: 108 },
  { key: 'best7', label: 'BEST 7-DAY RUN', x: 224, labelY: 66, valueY: 91, detailY: 108 },
  { key: 'best30', label: 'BEST 30-DAY RUN', x: 16, labelY: 136, valueY: 161, detailY: 178 },
  { key: 'bestMonth', label: 'BEST FULL MONTH', x: 224, labelY: 136, valueY: 161, detailY: 178 },
]);

function detail(record, key) {
  if (record.startDate === null || record.endDate === null) {
    return 'Not enough complete history';
  }
  if (key === 'peakDay') {
    return record.startDate;
  }
  if (key === 'bestMonth') {
    return record.startDate.slice(0, 7);
  }
  return `${record.startDate} → ${record.endDate}`;
}

function recordBlock(statistics, definition) {
  const record = statistics.records[definition.key];
  const metric = {
    value: record.value,
    coverage: record.coverage,
    lowerBound: record.lowerBound,
  };
  return [
    `<text class="label" x="${definition.x}" y="${definition.labelY}">${escapeXml(definition.label)}</text>`,
    `<text class="value" x="${definition.x}" y="${definition.valueY}">${escapeXml(metricText(metric))}</text>`,
    `<text class="meta" x="${definition.x}" y="${definition.detailY}">${escapeXml(detail(record, definition.key))}</text>`,
  ].join('\n');
}

export function renderRecords(statistics) {
  const body = [
    '<text class="heading" x="16" y="27">Codex Personal Records</text>',
    `<text class="subheading" x="16" y="43">Best complete account-calendar windows · through ${escapeXml(statistics.asOf)}</text>`,
    '<line class="divider" x1="208" y1="55" x2="208" y2="179"/>',
    '<line class="divider" x1="16" y1="119" x2="400" y2="119"/>',
    ...RECORDS.map((definition) => recordBlock(statistics, definition)),
  ].join('\n');

  return cardDocument({
    id: 'codex-personal-records',
    width: 416,
    height: 190,
    title: 'Codex personal records',
    description: `Peak day, best seven-day and thirty-day windows, and best complete calendar month through ${statistics.asOf}.`,
    body,
  });
}
