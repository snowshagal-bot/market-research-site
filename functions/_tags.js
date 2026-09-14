/**
 * Canonical Topic Tags Registry & Validation SSOT
 *
 * Provides shared validation, slug generation, group definitions,
 * and serialization for Snowshagal topic tags.
 */

export const VALID_GROUPS = new Set(['market', 'sector', 'macro', 'company-policy']);

export const GROUP_ORDER = ['market', 'sector', 'macro', 'company-policy'];

export const GROUP_LABELS = {
  market: '시장',
  sector: '업종',
  macro: '매크로·자산',
  'company-policy': '기업·정책'
};

export const MAX_POST_TAGS = 5;
export const TAG_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TAG_MIN_LENGTH = 2;
export const TAG_MAX_LENGTH = 48;
export const MAX_KO_LABEL_LENGTH = 40;
export const MAX_EN_LABEL_LENGTH = 60;
export const MAX_NEW_CUSTOM_TAGS_PER_PUBLISH = 5;

/**
 * The registry is the canonical taxonomy plus whatever custom tags publishing
 * has added beside it. Every tag a publish adds is stored with `custom: true`,
 * and that marker is the only thing that tells the two apart, so the canonical
 * set never has to be written down a second time.
 */
export const CANONICAL_TAG_COUNT = 36;

export function isCustomTag(definition) {
  return definition?.custom === true;
}

/** The registry split into its canonical and custom entries, order kept. */
export function splitTagRegistry(registry) {
  const canonical = {};
  const custom = {};
  const entries = registry && typeof registry === 'object' && !Array.isArray(registry) ? Object.entries(registry) : [];
  for (const [id, definition] of entries) {
    (isCustomTag(definition) ? custom : canonical)[id] = definition;
  }
  return { canonical, custom };
}

/**
 * What is wrong with a registry as a whole: the canonical taxonomy must be
 * exactly CANONICAL_TAG_COUNT tags, and any number of custom tags may sit
 * beside it.
 */
export function tagRegistryProblems(registry) {
  const { canonical, custom } = splitTagRegistry(registry);
  const canonicalCount = Object.keys(canonical).length;
  const customCount = Object.keys(custom).length;
  const problems = [];
  if (canonicalCount !== CANONICAL_TAG_COUNT) {
    problems.push(`canonical tags: expected ${CANONICAL_TAG_COUNT}, found ${canonicalCount}`);
  }
  return { canonicalCount, customCount, problems };
}

/**
 * Generate a safe URL/registry slug from an English label.
 * Lowercase, ASCII alphanumeric + '-', collapsed, trimmed.
 */
export function slugifyLabel(enLabel) {
  if (typeof enLabel !== 'string') return '';
  const cleaned = enLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned;
}

/**
 * Sanitize label text by removing control characters, trimming,
 * and disallowing raw HTML angle brackets.
 */
export function sanitizeLabel(label, maxLength) {
  if (typeof label !== 'string') return '';
  const cleaned = label
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (/<[^>]*>/i.test(cleaned)) return '';
  return maxLength ? cleaned.slice(0, maxLength) : cleaned;
}

/**
 * The form a label is stored in: Unicode NFC, so the same Korean word matches
 * whether it arrived precomposed or as separate jamo; control characters read
 * as spaces; every run of whitespace a single space; nothing at either end.
 */
