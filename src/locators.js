// Matching a step's words to page elements, and the locators each framework
// prefers: Playwright reads like a user (role, label, test id); Selenium
// wants CSS or XPath; Appium wants accessibility ids.

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) || 0) + 1);
  return m;
}

/** Sørensen–Dice over character bigrams, ignoring case and punctuation. */
export function dice(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let shared = 0;
  for (const [g, n] of A) shared += Math.min(n, B.get(g) || 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}

const words = (s) => ` ${norm(s)} `;
const identifierWords = (s) => String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ');
const INTERACTIVE = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'option', 'switch', 'searchbox', 'spinbutton', 'slider']);

const POINTER = new Set(['click', 'hover', 'press']);

/** How well candidate `c` fits a target described as { description, role }, in [0, ~1.3]. */
export function matchScore(target, c, type = null) {
  const want = target.description;
  let best = 0;
  for (const f of ['text', 'ariaLabel', 'label', 'placeholder', 'value', 'title', 'alt', 'name', 'id', 'testId']) {
    const have = ['name', 'id', 'testId'].includes(f) ? identifierWords(c[f]) : c[f];
    if (!have) continue;
    let s = dice(want, have);
    // "Sign in →" contains "sign in"; "Email address" contains "email"
    if (words(have).includes(words(want))) s = Math.max(s, norm(have).length <= norm(want).length + 12 ? 0.9 : 0.7);
    else if (words(want).includes(words(have)) && norm(have).length >= 3) s = Math.max(s, 0.75);
    if (['name', 'id', 'testId'].includes(f)) s *= 0.9;
    best = Math.max(best, s);
  }
  if (target.role && c.role === target.role) best += 0.12;
  else if (target.role && c.role !== target.role) best -= 0.2;
  if (INTERACTIVE.has(c.role)) best += POINTER.has(type) && !target.role ? 0.15 : 0.04;
  return best;
}

const EDITABLE = new Set(['fill', 'expectValue']);
export function fitsAction(c, type) {
  if (EDITABLE.has(type)) return c.editable && c.tag !== 'select';
  if (type === 'select') return c.tag === 'select' || ['combobox', 'listbox'].includes(c.role);
  if (type === 'check' || type === 'uncheck') return ['checkbox', 'radio', 'switch'].includes(c.role);
  return true;
}

