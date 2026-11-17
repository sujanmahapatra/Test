import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClaudePlanner, toActions } from '../src/plan/claude.js';

const manual = {
  id: 'TC-1', title: 'Sign in', description: '', preconditions: ['On the shop site'],
  steps: [{ action: 'Log in as ana', expected: 'The dashboard greets her' }],
};
const empty = { url: null, value: null, text: null, key: null, ms: null, method: null, path: null, body: null, headers: [], status: null, jsonPath: null, equals: null, contains: null, note: null, target: null };

test('the planner asks for schema-shaped actions and maps them to the plan', async () => {
  const calls = [];
  const client = {
    beta: {
      messages: {
        create: async (body) => {
          calls.push(body);
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ actions: [
              { ...empty, type: 'fill', sourceKind: 'step', sourceStep: 1, target: { description: 'Email', role: 'textbox' }, value: 'ana@example.com' },
              { ...empty, type: 'click', sourceKind: 'step', sourceStep: 1, target: { description: 'Sign in', role: 'button' } },
              { ...empty, type: 'expectText', sourceKind: 'expected', sourceStep: 1, text: 'Welcome, Ana' },
            ] }) }],
          };
        },
      },
    },
  };
  const plan = await createClaudePlanner({ client })(manual, { framework: 'playwright', kind: 'web' });
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.equal(calls[0].output_config.format.type, 'json_schema');
  assert.equal(calls[0].fallbacks, 'default');
  assert.match(calls[0].messages[0].content, /1\. Log in as ana\n\s+Expected: The dashboard greets her/);
  assert.deepEqual(plan.actions.map((a) => a.type), ['fill', 'click', 'expectText']);
  assert.equal(plan.actions[0].source.text, 'Log in as ana');
  assert.equal(plan.actions[2].source.text, 'The dashboard greets her');
  assert.deepEqual(plan.actions[1].target, { description: 'Sign in', role: 'button', locator: null, resolved: false });
});

test('incomplete or invented actions become manual instead of broken code', () => {
  const actions = toActions(manual, [
    { ...empty, type: 'goto', sourceKind: 'step', sourceStep: 1 },
    { ...empty, type: 'fill', sourceKind: 'step', sourceStep: 1, target: { description: 'Email', role: null } },
    { ...empty, type: 'request', sourceKind: 'step', sourceStep: 1, method: 'post', path: '/api/x', body: '{not json' },
    { ...empty, type: 'expectStatus', sourceKind: 'expected', sourceStep: 1, status: 201 },
    { ...empty, type: 'expectBody', sourceKind: 'expected', sourceStep: 1, jsonPath: 'id' },
    { ...empty, type: 'manual', sourceKind: 'precondition', sourceStep: 0, note: 'needs a seeded account' },
  ]);
  assert.deepEqual(actions.map((a) => a.type), ['manual', 'manual', 'request', 'expectStatus', 'expectBody', 'manual']);
  assert.equal(actions[2].method, 'POST');
  assert.equal(actions[2].body, null);
  assert.equal(actions[3].code, 201);
  assert.equal(actions[4].exists, true);
  assert.equal(actions[5].source.text, 'On the shop site');
  assert.equal(actions[5].note, 'needs a seeded account');
});

test('a refusal is reported so the agent falls back to the rules', async () => {
  const client = { beta: { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } } };
  await assert.rejects(createClaudePlanner({ client })(manual, { framework: 'playwright', kind: 'web' }), /declined/);
});
