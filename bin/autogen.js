#!/usr/bin/env node
// autogen generate <tests.xlsx|.csv|.json|.txt> --framework playwright --language typescript
//                  [--base-url http://localhost:3000] [--explore] [--verify] [--out dir]
//                  [--planner auto|rules|claude] [--headed]
// autogen serve [--port 9330]
// autogen targets
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readManualTests } from '../src/input/read.js';
import { convert } from '../src/agent.js';
import { FRAMEWORKS, LANGUAGE_LABELS } from '../src/model.js';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

async function generate() {
  const input = args[1];
  if (!input || input.startsWith('--')) throw new Error('Give the manual tests file: autogen generate tests.xlsx --framework playwright --language typescript');
  const framework = flag('framework', 'playwright');
  const language = flag('language', FRAMEWORKS[framework]?.languages[0]);
  const baseUrl = flag('base-url', '');
  const out = resolve(flag('out', `generated/${framework}-${language}`));
  const tests = await readManualTests({ name: basename(input), data: await readFile(input) });
  console.log(`${tests.length} manual test${tests.length === 1 ? '' : 's'} read from ${input}`);

  let last = '';
  const result = await convert(tests, {
    framework, language, baseUrl,
    explore: has('explore'), verify: has('verify'), planner: flag('planner', 'auto'), headless: !has('headed'),
    onProgress: (p) => {
      const line = p.stage === 'plan' ? `Planning ${p.index + 1}/${p.total}: ${p.test}` : p.stage === 'explore' ? `Exploring ${baseUrl}${p.test ? `: ${p.test}` : ''}` : p.stage === 'verify' ? 'Running the generated tests' : p.stage === 'emit' ? 'Writing code' : '';
      if (line && line !== last) console.log(`  ${line}`);
      last = line;
    },
  });

  for (const f of result.project.files) {
    await mkdir(dirname(join(out, f.path)), { recursive: true });
    await writeFile(join(out, f.path), f.content);
  }
  for (const w of result.warnings) console.log(`! ${w}`);
  console.log(`\n${FRAMEWORKS[framework].label} (${LANGUAGE_LABELS[language]}) project written to ${out}  [planned with ${result.planner}${result.explored ? `, explored ${baseUrl}` : ''}]`);
  for (const r of result.project.report) console.log(`  ${[r.id, r.title].filter(Boolean).join(' ')}: ${r.automated}/${r.total} actions automated${r.todo ? `, ${r.todo} to review` : ''}`);
  if (result.verification) {
    const v = result.verification;
    if (!v.ran) console.log(`\nNot run: ${v.reason}`);
    else {
      console.log(`\nRan the generated tests: ${v.passed} passed, ${v.failed} failed`);
      for (const t of v.tests) console.log(`  ${t.ok ? '✔' : '✖'} ${t.title}${t.error ? `\n      ${t.error.split('\n').join('\n      ')}` : ''}`);
    }
  }
  console.log(`\nNext: cd "${out}" and see README.md`);
}

async function serve() {
  const { startServer } = await import('../src/server.js');
  // Render and other hosts set PORT and need HOST=0.0.0.0.
  const s = await startServer({ port: Number(flag('port', process.env.PORT || 9330)), host: flag('host', process.env.HOST || '127.0.0.1') });
  console.log(`Automation script agent: ${s.url}`);
}

function targets() {
  for (const [key, f] of Object.entries(FRAMEWORKS)) console.log(`${key.padEnd(11)} ${f.languages.join(', ')}`);
}

const commands = { generate, serve, targets };
if (!commands[command]) {
  console.log(`Usage:
  autogen generate <tests.xlsx|.csv|.json|.txt> --framework <playwright|selenium|appium|api> --language <typescript|java|python>
                   [--base-url <url>] [--explore] [--verify] [--out <dir>] [--planner auto|rules|claude] [--headed]
  autogen serve [--port 9330]
  autogen targets`);
  process.exit(command ? 1 : 0);
}
try {
  await commands[command]();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