export function normalizeLabelText(label) {
  if (typeof label !== 'string') return '';
  return label
    .normalize('NFC')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Names that arrive typed in lowercase and whose right spelling is not simply a
// capitalised word. Consulted only when the input carries no capitals at all.
const KNOWN_ENGLISH_LABELS = new Map(Object.entries({
  ai: 'AI', esg: 'ESG', etf: 'ETF', etfs: 'ETFs', ev: 'EV', hbm: 'HBM', ipo: 'IPO',
  cpi: 'CPI', gdp: 'GDP', pmi: 'PMI', ppi: 'PPI',
  boj: 'BOJ', ecb: 'ECB', fed: 'Fed', fomc: 'FOMC', opec: 'OPEC', pboc: 'PBOC',
  kosdaq: 'KOSDAQ', kospi: 'KOSPI', krx: 'KRX', msci: 'MSCI', nasdaq: 'Nasdaq', nxt: 'NXT', wgbi: 'WGBI',
  cny: 'CNY', eur: 'EUR', jpy: 'JPY', krw: 'KRW', usd: 'USD',
  ebay: 'eBay', iphone: 'iPhone', nvidia: 'NVIDIA', openai: 'OpenAI', 'sk hynix': 'SK hynix'
}));

/**
 * An English label as stored. Casing someone chose is kept: a capital anywhere
 * in the input means the label stands as typed (`SK hynix`, `iPhone`, `ETF`).
 * Input with no capitals at all is corrected only where the answer is certain —
 * a known name (`etf` → `ETF`), or a single plain lowercase word of five letters
 * or more (`japan` → `Japan`). A shorter word may be an acronym and not every
 * word of a phrase takes a capital, so those are left exactly as typed.
 */
export function normalizeEnglishLabel(label) {
  const text = normalizeLabelText(label);
  if (text !== text.toLowerCase()) return text;
  const known = KNOWN_ENGLISH_LABELS.get(text);
  if (known) return known;
  if (/^[a-z]{5,}$/.test(text)) return text[0].toUpperCase() + text.slice(1);
  return text;
}

/**
 * Normalize label for case-insensitive and whitespace-insensitive duplicate checking.
 */
export function normalizeLabelKey(label) {
  return String(label || '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Validate a single custom tag definition against schema and existing registry.
 */
export function validateTagDefinition(def, existingRegistry = {}) {
  if (!def || typeof def !== 'object') {
    return { valid: false, error: '태그 정의 객체가 올바르지 않습니다.' };
  }

  // Normalized before anything is checked, so the length limits, the duplicate
  // checks and the stored entry all see the same text.
  const ko = normalizeLabelText(String(def.ko ?? ''));
  const en = normalizeEnglishLabel(String(def.en ?? ''));
  const group = String(def.group || '').trim().toLowerCase();

  if (!ko) return { valid: false, error: '한국어 태그 이름을 입력하세요.' };
  if (!en) return { valid: false, error: 'English 태그 이름을 입력하세요.' };
  if (!VALID_GROUPS.has(group)) {
    return { valid: false, error: `유효하지 않은 태그 분류입니다: ${group}` };
  }

  if (ko.length > MAX_KO_LABEL_LENGTH) {
    return { valid: false, error: `한국어 태그 이름은 최대 ${MAX_KO_LABEL_LENGTH}자까지 가능합니다.` };
  }
  if (!sanitizeLabel(ko)) return { valid: false, error: '한국어 태그 이름에 허용되지 않는 문자나 HTML이 포함되어 있습니다.' };

  if (en.length > MAX_EN_LABEL_LENGTH) {
    return { valid: false, error: `English 태그 이름은 최대 ${MAX_EN_LABEL_LENGTH}자까지 가능합니다.` };
  }
  if (!sanitizeLabel(en)) return { valid: false, error: 'English 태그 이름에 허용되지 않는 문자나 HTML이 포함되어 있습니다.' };

  // Derive or validate canonical slug ID
  let id = def.id ? String(def.id).trim().toLowerCase() : slugifyLabel(en);
  if (!id) {
    return { valid: false, error: 'English 이름에서 유효한 태그 ID(영문 소문자, 숫자, 하이픈)를 생성할 수 없습니다.' };
  }

  if (id.length < TAG_MIN_LENGTH || id.length > TAG_MAX_LENGTH) {
    return { valid: false, error: `태그 ID 길이는 ${TAG_MIN_LENGTH}~${TAG_MAX_LENGTH}자여야 합니다 (현재 ${id.length}자).` };
  }

  if (!TAG_SLUG_REGEX.test(id)) {
    return { valid: false, error: `태그 ID 형식이 올바르지 않습니다: '${id}'. 영문 소문자, 숫자, 하이픈만 허용되며 연속 하이픈이나 앞뒤 하이픈은 사용할 수 없습니다.` };
  }

  // Duplicate checks against existing registry
  const normKo = normalizeLabelKey(ko);
  const normEn = normalizeLabelKey(en);

  if (existingRegistry && typeof existingRegistry === 'object') {
    if (existingRegistry[id]) {
      return { valid: false, error: `이미 등록된 태그 ID입니다: '${id}'` };
    }

    for (const [existingId, item] of Object.entries(existingRegistry)) {
      if (existingId.toLowerCase() === id.toLowerCase()) {
        return { valid: false, error: `이미 등록된 태그 ID와 중복됩니다: '${existingId}'` };
      }
      if (item?.ko && normalizeLabelKey(item.ko) === normKo) {
        return { valid: false, error: `동일한 한국어 표시명의 태그가 이미 존재합니다: '${item.ko}' (${existingId})` };
      }
      if (item?.en && normalizeLabelKey(item.en) === normEn) {
        return { valid: false, error: `동일한 English 표시명의 태그가 이미 존재합니다: '${item.en}' (${existingId})` };
      }
    }
  }

  return {
    valid: true,
    tag: {
      id,
      ko,
      en,
      group
    }
  };
}

/** The registry entry a publish stores for a custom tag that passed validation. */
export function customTagEntry(tag) {
  return { ko: tag.ko, en: tag.en, group: tag.group, custom: true };
}

/**
 * Validate and normalize a list of tags for a report post.
 */
export function parseAndValidateTags(inputTags, counterpartTags = [], registry = {}, { max = MAX_POST_TAGS } = {}) {
  let rawTags = [];
  if (Array.isArray(inputTags)) {
    rawTags = inputTags;
  } else if (typeof inputTags === 'string') {
    rawTags = inputTags.split(/[,\s]+/).map(t => t.trim()).filter(Boolean);
  }
  if (!rawTags.length && Array.isArray(counterpartTags) && counterpartTags.length) {
    rawTags = counterpartTags;
  }

  const normalized = Array.from(new Set(rawTags.map(t => String(t).trim().toLowerCase()))).filter(Boolean);

  if (normalized.length > max) {
    return { error: `태그는 최대 ${max}개까지만 지정할 수 있습니다. (입력: ${normalized.length}개)` };
  }

  const validIds = new Set(Object.keys(registry || {}));
  for (const t of normalized) {
    if (!validIds.has(t)) {
      return { error: `허용되지 않은 태그입니다: ${t}` };
    }
  }

  return { tags: normalized };
}

/**
 * Generate synchronized data/tags.js file content from registry object.
 */
export function generateTagsJs(registry) {
  return `window.TAG_REGISTRY = ${JSON.stringify(registry, null, 2)};\n`;
}
