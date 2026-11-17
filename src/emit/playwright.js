// Playwright: TypeScript (@playwright/test) and Python (pytest-playwright).
import { q, escapeRegex, body, headerLines, uniqueNames, VERSIONS } from './common.js';
import { guessLocator } from '../locators.js';
import { slug, snake } from '../model.js';

const ensureLocator = (target) => target.locator ?? guessLocator(target, 'playwright');

function tsLocator(target) {
  const l = ensureLocator(target);
  const exact = target.resolved ? ', exact: true' : '';
  const exactOnly = target.resolved ? ', { exact: true }' : '';
  switch (l.strategy) {
    case 'testid': return `page.getByTestId(${q(l.value)})`;
    case 'role': return `page.getByRole(${q(l.role)}, { name: ${q(l.name)}${exact} })`;
    case 'label': return `page.getByLabel(${q(l.value)}${exactOnly})`;
    case 'placeholder': return `page.getByPlaceholder(${q(l.value)}${exactOnly})`;
    case 'text': return `page.getByText(${q(l.value)}${exactOnly})`;
    case 'id': return /^[A-Za-z][\w-]*$/.test(l.value) ? `page.locator(${q(`#${l.value}`)})` : `page.locator(${q(`[id=${JSON.stringify(l.value)}]`)})`;
    case 'xpath': return `page.locator(${q(`xpath=${l.value}`)})`;
    default: return `page.locator(${q(l.value)})`;
  }
}

function pyLocator(target) {
  const l = ensureLocator(target);
  const exact = target.resolved ? ', exact=True' : '';
  switch (l.strategy) {
    case 'testid': return `page.get_by_test_id(${q(l.value)})`;
    case 'role': return `page.get_by_role(${q(l.role)}, name=${q(l.name)}${exact})`;
    case 'label': return `page.get_by_label(${q(l.value)}${exact})`;
    case 'placeholder': return `page.get_by_placeholder(${q(l.value)}${exact})`;
    case 'text': return `page.get_by_text(${q(l.value)}${exact})`;
    case 'id': return /^[A-Za-z][\w-]*$/.test(l.value) ? `page.locator(${q(`#${l.value}`)})` : `page.locator(${q(`[id=${JSON.stringify(l.value)}]`)})`;
    case 'xpath': return `page.locator(${q(`xpath=${l.value}`)})`;
    default: return `page.locator(${q(l.value)})`;
  }
}

const UI_ONLY = 'API check in a UI test: move it to the API suite';

function tsLine(a) {
  const loc = a.target ? tsLocator(a.target) : null;
  switch (a.type) {
    case 'goto': return a.launch ? '// The app opens at baseURL' : `await page.goto(${q(a.url ?? '/')});`;
    case 'click': return `await ${loc}.click();`;
    case 'fill': return `await ${loc}.fill(${q(a.value)});`;
    case 'select': return `await ${loc}.selectOption(${q(a.value)});`;
    case 'check': return `await ${loc}.check();`;
    case 'uncheck': return `await ${loc}.uncheck();`;
    case 'hover': return `await ${loc}.hover();`;
    case 'press': return loc ? `await ${loc}.press(${q(a.key)});` : `await page.keyboard.press(${q(a.key)});`;
    case 'wait': return `await page.waitForTimeout(${a.ms});`;
    case 'expectVisible': return `await expect(${loc}).toBeVisible();`;
    case 'expectHidden': return `await expect(${loc}).toBeHidden();`;
    case 'expectEnabled': return `await expect(${loc}).toBeEnabled();`;
    case 'expectDisabled': return `await expect(${loc}).toBeDisabled();`;
    case 'expectValue': return `await expect(${loc}).toHaveValue(${q(a.value)});`;
    case 'expectText': return `await expect(page.getByText(${q(a.text)}).first()).toBeVisible();`;
    case 'expectUrl': return `await expect(page).toHaveURL(new RegExp(${q(escapeRegex(a.value))}, 'i'));`;
    case 'expectTitle': return `await expect(page).toHaveTitle(new RegExp(${q(escapeRegex(a.value))}, 'i'));`;
    default: return `// TODO (manual): ${UI_ONLY}`;
  }
}