/** Best candidate, if clearly ahead of the best unrelated runner-up. */
export function pick(target, type, candidates, { minScore = 0.55, minMargin = 0.1 } = {}) {
  const ranked = candidates.filter((c) => fitsAction(c, type)).map((c) => ({ c, score: matchScore(target, c, type) })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  if (!top || top.score < minScore) return { choice: null, ranked };
  // An element and its own label/text child are the same thing, not rivals.
  const related = (a, b) => {
    const chain = (x) => {
      const out = [];
      for (let n = x; n; n = candidates[n.within] ?? null) {
        out.push(n.index);
        if (n.within == null) break;
      }
      return out;
    };
    return chain(a).includes(b.index) || chain(b).includes(a.index);
  };
  const rival = ranked.slice(1).find((r) => !related(r.c, top.c));
  if (rival && top.score - rival.score < minMargin) return { choice: null, ranked };
  // Prefer the interactive element over the text inside it.
  const outer = ranked.find((r) => r !== top && related(r.c, top.c) && INTERACTIVE.has(r.c.role) && top.score - r.score < 0.2);
  return { choice: !INTERACTIVE.has(top.c.role) && outer ? outer.c : top.c, ranked };
}

const PW_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'heading', 'tab', 'menuitem', 'option', 'img', 'listitem', 'dialog', 'searchbox', 'spinbutton', 'slider', 'switch', 'status', 'alert']);
const looksGenerated = (v) => /\d{4,}|[a-f0-9]{8,}|^:r|^ember\d|^react-/i.test(v);
const xq = (s) => (!s.includes("'") ? `'${s}'` : !s.includes('"') ? `"${s}"` : `concat('${s.split("'").join(`', "'", '`)}')`);
const cq = (s) => JSON.stringify(s);

/** Playwright locators for a live candidate, most readable first. Checked on the page before use. */
export function playwrightOptions(c) {
  const name = c.ariaLabel || c.label || c.text || c.value || c.alt || c.title;
  return [
    c.testId && (c.testIdAttr === 'data-testid' ? { strategy: 'testid', value: c.testId } : { strategy: 'css', value: `[${c.testIdAttr}=${cq(c.testId)}]` }),
    PW_ROLES.has(c.role) && name && name.length <= 80 && { strategy: 'role', role: c.role, name },
    c.label && c.editable && { strategy: 'label', value: c.label },
    c.placeholder && { strategy: 'placeholder', value: c.placeholder },
    c.id && !looksGenerated(c.id) && { strategy: 'id', value: c.id },
    c.name && { strategy: 'css', value: `${c.tag}[name=${cq(c.name)}]` },
    c.text && c.text.length <= 60 && { strategy: 'text', value: c.text },
    c.path && { strategy: 'css', value: c.path },
  ].filter(Boolean);
}

/** Selenium / WebDriver locators (id, CSS, XPath) for a live candidate. */
export function seleniumOptions(c) {
  const text = c.text && c.text.length <= 60 ? c.text : '';
  return [
    c.id && !looksGenerated(c.id) && { strategy: 'id', value: c.id, check: { using: 'css', value: `[id=${cq(c.id)}]` } },
    c.testId && { strategy: 'css', value: `[${c.testIdAttr}=${cq(c.testId)}]` },
    c.name && { strategy: 'css', value: `${c.tag}[name=${cq(c.name)}]` },
    c.placeholder && { strategy: 'css', value: `${c.tag}[placeholder=${cq(c.placeholder)}]` },
    c.ariaLabel && { strategy: 'css', value: `${c.tag}[aria-label=${cq(c.ariaLabel)}]` },
    c.label && c.editable && { strategy: 'xpath', value: `//${c.tag}[@id=//label[normalize-space()=${xq(c.label)}]/@for]` },
    text && { strategy: 'xpath', value: `//${c.tag}[normalize-space()=${xq(text)}]` },
    c.value && { strategy: 'css', value: `${c.tag}[value=${cq(c.value)}]` },
    c.path && { strategy: 'css', value: c.path },
  ].filter(Boolean).map((o) => ({ ...o, check: o.check ?? { using: o.strategy === 'xpath' ? 'xpath' : 'css', value: o.value } }));
}

/** With no app to explore: a locator from the step's own words. Marked unresolved. */
export function guessLocator(target, framework) {
  const name = target.description;
  if (framework === 'appium') return { strategy: 'accessibilityId', value: name };
  if (framework === 'playwright') {
    if (target.byText) return { strategy: 'text', value: name };
    if (target.role === 'textbox') return { strategy: 'label', value: name };
    if (PW_ROLES.has(target.role)) return { strategy: 'role', role: target.role, name };
    return { strategy: 'text', value: name };
  }
  // Selenium: XPath on what the user reads
  switch (target.role) {
    case 'textbox':
      return { strategy: 'xpath', value: `//*[self::input or self::textarea][@placeholder=${xq(name)} or @aria-label=${xq(name)} or @id=//label[contains(normalize-space(), ${xq(name)})]/@for]` };
    case 'combobox':
      return { strategy: 'xpath', value: `//select[@aria-label=${xq(name)} or @id=//label[contains(normalize-space(), ${xq(name)})]/@for]` };
    case 'checkbox':
    case 'radio':
      return { strategy: 'xpath', value: `//input[@type='${target.role}'][@aria-label=${xq(name)} or @id=//label[contains(normalize-space(), ${xq(name)})]/@for or ancestor::label[contains(normalize-space(), ${xq(name)})]]` };
    case 'link':
      return { strategy: 'xpath', value: `//a[normalize-space()=${xq(name)}]` };
    case 'button':
      return { strategy: 'xpath', value: `//*[self::button or self::input[@type='submit' or @type='button'] or @role='button'][normalize-space()=${xq(name)} or @value=${xq(name)} or @aria-label=${xq(name)}]` };
    default:
      return { strategy: 'xpath', value: `//*[normalize-space()=${xq(name)}]` };
  }
}
