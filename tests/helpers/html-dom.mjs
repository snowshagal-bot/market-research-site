// A small, browser-faithful HTML document for tests, so the publisher's real
// detectors (assets/admin.js) can read real report files in Node, where there
// is no DOMParser.
//
// It keeps the rules the detectors depend on:
// - textContent is the concatenated text, and no tag adds a space of its own;
// - <br> is an element, so a detector can replace it on a clone;
// - void elements, raw-text elements (script/style), RCDATA (title/textarea),
//   comments and the implied end of <p>/<li> are handled as a browser does;
// - entities are decoded in text and attribute values;
// - querySelector returns the first match in document order for a selector
//   list, with type, class, attribute ([a], [a="v"], [a*="v"], [a^="v"],
//   [a$="v"], [a~="v"]) selectors and descendant / child combinators.
// It is not a general HTML parser; anything outside that stays out of scope.

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW_TEXT = new Set(['script', 'style']);
const RCDATA = new Set(['title', 'textarea']);
const CLOSES_P = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '·', rarr: '→', larr: '←', nearr: '↗', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', times: '×', bull: '•' };

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(NAMED, body.toLowerCase()) ? NAMED[body.toLowerCase()] : whole;
  });
}

class TextNode {
  constructor(data) { this.nodeType = 3; this.data = data; this.parentNode = null; }
  get textContent() { return this.data; }
  cloneNode() { return new TextNode(this.data); }
  replaceWith(...nodes) { replaceNode(this, nodes); }
}

class ElementNode {
  constructor(name, attributes = new Map()) {
    this.nodeType = 1;
    this.localName = name;
    this.tagName = name.toUpperCase();
    this.attributes = attributes;
    this.childNodes = [];
    this.parentNode = null;
  }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  get className() { return this.getAttribute('class') || ''; }
  get content() { return this.localName === 'meta' ? this.getAttribute('content') ?? '' : undefined; }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  cloneNode(deep = false) {
    const copy = new ElementNode(this.localName, new Map(this.attributes));
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  replaceWith(...nodes) { replaceNode(this, nodes); }
  matches(selector) { return parseSelectorList(selector).some(complex => matchesComplex(this, complex)); }
  querySelectorAll(selector) {
    const list = parseSelectorList(selector);
    const found = [];
    walk(this, element => { if (list.some(complex => matchesComplex(element, complex))) found.push(element); });
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function replaceNode(node, replacements) {
  const parent = node.parentNode;
  if (!parent) return;
  const nodes = replacements.map(item => (typeof item === 'string' ? new TextNode(item) : item));
  const index = parent.childNodes.indexOf(node);
  nodes.forEach(item => { item.parentNode = parent; });
  parent.childNodes.splice(index, 1, ...nodes);
  node.parentNode = null;
}

function walk(root, visit) {
  for (const child of root.childNodes) {
    if (child.nodeType !== 1) continue;
    visit(child);
    walk(child, visit);
  }
}

/* ------------------------------------------------------------- parsing */

function parseAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3] ?? match[4] ?? ''));
  }
  return attributes;
}

export function parseHtml(html) {
  const root = new ElementNode('#document');
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const closeTo = (name) => {
    for (let i = stack.length - 1; i > 0; i -= 1) {
      if (stack[i].localName === name) { stack.length = i; return true; }
    }
    return false;
  };
  const token = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  let last = 0;
  let match;
  const text = (value) => { if (value) current().appendChild(new TextNode(decodeEntities(value))); };
  while ((match = token.exec(html))) {
    text(html.slice(last, match.index));
    last = token.lastIndex;
    const [whole, endName, startName, attributeSource, selfClosing] = match;
    if (whole.startsWith('<!')) continue;
    if (endName) { closeTo(endName.toLowerCase()); continue; }
    const name = startName.toLowerCase();
    if (current().localName === 'p' && CLOSES_P.has(name)) stack.pop();
    if (name === 'li') closeListItem(stack);
    const element = new ElementNode(name, parseAttributes(attributeSource || ''));
    current().appendChild(element);
    if (VOID.has(name) || selfClosing) continue;
    if (RAW_TEXT.has(name) || RCDATA.has(name)) {
      const end = new RegExp(`</${name}\\s*>`, 'ig');
      end.lastIndex = last;
      const close = end.exec(html);
      const body = html.slice(last, close ? close.index : html.length);
      if (body) element.appendChild(new TextNode(RCDATA.has(name) ? decodeEntities(body) : body));
      last = close ? end.lastIndex : html.length;
      token.lastIndex = last;
      continue;
    }
    stack.push(element);
  }
  text(html.slice(last));
  return makeDocument(root);
}

