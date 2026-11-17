// The shapes everything else passes around.
//
// ManualTest  { id, title, description, preconditions[], steps: [{ action, expected }],
//               priority, category, platform }
//
// Plan        { test: ManualTest, actions: Action[] }
// Action      { type, source: { step, kind: 'precondition'|'step'|'expected', text },
//               ...fields for the type, status, note }
//
// Action types
//   goto { url }                      click { target }           fill { target, value }
//   select { target, value }          check / uncheck { target } hover { target }
//   press { key, target? }            wait { ms }
//   expectVisible / expectHidden { target }
//   expectText { text, target? }      expectValue { target, value }
//   expectEnabled / expectDisabled { target }
//   expectUrl { value }               expectTitle { value }
//   request { method, path, headers: [{ name, value }], body }   (API)
//   expectStatus { code }             expectBody { path, equals?, contains?, exists? }
//   manual { }                        a step no rule or model could turn into code
//
// Target      { description, role, locator: Locator|null, resolved: boolean }
// Locator     { strategy: 'testid'|'id'|'css'|'xpath'|'role'|'label'|'placeholder'|'text'|'accessibilityId',
//               value, role?, name? }
//
// Status of an action after planning and exploring:
//   verified  ran against the live app and held
//   found     its element was located on the live app
//   guessed   no app to explore: the locator comes from the step text
//   failed    ran against the live app and did not hold
//   manual    could not be automated; left as a TODO
//   ok        needs no element (goto, wait, request, …)

export const FRAMEWORKS = {
  playwright: { label: 'Playwright', languages: ['typescript', 'python'], kind: 'web' },
  selenium: { label: 'Selenium', languages: ['java', 'python', 'typescript'], kind: 'web' },
  appium: { label: 'Appium', languages: ['java', 'python', 'typescript'], kind: 'mobile' },
  api: { label: 'API', languages: ['typescript', 'java', 'python'], kind: 'api' },
};

export const LANGUAGE_LABELS = { typescript: 'TypeScript', python: 'Python', java: 'Java' };

/** Runnable inside this project (its own node_modules), so --verify can execute them. */
export const RUNNABLE = new Set(['playwright/typescript', 'api/typescript', 'selenium/typescript']);

export const ELEMENT_ACTIONS = new Set(['click', 'fill', 'select', 'check', 'uncheck', 'hover', 'expectVisible', 'expectHidden', 'expectValue', 'expectEnabled', 'expectDisabled']);

export const ACTION_TYPES = [
  'goto', 'click', 'fill', 'select', 'check', 'uncheck', 'hover', 'press', 'wait',
  'expectVisible', 'expectHidden', 'expectText', 'expectValue', 'expectEnabled', 'expectDisabled', 'expectUrl', 'expectTitle',
  'request', 'expectStatus', 'expectBody', 'manual',
];

export function slug(s, max = 60) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, max)
    .replace(/-$/, '') || 'test';
}

/** "TC-12 Login with valid credentials" -> "Tc12LoginWithValidCredentials" */
export function pascal(s, max = 60) {
  const out = slug(s, max).split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return /^\d/.test(out) ? `T${out}` : out;
}

export const snake = (s, max = 60) => slug(s, max).replace(/-/g, '_');
export const camel = (s, max = 60) => {
  const p = pascal(s, max);
  return p.charAt(0).toLowerCase() + p.slice(1);
};

export function testName(test) {
  return [test.id, test.title].filter(Boolean).join(' ');
}

export function normalizeTest(t, index = 0) {
  const steps = (t.steps || [])
    .map((s) => (typeof s === 'string' ? { action: s, expected: '' } : { action: s.action ?? '', expected: s.expected ?? '' }))
    .map((s) => ({ action: String(s.action).trim(), expected: String(s.expected || '').trim() }))
    .filter((s) => s.action || s.expected);
  return {
    id: String(t.id ?? '').trim() || `TC-${index + 1}`,
    title: String(t.title ?? '').trim() || `Test case ${index + 1}`,
    description: String(t.description ?? '').trim(),
    preconditions: (t.preconditions || []).map((p) => String(p).trim()).filter(Boolean),
    steps,
    priority: t.priority ?? null,
    category: t.category ?? null,
    platform: t.platform ?? null,
  };
}