function pyLine(a) {
  const loc = a.target ? pyLocator(a.target) : null;
  switch (a.type) {
    case 'goto': return a.launch ? '# The app opens at base_url' : `page.goto(${q(a.url ?? '/')})`;
    case 'click': return `${loc}.click()`;
    case 'fill': return `${loc}.fill(${q(a.value)})`;
    case 'select': return `${loc}.select_option(${q(a.value)})`;
    case 'check': return `${loc}.check()`;
    case 'uncheck': return `${loc}.uncheck()`;
    case 'hover': return `${loc}.hover()`;
    case 'press': return loc ? `${loc}.press(${q(a.key)})` : `page.keyboard.press(${q(a.key)})`;
    case 'wait': return `page.wait_for_timeout(${a.ms})`;
    case 'expectVisible': return `expect(${loc}).to_be_visible()`;
    case 'expectHidden': return `expect(${loc}).to_be_hidden()`;
    case 'expectEnabled': return `expect(${loc}).to_be_enabled()`;
    case 'expectDisabled': return `expect(${loc}).to_be_disabled()`;
    case 'expectValue': return `expect(${loc}).to_have_value(${q(a.value)})`;
    case 'expectText': return `expect(page.get_by_text(${q(a.text)}).first).to_be_visible()`;
    case 'expectUrl': return `expect(page).to_have_url(re.compile(re.escape(${q(a.value)}), re.IGNORECASE))`;
    case 'expectTitle': return `expect(page).to_have_title(re.compile(re.escape(${q(a.value)}), re.IGNORECASE))`;
    default: return `# TODO (manual): ${UI_ONLY}`;
  }
}

export function playwrightTypescript(plans, { baseUrl, projectName }) {
  const names = uniqueNames(plans, (p) => slug([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `// ${c}`, line: tsLine, indent: '  ' });
    const title = [plan.test.id, plan.test.title].filter(Boolean).join(' ');
    return {
      path: `tests/${names[i]}.spec.ts`,
      content: `import { test, expect } from '@playwright/test';

/**
${headerLines(plan).map((l) => ` * ${l}`).join('\n')}
 */
test(${q(title)}, async ({ page }) => {
${lines.join('\n')}
});
`,
    };
  });
  files.push(
    { path: 'package.json', content: JSON.stringify({ name: slug(projectName), private: true, scripts: { test: 'playwright test', 'test:headed': 'playwright test --headed', report: 'playwright show-report' }, devDependencies: { '@playwright/test': VERSIONS.playwrightNpm } }, null, 2) + '\n' },
    {
      path: 'playwright.config.ts',
      content: `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Set BASE_URL to run against another environment.
    baseURL: process.env.BASE_URL ?? ${q(baseUrl || 'http://localhost:3000')},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
`,
    },
    { path: '.gitignore', content: 'node_modules/\ntest-results/\nplaywright-report/\n' },
  );
  return {
    files,
    run: ['npm install', 'npx playwright install chromium', 'npx playwright test'],
    env: [['BASE_URL', 'The app under test', baseUrl || 'http://localhost:3000']],
  };
}

export function playwrightPython(plans, { baseUrl }) {
  const names = uniqueNames(plans, (p) => snake([p.test.id, p.test.title].filter(Boolean).join(' ')));
  const files = plans.map((plan, i) => {
    const lines = body(plan, { comment: (c) => `# ${c}`, line: pyLine, indent: '    ' });
    const usesRe = lines.some((l) => l.includes('re.compile'));
    return {
      path: `tests/test_${names[i]}.py`,
      content: `${usesRe ? 'import re\n\n' : ''}from playwright.sync_api import Page, expect


def test_${names[i]}(page: Page) -> None:
    """
${headerLines(plan).map((l) => `    ${l}`).join('\n')}
    """
${lines.join('\n')}
`,
    };
  });
  files.push(
    { path: 'requirements.txt', content: `pytest>=${VERSIONS.pytest}\npytest-playwright>=${VERSIONS.pytestPlaywright}\n` },
    { path: 'pytest.ini', content: `[pytest]\n# Override with: pytest --base-url https://staging.example.com\nbase_url = ${baseUrl || 'http://localhost:3000'}\naddopts = --browser chromium\n` },
    { path: '.gitignore', content: '__pycache__/\n.pytest_cache/\ntest-results/\n.venv/\n' },
  );
  return {
    files,
    run: ['python -m venv .venv && .venv\\Scripts\\activate   (macOS/Linux: source .venv/bin/activate)', 'pip install -r requirements.txt', 'playwright install chromium', 'pytest'],
    env: [['--base-url', 'pytest option overriding base_url in pytest.ini', baseUrl || 'http://localhost:3000']],
  };
}
