// The agent: manual tests in, a runnable automation project out.
//
//   read -> plan (Claude, or rules offline) -> explore the live app (optional)
//        -> emit code for the framework + language -> run it (optional)
import { FRAMEWORKS, ELEMENT_ACTIONS } from './model.js';
import { planWithRules } from './plan/rules.js';
import { createClaudePlanner } from './plan/claude.js';
import { exploreWeb } from './explore/web.js';
import { exploreApi } from './explore/api.js';
import { createClaudeChooser } from './explore/choose.js';
import { guessLocator } from './locators.js';
import { generateProject } from './emit/index.js';
import { verifyProject } from './verify.js';

const API_ACTIONS = new Set(['request', 'expectStatus', 'expectBody']);

/** Keeps each plan to what its framework can do; the rest becomes a TODO with the reason. */
export function fitPlan(plan, framework) {
  const kind = FRAMEWORKS[framework].kind;
  const actions = plan.actions.map((a) => {
    if (kind === 'api' && !API_ACTIONS.has(a.type) && a.type !== 'manual' && a.type !== 'wait') {
      return { ...a, type: 'manual', note: `UI step (${a.type}) in an API test` };
    }
    if (kind !== 'api' && API_ACTIONS.has(a.type)) return { ...a, type: 'manual', note: `API check (${a.type}) in a ${FRAMEWORKS[framework].label} test` };
    if (kind === 'mobile' && ['hover', 'press'].includes(a.type)) return { ...a, type: 'manual', note: `no ${a.type} on a touch device` };
    if (kind === 'mobile' && ['expectUrl', 'expectTitle'].includes(a.type)) {
      return { ...a, type: 'manual', note: `a native app has no ${a.type === 'expectUrl' ? 'URL' : 'page title'}; check for something on the expected screen instead` };
    }
    return a;
  });
  return { ...plan, actions };
}

function markUnexplored(plans, framework) {
  for (const plan of plans) {
    for (const a of plan.actions) {
      if (a.type === 'manual') a.status = 'manual';
      else if (a.target && (ELEMENT_ACTIONS.has(a.type) || a.type === 'press')) {
        a.target = { ...a.target, locator: guessLocator(a.target, framework), resolved: false };
        a.status = 'guessed';
      } else a.status = a.guessed ? 'guessed' : 'ok';
    }
  }
  return plans;
}

async function firstBlockedUrl(plans, baseUrl, urlGuard) {
  const urls = [baseUrl, ...plans.flatMap((p) => p.actions).filter((a) => a.type === 'goto' || a.type === 'request').map((a) => new URL(a.url ?? a.path ?? '/', baseUrl).href)];
  for (const url of urls) {
    try {
      await urlGuard(url);
    } catch (err) {
      return err.message;
    }
  }
  return null;
}

const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * tests: ManualTest[]
 * options: { framework, language, baseUrl, explore, verify, planner: 'auto'|'rules'|'claude', headless, onProgress }
 */
export async function convert(tests, options) {
  const { framework, language, baseUrl = '', explore = false, verify = false, planner = 'auto', headless = true, urlGuard = null, onProgress = () => {} } = options;
  if (!FRAMEWORKS[framework]) throw new Error(`Unknown framework "${framework}". Choose: ${Object.keys(FRAMEWORKS).join(', ')}`);
  if (!FRAMEWORKS[framework].languages.includes(language)) throw new Error(`${FRAMEWORKS[framework].label} is generated in ${FRAMEWORKS[framework].languages.join(', ')}, not ${language}`);
  if (!tests.length) throw new Error('No test cases found in the input.');
  const kind = FRAMEWORKS[framework].kind;
  const warnings = [];

  // 1. Plan
  const useClaude = planner === 'claude' || (planner === 'auto' && hasClaude());
  const claude = useClaude ? createClaudePlanner() : null;
  let plans = [];
  for (const [i, test] of tests.entries()) {
    onProgress({ stage: 'plan', index: i, total: tests.length, test: test.title });
    let plan = null;
    if (claude) {
      try {
        plan = await claude(test, { framework, kind });
      } catch (err) {
        warnings.push(`${test.id}: Claude could not plan this test (${err.message}); used the built-in rules instead.`);
      }
    }
    plans.push(fitPlan(plan ?? planWithRules(test, { kind }), framework));
  }

  // 2. Explore
  let explored = false;
  if (explore && baseUrl && kind === 'web') {
    onProgress({ stage: 'explore', total: plans.length });
    await exploreWeb(plans, { baseUrl, framework, headless, urlGuard, chooser: hasClaude() ? createClaudeChooser() : null, onProgress: ({ test, action }) => onProgress({ stage: 'explore', test: test.title, step: action.source?.step }) });
    explored = true;
  } else if (explore && baseUrl && kind === 'api') {
    onProgress({ stage: 'explore', total: plans.length });
    await exploreApi(plans, { baseUrl, urlGuard });
    explored = true;
  } else {
    if (explore && kind === 'mobile') warnings.push('Appium tests are not explored (no device is connected), so every element locator is a guess to check.');
    else if (explore && !baseUrl) warnings.push('Exploring needs a base URL; locators were guessed from the step text.');
    markUnexplored(plans, framework);
  }

  // 3. Emit
  onProgress({ stage: 'emit' });
  const project = generateProject(plans, { framework, language, baseUrl, explored });

  // 4. Verify
  let verification = null;
  if (verify) {
    // Hosted, the tests run outside the explorer's request filter, so every URL they name is checked first.
    const blocked = urlGuard ? await firstBlockedUrl(plans, baseUrl, urlGuard) : null;
    if (!baseUrl) verification = { ran: false, reason: 'running the tests needs a base URL' };
    else if (blocked) verification = { ran: false, reason: blocked };
    else {
      onProgress({ stage: 'verify' });
      verification = await verifyProject(project.files, { framework, language, baseUrl });
    }
  }

  return { plans, project, verification, warnings, planner: useClaude ? 'claude' : 'rules', explored };
}
