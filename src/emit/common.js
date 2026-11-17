// What every emitter shares: string literals, step comments that trace each
// line back to the manual test, and TODO markers for anything a person must
// finish.

/** A string literal that is valid TypeScript, Java and Python alike. */
export const q = (s) => JSON.stringify(String(s ?? ''));

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function sourceLabel(source) {
  if (!source) return '';
  if (source.kind === 'precondition') return 'Precondition';
  if (source.kind === 'expected') return `Expected (step ${source.step})`;
  return `Step ${source.step}`;
}

const oneLine = (s, max = 160) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Walks a plan's actions, calling `line(action)` for the code of each, and
 * returns code lines with a comment before each new step and TODO/NOTE
 * comments where a person must look.
 */
export function body(plan, { comment, line, indent }) {
  const out = [];
  let last = null;
  for (const action of plan.actions) {
    const key = action.source ? `${action.source.kind}:${action.source.step}:${action.source.index ?? ''}` : null;
    if (key && key !== last) {
      if (out.length) out.push('');
      out.push(`${indent}${comment(`${sourceLabel(action.source)}: ${oneLine(action.source.text)}`)}`);
      last = key;
    }
    if (action.type === 'manual') {
      out.push(`${indent}${comment(`TODO (manual): ${action.note ? oneLine(action.note) : 'automate or verify this by hand'}`)}`);
      continue;
    }
    // A check that was only our reading of vague wording, and that the live
    // app contradicted, is left commented out rather than failing the test.
    if (action.status === 'failed' && action.guessed) {
      for (const l of [].concat(line(action))) out.push(`${indent}${comment(l)}`);
      out.push(`${indent}${comment(`TODO: the step's wording was read as the check above, which failed on the live app${action.note ? ` (${oneLine(action.note, 100)})` : ''}; rewrite it`)}`);
      continue;
    }
    for (const l of [].concat(line(action))) out.push(`${indent}${l}`);
    if (action.target && action.target.locator && !action.target.resolved && action.status !== 'failed') {
      out.push(`${indent}${comment('TODO: locator guessed from the step text; check it against the app')}`);
    }
    if (action.status === 'failed') out.push(`${indent}${comment(`NOTE: did not hold on the live app during generation${action.note ? ` (${oneLine(action.note, 120)})` : ''}`)}`);
    else if (action.status === 'guessed' && action.note) out.push(`${indent}${comment(`TODO: ${oneLine(action.note, 120)}`)}`);
  }
  return out;
}

export function counts(plan) {
  const todo = plan.actions.filter((a) => a.type === 'manual' || a.status === 'failed' || a.status === 'guessed' || (a.target && a.target.locator && !a.target.resolved)).length;
  return { total: plan.actions.length, todo, automated: plan.actions.filter((a) => a.type !== 'manual').length };
}

export function headerLines(plan) {
  const { todo } = counts(plan);
  const t = plan.test;
  return [
    `${[t.id, t.title].filter(Boolean).join(' ')}`,
    t.description ? oneLine(t.description, 200) : null,
    `Generated from the manual test case by automation-script-agent.`,
    todo ? `${todo} item${todo === 1 ? '' : 's'} to review: search for TODO and NOTE.` : 'Every step was converted.',
  ].filter(Boolean);
}

/** Keys the plans use -> each language's key constant. */
export const KEY_NAMES = {
  Enter: { java: 'Keys.ENTER', python: 'Keys.ENTER', typescript: 'Key.ENTER' },
  Tab: { java: 'Keys.TAB', python: 'Keys.TAB', typescript: 'Key.TAB' },
  Escape: { java: 'Keys.ESCAPE', python: 'Keys.ESCAPE', typescript: 'Key.ESCAPE' },
  Space: { java: 'Keys.SPACE', python: 'Keys.SPACE', typescript: 'Key.SPACE' },
  Backspace: { java: 'Keys.BACK_SPACE', python: 'Keys.BACK_SPACE', typescript: 'Key.BACK_SPACE' },
  ArrowDown: { java: 'Keys.ARROW_DOWN', python: 'Keys.ARROW_DOWN', typescript: 'Key.ARROW_DOWN' },
  ArrowUp: { java: 'Keys.ARROW_UP', python: 'Keys.ARROW_UP', typescript: 'Key.ARROW_UP' },
};
export const keyConst = (key, lang) => KEY_NAMES[key]?.[lang] ?? KEY_NAMES.Enter[lang];

/** Unique file names when two tests share a title. */
export function uniqueNames(plans, nameOf) {
  const seen = new Map();
  return plans.map((p) => {
    const base = nameOf(p);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}${n}`;
  });
}

export const VERSIONS = {
  playwrightNpm: '^1.65.1',
  seleniumNpm: '^4.52.0',
  tsx: '^4.23.15',
  wdio: '^10.2.0',
  seleniumJava: '4.52.0',
  testng: '7.12.0',
  restAssured: '6.3.0',
  appiumJava: '11.0.0',
  surefire: '3.5.2',
  seleniumPy: '4.52.0',
  pytest: '9.2.0',
  pytestPlaywright: '0.10.0',
  appiumPy: '6.1.7',
  requests: '2.34.2',
};
