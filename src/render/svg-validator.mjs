import { SaxesParser } from 'saxes';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';
const MAX_SVG_BYTES = 200 * 1024;

const ALLOWED_ELEMENTS = new Set([
  'svg',
  'title',
  'desc',
  'defs',
  'style',
  'g',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
]);

const GLOBAL_ATTRIBUTES = new Set([
  'id',
  'class',
  'style',
  'transform',
  'opacity',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-opacity',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'vector-effect',
  'aria-hidden',
]);

const ELEMENT_ATTRIBUTES = new Map([
  ['svg', new Set(['xmlns', 'viewBox', 'width', 'height', 'role', 'aria-labelledby', 'preserveAspectRatio'])],
  ['style', new Set(['type'])],
  ['rect', new Set(['x', 'y', 'width', 'height', 'rx', 'ry'])],
  ['circle', new Set(['cx', 'cy', 'r'])],
  ['ellipse', new Set(['cx', 'cy', 'rx', 'ry'])],
  ['line', new Set(['x1', 'y1', 'x2', 'y2'])],
  ['polyline', new Set(['points'])],
  ['polygon', new Set(['points'])],
  ['path', new Set(['d', 'pathLength'])],
  ['text', new Set([
    'x', 'y', 'dx', 'dy', 'textLength', 'lengthAdjust', 'text-anchor',
    'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing',
  ])],
  ['tspan', new Set([
    'x', 'y', 'dx', 'dy', 'textLength', 'lengthAdjust', 'text-anchor',
    'dominant-baseline', 'font-family', 'font-size', 'font-weight', 'font-style',
    'letter-spacing',
  ])],
]);

const CSS_PROPERTIES = new Set([
  'color-scheme',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'opacity',
  'shape-rendering',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'visibility',
]);

const NUMERIC_ATTRIBUTES = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'dx', 'dy', 'textLength', 'pathLength', 'font-size',
  'letter-spacing', 'stroke-width', 'stroke-dashoffset',
]);
const NONNEGATIVE_ATTRIBUTES = new Set([
  'r', 'rx', 'ry', 'width', 'height', 'textLength', 'pathLength', 'font-size',
  'stroke-width',
]);
const COLOR_ATTRIBUTES = new Set(['fill', 'stroke']);
const OPACITY_ATTRIBUTES = new Set(['opacity', 'fill-opacity', 'stroke-opacity']);
const NUMBER_SOURCE = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUMBER_PATTERN = new RegExp(`^${NUMBER_SOURCE}(?:px|%)?$`);
const PLAIN_NUMBER_PATTERN = new RegExp(`^${NUMBER_SOURCE}$`);
const FORBIDDEN_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const UNSAFE_REFERENCE_PATTERN = /(?:url\s*\(|expression\s*\(|javascript\s*:|data\s*:|https?\s*:|file\s*:|ftp\s*:|\\)/iu;
const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/u;
const CLASS_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*$/u;

export class SvgValidationError extends Error {
  constructor(code, fileLabel = 'svg-document') {
    super(`${code}: ${fileLabel}`);
    this.name = 'SvgValidationError';
    this.code = code;
    this.fileLabel = fileLabel;
  }
}

export function validateSvgDocument(svg, { filePath } = {}) {
  const fileLabel = safeFileLabel(filePath);
  const fail = (code) => {
    throw new SvgValidationError(code, fileLabel);
  };

  if (typeof svg !== 'string') {
    fail('SVG_INPUT');
  }
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) {
    fail('SVG_SIZE');
  }
  if (FORBIDDEN_CONTROL_PATTERN.test(svg)) {
    fail('SVG_CONTROL_CHARACTER');
  }
  if (/<!DOCTYPE(?:\s|>)/iu.test(svg)) {
    fail('SVG_DOCTYPE');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos);|#[0-9]+;|#x[0-9A-F]+;)/iu.test(svg)) {
    fail('SVG_ENTITY');
  }
  if (/\s(?:href|xlink:href)\s*=/iu.test(svg)) {
    fail('SVG_ATTRIBUTE');
  }
  if (/\son[A-Za-z0-9_.:-]*\s*=/iu.test(svg)) {
    fail('SVG_EVENT_ATTRIBUTE');
  }

  const state = {
    ids: new Set(),
    rootAttributes: null,
    rootSeen: false,
    stack: [],
    title: null,
    desc: null,
  };
  const parser = new SaxesParser({ xmlns: true, position: false });

  parser.on('error', () => fail('SVG_XML'));
  parser.on('doctype', () => fail('SVG_DOCTYPE'));
  parser.on('processinginstruction', () => fail('SVG_PROCESSING_INSTRUCTION'));
  parser.on('comment', () => fail('SVG_COMMENT'));
  parser.on('cdata', () => fail('SVG_CDATA'));
  parser.on('xmldecl', (declaration) => {
    if (declaration.version !== '1.0') {
      fail('SVG_XML');
    }
  });
  parser.on('opentag', (tag) => handleOpenTag(tag, state, fail));
  parser.on('text', (text) => handleText(text, state, fail));
  parser.on('closetag', (tag) => handleCloseTag(tag, state, fail));

  try {
    parser.write(svg).close();
  } catch (error) {
    if (error instanceof SvgValidationError) {
      throw error;
    }
    fail('SVG_XML');
  }

  validateAccessibility(state, fail);
  return true;
}

