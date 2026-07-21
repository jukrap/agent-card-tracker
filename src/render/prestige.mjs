function coordinate(value) {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

export function renderContainedPrestige({
  width,
  height,
  inset = 8,
  length = 20,
} = {}) {
  if (![width, height, inset, length].every(Number.isFinite)
    || width < 64
    || height < 64
    || inset < 1
    || length < 4
    || (inset + length) >= (width / 2)
    || (inset + length) >= (height / 2)) {
    throw new TypeError('prestige geometry is invalid');
  }

  const left = coordinate(inset);
  const right = coordinate(width - inset);
  const top = coordinate(inset);
  const bottom = coordinate(height - inset);
  const innerLeft = coordinate(inset + length);
  const innerRight = coordinate(width - inset - length);
  const innerTop = coordinate(inset + length);
  const innerBottom = coordinate(height - inset - length);
  return [
    '<g class="contained-prestige">',
    `<path class="prestige-corner" d="M${left} ${innerTop}V${top}H${innerLeft}"/>`,
    `<path class="prestige-corner" d="M${innerRight} ${top}H${right}V${innerTop}"/>`,
    `<path class="prestige-corner" d="M${innerLeft} ${bottom}H${left}V${innerBottom}"/>`,
    `<path class="prestige-corner" d="M${innerRight} ${bottom}H${right}V${innerBottom}"/>`,
    '</g>',
  ].join('');
}
