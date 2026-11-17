// End to end against the demo app: plan with the rules, explore in a real
// browser, write the project, and run it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startDemoApp } from '../examples/demo-app.js';
import { readManualTests } from '../src/input/read.js';
import { convert } from '../src/agent.js';

let app;
before(async () => {
  app = await startDemoApp(0);
});
after(() => app.close());

const read = async (name) => readManualTests({ name, data: await readFile(new URL(`../examples/${name}`, import.meta.url)) });

test('Playwright TypeScript: explored locators, checks verified, generated tests pass', async () => {
  const result = await convert(await read('manual-tests.csv'), { framework: 'playwright', language: 'typescript', baseUrl: app.url, explore: true, verify: true, planner: 'rules' });
  const tc1 = result.plans[0].actions;
  const byStep = (n, type) => tc1.find((a) => a.source.step === n && a.type === type);
  assert.deepEqual(byStep(2, 'fill').target.locator, { strategy: 'role', role: 'textbox', name: 'Email' });
  assert.deepEqual(byStep(5, 'click').target.locator, { strategy: 'testid', value: 'sign-in' });
  assert.deepEqual(byStep(1, 'expectVisible').target.locator, { strategy: 'role', role: 'heading', name: 'Sign in' });
  assert.equal(byStep(5, 'expectText').status, 'verified');
  assert.deepEqual(result.verification.tests.map((t) => t.ok), [true, true, true]);
});

test('Selenium: the explorer records id, CSS and XPath locators', async () => {
  const result = await convert(await read('manual-tests.csv'), { framework: 'selenium', language: 'java', baseUrl: app.url, explore: true, planner: 'rules' });
  const strategies = result.plans.flatMap((p) => p.actions).filter((a) => a.target?.resolved).map((a) => a.target.locator.strategy);
  assert.ok(strategies.length >= 8);
  assert.ok(strategies.every((s) => ['id', 'css', 'xpath'].includes(s)), strategies.join(','));
  const test = result.project.files.find((f) => f.path.endsWith('Tc1SignInWithValidCredentialsTest.java')).content;
  assert.match(test, /type\(By\.id\("email"\), "ana@example\.com"\);/);
});

test('API TypeScript: requests run against the service, generated tests pass', async () => {
  const result = await convert(await read('api-tests.csv'), { framework: 'api', language: 'typescript', baseUrl: app.url, explore: true, verify: true, planner: 'rules' });
  const statuses = result.plans.flatMap((p) => p.actions).filter((a) => a.type.startsWith('expect')).map((a) => a.status);
  assert.ok(statuses.every((s) => s === 'verified'), statuses.join(','));
  assert.deepEqual(result.verification.tests.map((t) => t.ok), [true, true, true, true]);
});

test('a manual expectation the app does not meet is flagged, and the generated test fails on it', async () => {
  const tests = await readManualTests({ name: 'x.txt', data: 'TC-9 Wrong expectation\n1. Navigate to /login\n2. Click the Sign in button\nExpected: "Welcome back" is displayed' });
  const result = await convert(tests, { framework: 'playwright', language: 'typescript', baseUrl: app.url, explore: true, verify: true, planner: 'rules' });
  const check = result.plans[0].actions.find((a) => a.type === 'expectText');
  assert.equal(check.status, 'failed');
  assert.match(check.note, /"Welcome back" is not on the page/);
  assert.equal(result.verification.failed, 1);
});