function handleOpenTag(tag, state, fail) {
  const name = tag.local;
  const isRoot = !state.rootSeen;

  if (isRoot) {
    if (state.stack.length !== 0 || name !== 'svg' || tag.prefix !== '' || tag.uri !== SVG_NAMESPACE) {
      fail('SVG_ROOT');
    }
    state.rootSeen = true;
  } else if (name === 'svg' || tag.prefix !== '' || tag.uri !== SVG_NAMESPACE || !ALLOWED_ELEMENTS.has(name)) {
    fail('SVG_ELEMENT');
  }

  if (!ALLOWED_ELEMENTS.has(name)) {
    fail(isRoot ? 'SVG_ROOT' : 'SVG_ELEMENT');
  }

  const parent = state.stack.at(-1);
  if (parent && ['title', 'desc', 'style'].includes(parent.name)) {
    fail('SVG_VALUE');
  }
  if (parent?.name === 'text' && name !== 'tspan') {
    fail('SVG_VALUE');
  }
  if (['title', 'desc'].includes(name) && (state.stack.length !== 1 || state.stack[0]?.name !== 'svg')) {
    fail('SVG_ACCESSIBILITY');
  }
  if (name === 'style' && !['svg', 'defs'].includes(parent?.name)) {
    fail('SVG_CSS');
  }

  const attributes = validateAttributes(tag, name, isRoot, state, fail);
  if (isRoot) {
    state.rootAttributes = attributes;
  }

  state.stack.push({ name, text: '', attributes });
}

function handleText(text, state, fail) {
  if (FORBIDDEN_CONTROL_PATTERN.test(text)) {
    fail('SVG_CONTROL_CHARACTER');
  }

  const current = state.stack.at(-1);
  if (!current) {
    if (text.trim() !== '') {
      fail('SVG_XML');
    }
    return;
  }

  if (['title', 'desc', 'style', 'text', 'tspan'].includes(current.name)) {
    current.text += text;
    return;
  }
  if (text.trim() !== '') {
    fail('SVG_VALUE');
  }
}

function handleCloseTag(tag, state, fail) {
  const current = state.stack.pop();
  if (!current || current.name !== tag.local) {
    fail('SVG_XML');
  }

  if (current.name === 'style') {
    validateCssStylesheet(current.text, fail);
  }
  if (current.name === 'title' || current.name === 'desc') {
    if ((current.name === 'title' ? state.title : state.desc) !== null) {
      fail('SVG_ACCESSIBILITY');
    }
    const record = {
      id: current.attributes.id,
      text: current.text.trim(),
    };
    if (current.name === 'title') {
      state.title = record;
    } else {
      state.desc = record;
    }
  }
}

