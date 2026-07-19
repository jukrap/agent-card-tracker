import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SvgValidationError,
  validateSvgDocument,
} from '../src/render/svg-validator.mjs';

const validSvg = ({ body = '', rootAttributes = '' } = {}) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 200" role="img" aria-labelledby="card-title card-desc" ${rootAttributes}>
  <title id="card-title">Agent usage</title>
  <desc id="card-desc">Daily token usage card</desc>
  ${body}
</svg>`;

test('accepts a minimal accessible static SVG document', () => {
  assert.equal(validateSvgDocument(validSvg()), true);
});

test('accepts the static shapes, values, transforms, and theme CSS used by cards', () => {
  const svg = validSvg({
    body: `
      <style>
        :root { --bg: #ffffff; --fg: rgb(36, 41, 47); color-scheme: light dark; }
        .label, .value { fill: var(--fg); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; font-weight: 600; }
        @media (prefers-color-scheme: dark) {
          :root { --bg: #0d1117; --fg: #c9d1d9; }
          .grid { stroke: #30363d; stroke-width: 1; stroke-dasharray: 2 2; opacity: .8; }
        }
      </style>
      <g id="plot" class="plot grid" transform="translate(10 20)">
        <rect x="0" y="0" width="480" height="160" rx="8" fill="#ffffff" style="stroke: var(--fg); stroke-width: 1"/>
        <circle cx="12" cy="12" r="4" fill="currentColor"/>
        <ellipse cx="24" cy="12" rx="6" ry="4" opacity="0.5"/>
        <line x1="0" y1="80" x2="480" y2="80" stroke="#d0d7de"/>
        <polyline points="0,100 20,80 40,90" fill="none" stroke="#2f81f7"/>
        <polygon points="50,100 60,80 70,100" fill="rgb(47, 129, 247)"/>
        <path d="M 0 120 C 20 100, 40 100, 60 120 Z" fill="none" stroke="#2f81f7"/>
        <text x="12" y="24" class="label" text-anchor="start">토큰 1,234</text>
      </g>`,
  });

  assert.equal(validateSvgDocument(svg, { filePath: 'cards/overview.svg' }), true);
});

test('rejects non-string input and documents above 200 KiB', () => {
  assertSvgError(() => validateSvgDocument(Buffer.from('<svg/>')), 'SVG_INPUT');
  assertSvgError(
    () => validateSvgDocument(validSvg({ body: `<text>${'x'.repeat(205 * 1024)}</text>` })),
    'SVG_SIZE',
  );
});

test('rejects malformed XML and non-SVG roots', () => {
  assertSvgError(
    () => validateSvgDocument('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
    'SVG_XML',
  );
  assertSvgError(
    () => validateSvgDocument('<html xmlns="http://www.w3.org/1999/xhtml"></html>'),
    'SVG_ROOT',
  );
});

test('rejects active and unknown elements with an element rule code', () => {
  for (const element of [
    'script',
    'foreignObject',
    'image',
    'a',
    'use',
    'iframe',
    'object',
    'embed',
    'animate',
    'animateMotion',
    'animateTransform',
    'set',
    'filter',
    'metadata',
  ]) {
    assertSvgError(
      () => validateSvgDocument(validSvg({ body: `<${element}/>` })),
      'SVG_ELEMENT',
    );
  }
});

test('rejects event handlers, links, namespace tricks, and unknown attributes', () => {
  for (const attribute of [
    'onclick="alert(1)"',
    'onload="alert(1)"',
    'href="https://example.com/a"',
    'xlink:href="data:text/html,bad"',
    'data-unknown="value"',
  ]) {
    assertSvgError(
      () => validateSvgDocument(validSvg({ body: `<rect x="0" y="0" width="1" height="1" ${attribute}/>` })),
      attribute.startsWith('on') ? 'SVG_EVENT_ATTRIBUTE' : 'SVG_ATTRIBUTE',
    );
  }
});

test('rejects URI-bearing and unsafe attribute values including url()', () => {
  for (const attribute of [
    'fill="url(#gradient)"',
    'style="fill: url(https://example.com/a.svg#x)"',
    'style="fill: expression(alert(1))"',
    'style="behavior: url(x.htc)"',
  ]) {
    assertSvgError(
      () => validateSvgDocument(validSvg({ body: `<rect x="0" y="0" width="1" height="1" ${attribute}/>` })),
      'SVG_CSS',
    );
  }
});

test('rejects unsafe stylesheet constructs and unsupported at-rules', () => {
  for (const css of [
    '@import "https://example.com/theme.css";',
    '@font-face { font-family: bad; src: url(https://example.com/font.woff2); }',
    '.card { fill: url(#paint); }',
    '.card { fill: expression(alert(1)); }',
    '.card { -moz-binding: url(xbl.xml#x); }',
    '@supports (display: grid) { .card { fill: red; } }',
    '.card { background-image: none; }',
  ]) {
    assertSvgError(
      () => validateSvgDocument(validSvg({ body: `<style>${css}</style>` })),
      'SVG_CSS',
    );
  }
});

test('rejects DOCTYPE, custom entities, processing instructions, comments, and CDATA', () => {
  const cases = [
    ['<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>', 'SVG_DOCTYPE'],
    [validSvg().replace('Agent usage', '&writer;'), 'SVG_ENTITY'],
    [validSvg().replace('<title', '<?unsafe data?><title'), 'SVG_PROCESSING_INSTRUCTION'],
    [validSvg().replace('<title', '<!-- hidden --><title'), 'SVG_COMMENT'],
    [validSvg().replace('Agent usage', '<![CDATA[Agent usage]]>'), 'SVG_CDATA'],
  ];

  for (const [svg, code] of cases) {
    assertSvgError(() => validateSvgDocument(svg), code);
  }
});

test('rejects forbidden control characters while permitting XML whitespace', () => {
  assert.equal(validateSvgDocument(validSvg().replace('Agent usage', 'Agent\tusage\ncard')), true);
  assertSvgError(
    () => validateSvgDocument(validSvg().replace('Agent usage', 'Agent\u0000usage')),
    'SVG_CONTROL_CHARACTER',
  );
  assertSvgError(
    () => validateSvgDocument(validSvg().replace('Agent usage', 'Agent\u0085usage')),
    'SVG_CONTROL_CHARACTER',
  );
});

test('rejects duplicate IDs', () => {
  assertSvgError(
    () => validateSvgDocument(validSvg({ body: '<g id="card-title"/>' })),
    'SVG_DUPLICATE_ID',
  );
});

test('requires an accessible root with viewBox, role, title, desc, and matching labels', () => {
  const cases = [
    validSvg().replace(' viewBox="0 0 500 200"', ''),
    validSvg().replace('viewBox="0 0 500 200"', 'viewBox="0 0 0 200"'),
    validSvg().replace(' role="img"', ''),
    validSvg().replace('role="img"', 'role="presentation"'),
    validSvg().replace(' aria-labelledby="card-title card-desc"', ''),
    validSvg().replace('aria-labelledby="card-title card-desc"', 'aria-labelledby="card-title"'),
    validSvg().replace('<title id="card-title">Agent usage</title>', ''),
    validSvg().replace('<desc id="card-desc">Daily token usage card</desc>', ''),
    validSvg().replace('>Agent usage</title>', '></title>'),
    validSvg().replace('>Daily token usage card</desc>', '></desc>'),
  ];

  for (const svg of cases) {
    assertSvgError(() => validateSvgDocument(svg), 'SVG_ACCESSIBILITY');
  }
});

test('rejects unsafe IDs, classes, numeric geometry, paths, transforms, and text nesting', () => {
  const cases = [
    [validSvg({ body: '<g id="bad id"/>' }), 'SVG_VALUE'],
    [validSvg({ body: '<g class="safe bad$class"/>' }), 'SVG_VALUE'],
    [validSvg({ body: '<rect x="NaN" y="0" width="1" height="1"/>' }), 'SVG_VALUE'],
    [validSvg({ body: '<path d="M0 0 javascript:bad"/>' }), 'SVG_CSS'],
    [validSvg({ body: '<g transform="translate(0); rotate(alert(1))"/>' }), 'SVG_VALUE'],
    [validSvg().replace('Agent usage', '<text>nested</text>'), 'SVG_VALUE'],
  ];

  for (const [svg, code] of cases) {
    assertSvgError(() => validateSvgDocument(svg), code);
  }
});

test('rejects non-finite numbers and negative dimensions', () => {
  for (const svg of [
    validSvg({ body: '<rect x="1e999" y="0" width="1" height="1"/>' }),
    validSvg({ body: '<rect x="0" y="0" width="-1" height="1"/>' }),
    validSvg({ body: '<circle cx="0" cy="0" r="-1"/>' }),
    validSvg({ body: '<polyline points="0,0 1e999,2"/>' }),
    validSvg({ body: '<g transform="translate(1e999 0)"/>' }),
  ]) {
    assertSvgError(() => validateSvgDocument(svg), 'SVG_VALUE');
  }
});

test('errors expose only a rule code and safe file label, never source text or full paths', () => {
  const secret = 'do-not-echo-this-token';

  assert.throws(
    () => validateSvgDocument(validSvg({ body: `<script>${secret}</script>` }), {
      filePath: 'C:\\private\\cards\\overview.svg',
    }),
    (error) => {
      assert.ok(error instanceof SvgValidationError);
      assert.equal(error.code, 'SVG_ELEMENT');
      assert.match(error.message, /SVG_ELEMENT/);
      assert.match(error.message, /overview\.svg/);
      assert.doesNotMatch(error.message, /private|do-not-echo|script/i);
      return true;
    },
  );
});

function assertSvgError(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof SvgValidationError);
    assert.equal(error.code, code);
    return true;
  });
}