function closeListItem(stack) {
  for (let i = stack.length - 1; i > 0; i -= 1) {
    const name = stack[i].localName;
    if (name === 'li') { stack.length = i; return; }
    if (name === 'ul' || name === 'ol') return;
  }
}

function makeDocument(root) {
  const first = name => root.querySelector(name);
  return {
    nodeType: 9,
    childNodes: root.childNodes,
    documentElement: first('html'),
    body: first('body'),
    head: first('head'),
    get title() { return (first('title')?.textContent || '').replace(/[\t\n\f\r ]+/g, ' ').trim(); },
    querySelector: selector => root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector)
  };
}

/* ----------------------------------------------------------- selectors */

const selectorCache = new Map();

function splitTopLevel(source, separator) {
  const parts = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    else if (ch === separator && depth === 0) { parts.push(source.slice(start, i)); start = i + 1; }
  }
  parts.push(source.slice(start));
  return parts;
}

function parseCompound(source) {
  const compound = { tag: '', classes: [], attributes: [] };
  const pattern = /^([a-zA-Z][\w-]*|\*)|\.([\w-]+)|#([\w-]+)|\[\s*([\w:-]+)\s*(?:([*^$~|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;
  let match, consumed = 0;
  while ((match = pattern.exec(source))) {
    if (match.index !== consumed) throw new Error(`Unsupported selector: ${source}`);
    consumed = pattern.lastIndex;
    if (match[1]) compound.tag = match[1] === '*' ? '' : match[1].toLowerCase();
    else if (match[2]) compound.classes.push(match[2]);
    else if (match[3]) compound.attributes.push({ name: 'id', op: '=', value: match[3] });
    else compound.attributes.push({ name: match[4].toLowerCase(), op: match[5] || '', value: match[6] ?? match[7] ?? match[8] ?? '' });
  }
  if (consumed !== source.length) throw new Error(`Unsupported selector: ${source}`);
  return compound;
}

function parseSelectorList(selector) {
  if (selectorCache.has(selector)) return selectorCache.get(selector);
  const list = splitTopLevel(selector, ',').map(part => {
    const steps = [];
    let combinator = ' ';
    for (const piece of part.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/)) {
      if (piece === '>') { combinator = '>'; continue; }
      steps.push({ combinator, compound: parseCompound(piece) });
      combinator = ' ';
    }
    return steps;
  });
  selectorCache.set(selector, list);
  return list;
}

function matchesCompound(element, compound) {
  if (element.nodeType !== 1 || element.localName === '#document') return false;
  if (compound.tag && element.localName !== compound.tag) return false;
  const classes = element.className.split(/\s+/).filter(Boolean);
  if (!compound.classes.every(name => classes.includes(name))) return false;
  return compound.attributes.every(({ name, op, value }) => {
    const actual = element.getAttribute(name);
    if (actual === null) return false;
    switch (op) {
      case '': return true;
      case '=': return actual === value;
      case '*=': return value !== '' && actual.includes(value);
      case '^=': return value !== '' && actual.startsWith(value);
      case '$=': return value !== '' && actual.endsWith(value);
      case '~=': return actual.split(/\s+/).includes(value);
      case '|=': return actual === value || actual.startsWith(`${value}-`);
      default: return false;
    }
  });
}

function matchesComplex(element, steps, index = steps.length - 1) {
  if (!matchesCompound(element, steps[index].compound)) return false;
  if (index === 0) return true;
  const combinator = steps[index].combinator;
  let ancestor = element.parentNode;
  while (ancestor && ancestor.localName !== '#document') {
    if (matchesComplex(ancestor, steps, index - 1)) return true;
    if (combinator === '>') return false;
    ancestor = ancestor.parentNode;
  }
  return false;
}
