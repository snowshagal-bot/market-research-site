/**
 * Whether a report sizes its cover with a rule that arrives after the cover.
 *
 * A cover container gets its height from CSS. When the rule that gives it that
 * height sits in a `<style>` at the end of the body — behind several hundred
 * kilobytes of inline image — the browser lays the cover out once without it
 * and again with it, and everything below the cover moves. Three reports were
 * repaired for exactly this, each shifting by about a whole viewport.
 *
 * This is the single judgement both the repository test and the publish
 * preflight use, so a report that CI would reject cannot reach Production in
 * the first place.
 *
 * A `<style>` in the body is not itself a problem: most of the published set
 * has one, holding body typography, and those are fine. Only a late rule for
 * one of the containers below is. The list is closed on purpose — a new cover
 * family is added here deliberately, with its own measurement, never guessed
 * at — and so is the property list: these are the properties that decide
 * whether the box has a height before the artwork arrives.
 */
export const COVER_CONTAINERS = Object.freeze([
  'dcv', 'cv', 'cover', 'cover-screen', 'cover-image-wrap', 'cvwrap', 'cover-frame', 'cvtitle'
]);

const SIZING_PROPERTY = /(?:^|[;{\s])(?:aspect-ratio|height|min-height|position)\s*:/;
const CSS_RULE = /([^{}]{1,300}?)\{([^{}]{0,600})\}/g;
const DATA_URI = /data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g;

/** Where the first element carrying this class appears. */
function elementOffset(html, className) {
  const found = new RegExp(`<[a-z0-9]+[^>]*class="[^"]*\\b${className}\\b[^"]*"`, 'i').exec(html);
  return found ? found.index : -1;
}

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

/**
 * Where the first rule that would size that container appears.
 *
 * Each `<style>` block is scanned on its own. Running the rule pattern over
 * the whole document instead would let a selector capture run across the
 * markup between two blocks, and the match would then be reported at the end
 * of the previous rule rather than at the rule itself — early enough to look
 * like it arrives in time when it does not.
 */
function sizingRuleOffset(html, className) {
  const token = new RegExp(`\\.${className.replace(/-/g, '\\-')}(?![\\w-])`);
  STYLE_BLOCK.lastIndex = 0;
  let block;
  while ((block = STYLE_BLOCK.exec(html))) {
    const css = block[1];
    const cssAt = block.index + block[0].indexOf(css);
    CSS_RULE.lastIndex = 0;
    let rule;
    while ((rule = CSS_RULE.exec(css))) {
      if (token.test(rule[1].replace(/\s+/g, ' ')) && SIZING_PROPERTY.test(rule[2])) return cssAt + rule.index;
    }
  }
  return -1;
}

/**
 * @param {string} source a report's HTML
 * @returns {null | {container: string, elementAt: number, ruleAt: number, percent: number}}
 *   null when the cover is sized in time, or has no sizing rule at all.
 */
export function findLateCoverStyle(source) {
  // The inline images are most of these files and hold no CSS. Dropping the
  // payloads leaves the offsets in the same order while making the scan quick.
  const html = String(source || '').replace(DATA_URI, 'data:,');

  for (const container of COVER_CONTAINERS) {
    const at = elementOffset(html, container);
    if (at < 0) continue;
    const rule = sizingRuleOffset(html, container);
    // The outermost container this report uses is the one that matters; if it
    // has no sizing rule there is nothing arriving late.
    if (rule < 0) return null;
    if (rule <= at) return null;
    return { container, elementAt: at, ruleAt: rule, percent: Math.round((rule / html.length) * 100) };
  }
  return null;
}

/** What to tell whoever is publishing, in the language the admin speaks. */
export function lateCoverStyleMessage(late) {
  return `표지 크기를 정하는 CSS(.${late.container})가 표지 요소보다 뒤에 있습니다`
    + ` (요소 ${late.elementAt}, 규칙 ${late.ruleAt} · 문서의 ${late.percent}% 지점).`
    + ' 이대로 게시하면 표지가 두 번 그려지며 본문 전체가 밀립니다.'
    + ' 해당 <style> 블록을 </head> 앞으로 옮긴 뒤 다시 올려주세요.';
}
