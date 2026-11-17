// Planning with Claude: the same Plan the rules produce, for manual steps
// written any way at all. Structured outputs hold the answer to a schema, and
// every action is checked again before use.
import Anthropic from '@anthropic-ai/sdk';
import { ACTION_TYPES } from '../model.js';

const nullable = (type) => ({ type: [type, 'null'] });

const SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ACTION_TYPES },
          sourceKind: { type: 'string', enum: ['precondition', 'step', 'expected'] },
          sourceStep: { type: 'integer', description: '1-based step number; 0 for a precondition.' },
          target: {
            anyOf: [
              {
                type: 'object',
                properties: {
                  description: { type: 'string', description: 'The words a user sees on the element: its label, button text, placeholder or heading.' },
                  role: { anyOf: [{ type: 'string', enum: ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'heading', 'dialog', 'img', 'option'] }, { type: 'null' }] },
                },
                required: ['description', 'role'],
                additionalProperties: false,
              },
              { type: 'null' },
            ],
          },
          url: nullable('string'),
          value: nullable('string'),
          text: nullable('string'),
          key: nullable('string'),
          ms: nullable('integer'),
          method: nullable('string'),
          path: nullable('string'),
          body: { anyOf: [{ type: 'string', description: 'JSON text of the request body.' }, { type: 'null' }] },
          headers: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'], additionalProperties: false } },
          status: nullable('integer'),
          jsonPath: { anyOf: [{ type: 'string', description: 'Dot path into the JSON response, e.g. data.items[0].id' }, { type: 'null' }] },
          equals: nullable('string'),
          contains: nullable('string'),
          note: { anyOf: [{ type: 'string', description: 'Why a step is manual, or what a tester must fill in.' }, { type: 'null' }] },
        },
        required: ['type', 'sourceKind', 'sourceStep', 'target', 'url', 'value', 'text', 'key', 'ms', 'method', 'path', 'body', 'headers', 'status', 'jsonPath', 'equals', 'contains', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['actions'],
  additionalProperties: false,
};

const SYSTEM = `You turn manual test cases into automation actions. Code is generated from your actions by templates, and element locators are found later by exploring the real app, so describe elements by what a user sees, never by CSS or XPath.

Action types:
- goto {url}: only a URL or path the test gives; never invent one (use a manual action with a note instead).
- click / fill {value} / select {value} / check / uncheck / hover {target}; press {key, target?}; wait {ms}.
- expectVisible / expectHidden / expectEnabled / expectDisabled {target}; expectValue {target, value}; expectText {text} for a message the page shows; expectUrl {value: a path or URL fragment}; expectTitle {value}.
- request {method, path, headers, body as JSON text}; expectStatus {status}; expectBody {jsonPath with equals | contains | neither for "exists"}.
- manual: anything that cannot be checked by automation (visual judgement, an email inbox, a physical device action) or is too vague to automate. Put the reason in note.

Rules:
- One action per atomic operation, in order. Every expected result becomes one or more assertions placed right after the step it belongs to.
- Copy literal values (emails, passwords, names, numbers) exactly from the test. If a step needs a value the test does not give, use a manual action with a note.
- sourceKind and sourceStep say which precondition, step or expected result each action came from.
- Unused fields are null (headers: []).`;

function describe(test, framework, kind) {
  const lines = [`Framework: ${framework} (${kind === 'api' ? 'API tests: HTTP requests and response checks' : kind === 'mobile' ? 'native mobile app' : 'web app in a browser'})`, `Test: ${[test.id, test.title].filter(Boolean).join(' ')}`];
  if (test.description) lines.push(`Description: ${test.description}`);
  if (test.preconditions.length) lines.push('Preconditions:', ...test.preconditions.map((p, i) => `  P${i + 1}. ${p}`));
  lines.push('Steps:');
  test.steps.forEach((s, i) => {
    lines.push(`  ${i + 1}. ${s.action || '(no action)'}`);
    if (s.expected) lines.push(`     Expected: ${s.expected.replace(/\n/g, ' / ')}`);
  });
  return lines.join('\n');
}

