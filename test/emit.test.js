import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject, TARGETS } from '../src/emit/index.js';
import { planWithRules } from '../src/plan/rules.js';
import { fitPlan } from '../src/agent.js';
import { guessLocator } from '../src/locators.js';
import { FRAMEWORKS } from '../src/model.js';

const manual = {
  id: 'TC-1', title: 'Sign in works', description: '', preconditions: [],
  steps: [
    { action: 'Navigate to /login', expected: '' },
    { action: 'Enter "ana@example.com" in the Email field', expected: '' },
    { action: 'Click the Sign in button', expected: 'User is redirected to the dashboard\n"Welcome" is displayed' },
    { action: 'Compare the totals with the invoice', expected: '' },
  ],
};
const apiManual = {
  id: 'API-1', title: 'Create a user', description: '', preconditions: [],
  steps: [{ action: 'POST /api/users with body {"name":"Ravi"}', expected: 'Status code should be 201\nname equals "Ravi"' }],
};

function plansFor(framework, explored = null) {
  const t = FRAMEWORKS[framework].kind === 'api' ? apiManual : manual;
  const plan = fitPlan(planWithRules(t, { kind: FRAMEWORKS[framework].kind }), framework);
  for (const a of plan.actions) {
    if (a.target) a.target = { ...a.target, locator: explored?.[a.target.description] ?? guessLocator(a.target, framework), resolved: !!explored?.[a.target.description] };
    a.status = a.type === 'manual' ? 'manual' : a.target && !a.target.resolved ? 'guessed' : 'ok';
  }
  return [plan];
}

const file = (project, re) => project.files.find((f) => re.test(f.path));

test('every framework/language target produces a test file, a README and a report', () => {
  for (const target of TARGETS) {
    const [framework, language] = target.split('/');
    const project = generateProject(plansFor(framework), { framework, language, baseUrl: 'http://localhost:3000' });
    const paths = project.files.map((f) => f.path);
    assert.ok(paths.includes('README.md'), target);
    assert.ok(paths.includes('conversion-report.json'), target);
    assert.ok(paths.some((p) => /(spec|test|Test|e2e)[^/]*\.(ts|py|java)$/.test(p)), `${target}: ${paths.join(', ')}`);
    assert.ok(paths.some((p) => /package\.json|pom\.xml|requirements\.txt/.test(p)), target);
  }
});

test('Playwright TypeScript: explored locators are exact; guessed ones carry a TODO', () => {
  const explored = { Email: { strategy: 'label', value: 'Email' } };
  const project = generateProject(plansFor('playwright', explored), { framework: 'playwright', language: 'typescript', baseUrl: 'http://app' });
  const spec = file(project, /\.spec\.ts$/).content;
  assert.match(spec, /await page\.goto\("\/login"\);/);
  assert.match(spec, /await page\.getByLabel\("Email", \{ exact: true \}\)\.fill\("ana@example\.com"\);/);
  assert.match(spec, /await page\.getByRole\("button", \{ name: "Sign in" \}\)\.click\(\);\n\s+\/\/ TODO: locator guessed/);
  assert.match(spec, /toHaveURL\(new RegExp\("dashboard", 'i'\)\)/);
  assert.match(spec, /\/\/ Step 4: Compare the totals with the invoice\n\s+\/\/ TODO \(manual\)/);
  assert.match(file(project, /playwright\.config\.ts$/).content, /process\.env\.BASE_URL \?\? "http:\/\/app"/);
});

