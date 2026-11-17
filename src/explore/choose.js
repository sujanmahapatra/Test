// When a step's words match two elements equally well ("Save" in a dialog and
// in the page footer), Claude picks the one the step means, or none.
import Anthropic from '@anthropic-ai/sdk';

const SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer', description: 'Candidate index, or -1 if none is the element the step means.' },
    reason: { type: 'string' },
  },
  required: ['index', 'reason'],
  additionalProperties: false,
};

const compact = (c) => Object.fromEntries(Object.entries(c).filter(([k, v]) => !['path', 'within', 'editable', 'testIdAttr'].includes(k) && v !== '' && v !== false && v != null));

export function createClaudeChooser({ model = process.env.AUTOGEN_MODEL || 'claude-opus-5-5', client } = {}) {
  const anthropic = client || new Anthropic();
  return async function choose({ target, type, step, url, candidates }) {
    const response = await anthropic.beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: 'You map a manual test step to the page element it means. Answer -1 when no candidate is clearly that element; a wrong element makes a test pass for the wrong reason.',
      messages: [{
        role: 'user',
        content: `Page: ${url}\nStep: ${step}\nAction: ${type} on "${target.description}"${target.role ? ` (a ${target.role})` : ''}\n\nVisible candidates:\n${candidates.map((c) => JSON.stringify(compact(c))).join('\n')}`,
      }],
    });
    if (response.stop_reason !== 'end_turn') return null;
    const answer = JSON.parse(response.content.find((b) => b.type === 'text')?.text ?? '{}');
    return answer.index >= 0 ? answer : null;
  };
}