const sourceText = (test, kind, step, index) => {
  if (kind === 'precondition') return test.preconditions[index] ?? test.preconditions[0] ?? '';
  const s = test.steps[step - 1];
  return s ? (kind === 'expected' ? s.expected : s.action) : '';
};

/** Model output -> the Plan's action shape, dropping anything that does not make sense. */
export function toActions(test, raw) {
  const out = [];
  let preconditionIndex = 0;
  for (const a of raw) {
    const step = Math.max(0, Math.min(test.steps.length, a.sourceStep | 0));
    const kind = a.sourceKind === 'precondition' || step === 0 ? 'precondition' : a.sourceKind;
    const source = { step, kind, text: sourceText(test, kind, step, preconditionIndex), ...(kind === 'precondition' ? { index: preconditionIndex } : {}) };
    if (kind === 'precondition') preconditionIndex = Math.min(preconditionIndex + 1, test.preconditions.length - 1);
    const t = a.target ? { description: a.target.description, role: a.target.role, locator: null, resolved: false } : null;
    const base = { source, ...(a.note ? { note: a.note } : {}) };
    switch (a.type) {
      case 'goto': out.push(a.url ? { ...base, type: 'goto', url: a.url } : { ...base, type: 'manual' }); break;
      case 'click': case 'check': case 'uncheck': case 'hover':
      case 'expectVisible': case 'expectHidden': case 'expectEnabled': case 'expectDisabled':
        out.push(t ? { ...base, type: a.type, target: t } : { ...base, type: 'manual' }); break;
      case 'fill': case 'select': case 'expectValue':
        out.push(t && a.value != null ? { ...base, type: a.type, target: t, value: a.value } : { ...base, type: 'manual' }); break;
      case 'press': out.push(a.key ? { ...base, type: 'press', key: a.key, target: t } : { ...base, type: 'manual' }); break;
      case 'wait': out.push({ ...base, type: 'wait', ms: Math.max(0, a.ms ?? 1000) }); break;
      case 'expectText': out.push(a.text ? { ...base, type: 'expectText', text: a.text, target: null } : { ...base, type: 'manual' }); break;
      case 'expectUrl': case 'expectTitle': out.push(a.value ? { ...base, type: a.type, value: a.value } : { ...base, type: 'manual' }); break;
      case 'request': {
        let body = null;
        try {
          body = a.body ? JSON.stringify(JSON.parse(a.body)) : null;
        } catch {
          body = null;
        }
        out.push(a.method && a.path ? { ...base, type: 'request', method: a.method.toUpperCase(), path: a.path, headers: a.headers || [], body } : { ...base, type: 'manual' });
        break;
      }
      case 'expectStatus': out.push(a.status ? { ...base, type: 'expectStatus', code: a.status } : { ...base, type: 'manual' }); break;
      case 'expectBody': {
        if (!a.jsonPath) { out.push({ ...base, type: 'manual' }); break; }
        const check = a.equals != null ? { equals: a.equals } : a.contains != null ? { contains: a.contains } : { exists: true };
        out.push({ ...base, type: 'expectBody', path: a.jsonPath, ...check });
        break;
      }
      default: out.push({ ...base, type: 'manual' });
    }
  }
  return out;
}

export function createClaudePlanner({ model = process.env.AUTOGEN_MODEL || 'claude-opus-5-5', client } = {}) {
  const anthropic = client || new Anthropic();
  return async function plan(test, { framework, kind }) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 16000,
      // A declined request is retried on a fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: describe(test, framework, kind) }],
    });
    if (response.stop_reason === 'refusal') throw new Error('the model declined this test case');
    if (response.stop_reason === 'max_tokens') throw new Error('the plan was cut off; split the test case');
    const text = response.content.find((b) => b.type === 'text')?.text;
    return { test, actions: toActions(test, JSON.parse(text).actions) };
  };
}

export { describe as describeTest };