test('Selenium: WebDriver strategies only, in each language', () => {
  const java = generateProject(plansFor('selenium'), { framework: 'selenium', language: 'java' });
  const test = file(java, /Tc1SignInWorksTest\.java$/).content;
  assert.match(test, /public class Tc1SignInWorksTest extends BaseTest/);
  assert.match(test, /open\("\/login"\);/);
  assert.match(test, /type\(By\.xpath\(".*Email.*"\), "ana@example\.com"\);/);
  assert.match(test, /assertUrlContains\("dashboard"\);/);
  assert.match(file(java, /pom\.xml$/).content, /<artifactId>selenium-java<\/artifactId>\s+<version>4\.52\.0<\/version>/);

  const py = file(generateProject(plansFor('selenium'), { framework: 'selenium', language: 'python' }), /test_tc_1.*\.py$/).content;
  assert.match(py, /ui\.type\(\(By\.XPATH, ".*"\), "ana@example\.com"\)/);
  assert.match(py, /ui\.assert_page_contains\("Welcome"\)/);

  const ts = file(generateProject(plansFor('selenium'), { framework: 'selenium', language: 'typescript' }), /\.test\.ts$/).content;
  assert.match(ts, /await ui\.click\(By\.xpath\(/);
});

test('Appium: native locators, and web-only checks become TODOs with the reason', () => {
  const project = generateProject(plansFor('appium'), { framework: 'appium', language: 'java' });
  const test = file(project, /Tc1SignInWorksTest\.java$/).content;
  assert.match(test, /tap\(AppiumBy\.xpath\("\/\/\*\[@text='Sign in'/);
  assert.match(test, /TODO \(manual\): a native app has no URL/);
  assert.match(file(project, /pom\.xml$/).content, /selenium-support/);
  const wdio = file(generateProject(plansFor('appium'), { framework: 'appium', language: 'typescript' }), /\.e2e\.ts$/).content;
  assert.match(wdio, /await \$\(".*Sign in.*"\)\.click\(\);/);
});

test('API: one request and its checks, in each language', () => {
  const ts = file(generateProject(plansFor('api'), { framework: 'api', language: 'typescript' }), /\.spec\.ts$/).content;
  assert.match(ts, /request\.fetch\("\/api\/users", \{ method: "POST", data: \{"name":"Ravi"\} \}\)/);
  assert.match(ts, /expect\(response\.status\(\)\)\.toBe\(201\);/);
  assert.match(ts, /expect\(asText\(jsonPath\(body, "name"\)\)\)\.toBe\("Ravi"\);/);
  const java = file(generateProject(plansFor('api'), { framework: 'api', language: 'java' }), /Api1CreateAUserTest\.java$/).content;
  assert.match(java, /given\(\)\.contentType\("application\/json"\)\.body\("\{\\"name\\":\\"Ravi\\"\}"\)\.when\(\)\.request\("POST", "\/api\/users"\);/);
  const py = file(generateProject(plansFor('api'), { framework: 'api', language: 'python' }), /test_api_1.*\.py$/).content;
  assert.match(py, /requests\.request\("POST", url\(base_url, "\/api\/users"\), json=json\.loads\("\{\\"name\\":\\"Ravi\\"\}"\), timeout=30\)/);
  assert.match(py, /assert response\.status_code == 201/);
});

test('a vague check the live app contradicted is commented out, not left failing', () => {
  const [plan] = plansFor('playwright');
  plan.actions.push({ type: 'expectUrl', value: 'sign-in', guessed: true, status: 'failed', note: 'the URL was /login', source: { kind: 'expected', step: 1, text: 'The Sign in page is displayed' } });
  const spec = file(generateProject([plan], { framework: 'playwright', language: 'typescript' }), /\.spec\.ts$/).content;
  assert.match(spec, /\/\/ await expect\(page\)\.toHaveURL\(new RegExp\("sign-in", 'i'\)\);\n\s+\/\/ TODO: the step's wording was read as the check above, which failed on the live app \(the URL was \/login\)/);
});

test('API steps in a UI test, and UI steps in an API test, become TODOs', () => {
  const ui = fitPlan(planWithRules({ preconditions: [], steps: [{ action: 'GET /api/health', expected: 'Status code should be 200' }] }, { kind: 'web' }), 'playwright');
  assert.deepEqual(ui.actions.map((a) => a.type), ['manual', 'manual']);
  const api = fitPlan(planWithRules({ preconditions: [], steps: [{ action: 'Click Save', expected: '' }] }, { kind: 'api' }), 'api');
  assert.equal(api.actions[0].type, 'manual');
  assert.match(api.actions[0].note, /UI step/);
});

test('two tests with the same title get different files', () => {
  const plans = [...plansFor('playwright'), ...plansFor('playwright')];
  const specs = generateProject(plans, { framework: 'playwright', language: 'typescript' }).files.filter((f) => f.path.endsWith('.spec.ts')).map((f) => f.path);
  assert.equal(new Set(specs).size, 2);
});

test('an unknown target is refused with the list of supported ones', () => {
  assert.throws(() => generateProject([], { framework: 'cypress', language: 'typescript' }), /Unsupported target cypress\/typescript.*playwright\/typescript/);
});