function validateAttributes(tag, elementName, isRoot, state, fail) {
  const result = Object.create(null);
  const elementAttributes = ELEMENT_ATTRIBUTES.get(elementName) ?? new Set();

  for (const attribute of Object.values(tag.attributes)) {
    const name = attribute.name;
    const value = attribute.value;
    const isDefaultXmlns = name === 'xmlns'
      && attribute.prefix === ''
      && attribute.uri === XMLNS_NAMESPACE;

    if (/^on/iu.test(name)) {
      fail('SVG_EVENT_ATTRIBUTE');
    }
    if (/^(?:href|xlink:href)$/iu.test(name)) {
      fail('SVG_ATTRIBUTE');
    }
    if ((!isDefaultXmlns && (attribute.prefix !== '' || attribute.uri !== ''))
      || (!GLOBAL_ATTRIBUTES.has(name) && !elementAttributes.has(name))) {
      fail('SVG_ATTRIBUTE');
    }
    if (isDefaultXmlns && (!isRoot || value !== SVG_NAMESPACE)) {
      fail('SVG_ROOT');
    }
    if (FORBIDDEN_CONTROL_PATTERN.test(value)) {
      fail('SVG_CONTROL_CHARACTER');
    }
    if (name !== 'xmlns' && UNSAFE_REFERENCE_PATTERN.test(value)) {
      fail('SVG_CSS');
    }

    validateAttributeValue(name, value, fail);
    if (name === 'id') {
      if (state.ids.has(value)) {
        fail('SVG_DUPLICATE_ID');
      }
      state.ids.add(value);
    }
    result[name] = value;
  }

  return result;
}

