import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAction, parseExpectation, planWithRules } from '../src/plan/rules.js';

const one = (list) => {
  assert.equal(list.length, 1, JSON.stringify(list));
  const [a] = list;
  return { ...a, target: a.target ? `${a.target.description}/${a.target.role}` : undefined };
};

test('navigation, typing, clicking, selecting and checking', () => {
  assert.deepEqual(one(parseAction('Navigate to /login')), { type: 'goto', url: '/login', target: undefined });
  assert.deepEqual(one(parseAction('Go to https://shop.example.com/cart.')), { type: 'goto', url: 'https://shop.example.com/cart', target: undefined });
  assert.equal(one(parseAction('Open /dashboard?email=ana@example.com')).url, '/dashboard?email=ana@example.com');
  assert.deepEqual(one(parseAction('Enter "ana@example.com" in the Email field')), { type: 'fill', value: 'ana@example.com', target: 'Email/textbox' });
  assert.deepEqual(one(parseAction('Fill the Username field with "admin"')), { type: 'fill', value: 'admin', target: 'Username/textbox' });
  assert.deepEqual(one(parseAction('Type secret into Password')), { type: 'fill', value: 'secret', target: 'Password/textbox' });
  assert.deepEqual(one(parseAction('Click on the Login button')), { type: 'click', target: 'Login/button' });
  assert.deepEqual(one(parseAction('Tap "Continue"')), { type: 'click', target: 'Continue/null' });
  assert.deepEqual(one(parseAction('Select "India" from the Country dropdown')), { type: 'select', value: 'India', target: 'Country/combobox' });
  assert.deepEqual(one(parseAction('Check the Remember me checkbox')), { type: 'check', target: 'Remember me/checkbox' });
  assert.deepEqual(one(parseAction('Press Enter')), { type: 'press', key: 'Enter', target: undefined });
  assert.deepEqual(one(parseAction('Wait for 2 seconds')), { type: 'wait', ms: 2000, target: undefined });
});

test('"Click A, then B" is two clicks', () => {
  assert.deepEqual(parseAction('Click Add, then click Save').map((a) => a.target.description), ['Add', 'Save']);
});

test('a page named without a URL navigates to the root and says so', () => {
  const a = one(parseAction('Open the login page'));
  assert.equal(a.type, 'goto');
  assert.equal(a.guessed, true);
  assert.match(a.note, /login page/);
});

test('API requests with bodies and headers', () => {
  const a = parseAction('Send a POST request to /api/users with header X-Team: qa, and body {"name":"Ana"}')[0];
  assert.deepEqual(a, { type: 'request', method: 'POST', path: '/api/users', headers: [{ name: 'X-Team', value: 'qa' }], body: '{"name":"Ana"}' });
  assert.equal(one(parseAction('GET /api/users/1', { kind: 'api' })).path, '/api/users/1');
});

test('expected results become assertions', () => {
  assert.deepEqual(one(parseExpectation('User is redirected to the dashboard')), { type: 'expectUrl', value: 'dashboard', target: undefined });
  assert.deepEqual(one(parseExpectation('Error message "Invalid password" is displayed')), { type: 'expectText', text: 'Invalid password', target: undefined });
  assert.deepEqual(one(parseExpectation('The Welcome banner should be displayed')), { type: 'expectVisible', target: 'Welcome banner/null' });
  assert.deepEqual(one(parseExpectation('The Sign in page is displayed')), { type: 'expectVisible', target: 'Sign in/heading', guessed: true });
  assert.deepEqual(one(parseExpectation('Login button is disabled')), { type: 'expectDisabled', target: 'Login/button' });
  assert.deepEqual(one(parseExpectation('Email field should contain "a@b.c"')), { type: 'expectValue', target: 'Email/textbox', value: 'a@b.c' });
  assert.deepEqual(one(parseExpectation('Page title should be "Shop"')), { type: 'expectTitle', value: 'Shop', target: undefined });
  assert.deepEqual(one(parseExpectation('The modal closes')), { type: 'expectHidden', target: 'modal/null' });
});

test('API expectations: status in numbers or words, fields that exist or equal', () => {
  const out = parseExpectation('Status code should be 201\nResponse contains field "id"\nname equals "Ravi"', { kind: 'api' });
  assert.deepEqual(out, [
    { type: 'expectStatus', code: 201 },
    { type: 'expectBody', path: 'id', exists: true },
    { type: 'expectBody', path: 'name', equals: 'Ravi' },
  ]);
  assert.deepEqual(parseExpectation('Returns 404 Not Found', { kind: 'api' }), [{ type: 'expectStatus', code: 404 }]);
  assert.deepEqual(parseExpectation('user.email equals "ana@example.com"', { kind: 'api' }), [{ type: 'expectBody', path: 'user.email', equals: 'ana@example.com' }]);
});

test('anything unrecognised is a manual step, never a guess', () => {
  assert.equal(one(parseAction('Compare the invoice with last month')).type, 'manual');
  assert.equal(one(parseExpectation('The layout looks right on a tablet')).type, 'manual');
});

test('a plan keeps the order of steps and says where each action came from', () => {
  const plan = planWithRules({
    preconditions: ['User is logged in'],
    steps: [{ action: 'Navigate to /cart', expected: '' }, { action: 'Click Checkout', expected: '"Payment" is displayed' }],
  });
  assert.deepEqual(plan.actions.map((a) => [a.type, a.source.kind, a.source.step]), [
    ['manual', 'precondition', 0], ['goto', 'step', 1], ['click', 'step', 2], ['expectText', 'expected', 2],
  ]);
});