function validateAttributeValue(name, value, fail) {
  if (name === 'xmlns') {
    if (value !== SVG_NAMESPACE) fail('SVG_ROOT');
    return;
  }
  if (name === 'id') {
    if (!ID_PATTERN.test(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'class') {
    if (!CLASS_PATTERN.test(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'style') {
    validateCssDeclarations(value, fail);
    return;
  }
  if (name === 'viewBox') {
    if (!isValidViewBox(value)) fail('SVG_ACCESSIBILITY');
    return;
  }
  if (name === 'role') {
    if (value !== 'img') fail('SVG_ACCESSIBILITY');
    return;
  }
  if (name === 'aria-labelledby') {
    if (!isIdList(value)) fail('SVG_ACCESSIBILITY');
    return;
  }
  if (name === 'aria-hidden') {
    if (!['true', 'false'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'type') {
    if (value !== 'text/css') fail('SVG_CSS');
    return;
  }
  if (NUMERIC_ATTRIBUTES.has(name)) {
    const number = parseSvgNumber(value);
    if (number === null || (NONNEGATIVE_ATTRIBUTES.has(name) && number < 0)) fail('SVG_VALUE');
    return;
  }
  if (OPACITY_ATTRIBUTES.has(name)) {
    const number = Number(value);
    if (!PLAIN_NUMBER_PATTERN.test(value.trim()) || number < 0 || number > 1) fail('SVG_VALUE');
    return;
  }
  if (COLOR_ATTRIBUTES.has(name)) {
    if (!isSafeColor(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'points') {
    if (!isNumericList(value, 4, true)) fail('SVG_VALUE');
    return;
  }
  if (name === 'd') {
    const numbers = value.match(new RegExp(NUMBER_SOURCE, 'gu')) ?? [];
    if (!/^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\s-]+$/u.test(value)
      || !/[MmZzLlHhVvCcSsQqTtAa]/u.test(value)
      || numbers.some((number) => !Number.isFinite(Number(number)))) {
      fail('SVG_VALUE');
    }
    return;
  }
  if (name === 'transform') {
    if (!isSafeTransform(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'stroke-dasharray') {
    if (value !== 'none' && !isNumericList(value, 1, false)) fail('SVG_VALUE');
    return;
  }
  if (name === 'stroke-linecap') {
    if (!['butt', 'round', 'square'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'stroke-linejoin') {
    if (!['arcs', 'bevel', 'miter', 'miter-clip', 'round'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'fill-rule') {
    if (!['evenodd', 'nonzero'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'vector-effect') {
    if (!['none', 'non-scaling-stroke'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'text-anchor') {
    if (!['start', 'middle', 'end'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'dominant-baseline') {
    if (!['auto', 'alphabetic', 'central', 'middle', 'text-before-edge', 'text-after-edge', 'hanging'].includes(value)) {
      fail('SVG_VALUE');
    }
    return;
  }
  if (name === 'font-weight') {
    if (!/^(?:normal|bold|[1-9]00)$/u.test(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'font-style') {
    if (!['normal', 'italic', 'oblique'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'font-family') {
    if (!/^[A-Za-z0-9 ,"'_-]{1,256}$/u.test(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'lengthAdjust') {
    if (!['spacing', 'spacingAndGlyphs'].includes(value)) fail('SVG_VALUE');
    return;
  }
  if (name === 'preserveAspectRatio') {
    if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/u.test(value)) fail('SVG_VALUE');
  }
}

function validateAccessibility(state, fail) {
  const root = state.rootAttributes;
  if (!state.rootSeen || state.stack.length !== 0 || !root) {
    fail('SVG_ROOT');
  }
  if (root.xmlns !== SVG_NAMESPACE
    || root.role !== 'img'
    || !isValidViewBox(root.viewBox)
    || !state.title?.id
    || !state.title.text
    || !state.desc?.id
    || !state.desc.text
    || !root['aria-labelledby']) {
    fail('SVG_ACCESSIBILITY');
  }

  const labelledBy = root['aria-labelledby'].trim().split(/\s+/u);
  if (!labelledBy.includes(state.title.id)
    || !labelledBy.includes(state.desc.id)
    || labelledBy.some((id) => !state.ids.has(id))) {
    fail('SVG_ACCESSIBILITY');
  }
}

function validateCssStylesheet(css, fail) {
  validateCssSafety(css, fail);

  const parseRules = (start, nested) => {
    let index = start;
    while (index < css.length) {
      index = skipWhitespace(css, index);
      if (css[index] === '}') {
        if (!nested) fail('SVG_CSS');
        return index + 1;
      }
      if (index >= css.length) {
        if (nested) fail('SVG_CSS');
        return index;
      }

      const openBrace = css.indexOf('{', index);
      if (openBrace < 0 || css.slice(index, openBrace).includes('}')) fail('SVG_CSS');
      const header = css.slice(index, openBrace).trim();
      if (/^@/u.test(header)) {
        if (!/^@media\s*\(\s*prefers-color-scheme\s*:\s*(?:dark|light)\s*\)$/u.test(header)) {
          fail('SVG_CSS');
        }
        index = parseRules(openBrace + 1, true);
        continue;
      }

      validateCssSelector(header, fail);
      const closeBrace = css.indexOf('}', openBrace + 1);
      const nestedBrace = css.indexOf('{', openBrace + 1);
      if (closeBrace < 0 || (nestedBrace >= 0 && nestedBrace < closeBrace)) fail('SVG_CSS');
      validateCssDeclarations(css.slice(openBrace + 1, closeBrace), fail);
      index = closeBrace + 1;
    }
    if (nested) fail('SVG_CSS');
    return index;
  };

  parseRules(0, false);
}

function validateCssSelector(selector, fail) {
  const atom = '(?::root|svg|g|rect|circle|ellipse|line|polyline|polygon|path|text|tspan|[.#][A-Za-z_][A-Za-z0-9_-]*)';
  const selectorPattern = new RegExp(`^${atom}(?:\\s+${atom})*$`, 'u');
  const selectors = selector.split(',').map((item) => item.trim());
  if (selectors.length === 0 || selectors.some((item) => !selectorPattern.test(item))) {
    fail('SVG_CSS');
  }
}

function validateCssDeclarations(css, fail) {
  validateCssSafety(css, fail);
  if (/[{}@]/u.test(css)) fail('SVG_CSS');

  for (const declaration of css.split(';')) {
    if (declaration.trim() === '') continue;
    const colon = declaration.indexOf(':');
    if (colon <= 0 || declaration.indexOf(':', colon + 1) >= 0) fail('SVG_CSS');
    const property = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if ((!CSS_PROPERTIES.has(property) && !/^--[A-Za-z_][A-Za-z0-9_-]{0,63}$/u.test(property))
      || !isSafeCssValue(value)) {
      fail('SVG_CSS');
    }
  }
}

function validateCssSafety(css, fail) {
  if (css.length > 32 * 1024
    || FORBIDDEN_CONTROL_PATTERN.test(css)
    || /\/\*|\*\//u.test(css)
    || /(?:url\s*\(|expression\s*\(|javascript\s*:|data\s*:|https?\s*:|file\s*:|ftp\s*:|@import|@font-face|-moz-binding|behavior\s*:|\\)/iu.test(css)) {
    fail('SVG_CSS');
  }
}

function isSafeCssValue(value) {
  if (!value || !/^[A-Za-z0-9_#.,%()\s"'+\-*/]+$/u.test(value)) return false;
  if ((value.match(/"/gu)?.length ?? 0) % 2 !== 0 || (value.match(/'/gu)?.length ?? 0) % 2 !== 0) return false;

  const allowedFunctions = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'var', 'calc', 'min', 'max', 'clamp']);
  for (const match of value.matchAll(/([A-Za-z_][A-Za-z0-9_-]*)\s*\(/gu)) {
    if (!allowedFunctions.has(match[1])) return false;
  }
  return true;
}

function isValidViewBox(value) {
  if (typeof value !== 'string') return false;
  const values = value.trim().split(/[\s,]+/u);
  if (values.length !== 4 || values.some((part) => !PLAIN_NUMBER_PATTERN.test(part))) return false;
  const numbers = values.map(Number);
  const [, , width, height] = numbers;
  return numbers.every(Number.isFinite) && width > 0 && height > 0;
}

function isIdList(value) {
  const ids = value.trim().split(/\s+/u);
  return ids.length >= 2 && ids.every((id) => ID_PATTERN.test(id));
}

function isSafeColor(value) {
  return /^(?:none|transparent|currentColor|[A-Za-z]+|#[0-9A-Fa-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,%\s+-]+\)|var\(--[A-Za-z_][A-Za-z0-9_-]*\))$/u.test(value);
}

function isNumericList(value, minimumCount, requireEven) {
  if (!/^[0-9eE+.,\s-]+$/u.test(value)) return false;
  const parts = value.trim().split(/[\s,]+/u).filter(Boolean);
  return parts.length >= minimumCount
    && (!requireEven || parts.length % 2 === 0)
    && parts.every((part) => PLAIN_NUMBER_PATTERN.test(part) && Number.isFinite(Number(part)));
}

function isSafeTransform(value) {
  let remaining = value.trim();
  let transformations = 0;
  const arities = new Map([
    ['matrix', [6]],
    ['translate', [1, 2]],
    ['scale', [1, 2]],
    ['rotate', [1, 3]],
    ['skewX', [1]],
    ['skewY', [1]],
  ]);

  while (remaining !== '') {
    const match = /^(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*/u.exec(remaining);
    if (!match) return false;
    const values = match[2].trim().split(/[\s,]+/u).filter(Boolean);
    if (!arities.get(match[1]).includes(values.length)
      || values.some((part) => !PLAIN_NUMBER_PATTERN.test(part) || !Number.isFinite(Number(part)))) {
      return false;
    }
    remaining = remaining.slice(match[0].length);
    transformations += 1;
  }
  return transformations > 0;
}

function skipWhitespace(text, start) {
  let index = start;
  while (/\s/u.test(text[index] ?? '')) index += 1;
  return index;
}

function parseSvgNumber(value) {
  const normalized = value.trim();
  if (!NUMBER_PATTERN.test(normalized)) return null;
  const number = Number(normalized.replace(/(?:px|%)$/u, ''));
  return Number.isFinite(number) ? number : null;
}

function safeFileLabel(filePath) {
  if (typeof filePath !== 'string') return 'svg-document';
  const basename = filePath.split(/[\\/]/u).at(-1);
  return basename && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.svg$/iu.test(basename)
    ? basename
    : 'svg-document';
}
