import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readManualTests, testsFromText, parseCsv } from '../src/input/read.js';

test('an Excel export with one row per step, like testcase-generator writes', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Test Cases');
  sheet.addRow(['ID', 'Title', 'Scenario', 'Description', 'Preconditions', 'Step #', 'Step', 'Expected result', 'Priority']);
  sheet.addRow(['TC-1', 'Sign in', 'Auth', '', '1. User has an account\n2. User is signed out', 1, 'Navigate to /login', '', 'High']);
  sheet.addRow(['', '', '', '', '', 2, 'Click Sign in', 'Dashboard is displayed', '']);
  sheet.addRow(['TC-2', 'Sign out', '', '', '', 1, 'Click Sign out', '', 'Low']);
  workbook.addWorksheet('Test Data').addRow(['ID', 'Title', 'Run', 'Values']);
  const tests = await readManualTests({ name: 'cases.xlsx', data: Buffer.from(await workbook.xlsx.writeBuffer()) });
  assert.equal(tests.length, 2);
  assert.deepEqual(tests[0].preconditions, ['User has an account', 'User is signed out']);
  assert.deepEqual(tests[0].steps, [{ action: 'Navigate to /login', expected: '' }, { action: 'Click Sign in', expected: 'Dashboard is displayed' }]);
  assert.equal(tests[1].priority, 'Low');
});

test('CSV with quoted multi-line cells, semicolons, and several steps in one cell', async () => {
  const csv = 'Test case;Steps;Expected\n"Search";"1. Open /\n2. Type ""shoes"" into Search";"Results ""shoes"" are shown"\n';
  const [t] = await readManualTests({ name: 'x.csv', data: csv });
  assert.equal(t.title, 'Search');
  assert.deepEqual(t.steps.map((s) => s.action), ['Open /', 'Type "shoes" into Search']);
  assert.equal(t.steps[1].expected, 'Results "shoes" are shown');
});

test('CSV without a recognisable header is refused with the columns it needs', async () => {
  await assert.rejects(readManualTests({ name: 'x.csv', data: 'a,b\n1,2\n' }), /Title.*Step/);
});

test('testcase-generator JSON: per-step results, or the final expected results on the last step', async () => {
  const json = JSON.stringify([
    { key: 'QA-1', title: 'A', steps: ['one', 'two'], stepResults: ['r1', 'r2'], expectedResults: ['ignored'] },
    { title: 'B', steps: ['one', 'two'], expectedResults: ['done', 'saved'] },
  ]);
  const [a, b] = await readManualTests({ name: 'cases.json', data: json });
  assert.equal(a.id, 'QA-1');
  assert.deepEqual(a.steps.map((s) => s.expected), ['r1', 'r2']);
  assert.deepEqual(b.steps.map((s) => s.expected), ['', 'done\nsaved']);
});

test('pasted text: cases, preconditions, numbered steps and Expected lines', () => {
  const tests = testsFromText(`TC-7 Reset password
Precondition: user exists
1. Open /forgot
2. Click Send link
Expected: "Check your inbox" is displayed

# Second case
- Navigate to /
- Click Help`);
  assert.equal(tests.length, 2);
  assert.equal(tests[0].id, 'TC-7');
  assert.equal(tests[0].title, 'Reset password');
  assert.deepEqual(tests[0].preconditions, ['user exists']);
  assert.equal(tests[0].steps[1].expected, '"Check your inbox" is displayed');
  assert.equal(tests[1].title, 'Second case');
  assert.equal(tests[1].steps.length, 2);
});

test('spreadsheet rows pasted as text keep their columns', async () => {
  const pasted = 'ID\tTitle\tStep\tExpected result\nTC-1\tLogin\tClick Sign in\tWelcome is displayed\n';
  const [t] = await readManualTests({ name: 'pasted.txt', data: pasted });
  assert.equal(t.title, 'Login');
  assert.equal(t.steps[0].expected, 'Welcome is displayed');
});

test('parseCsv keeps empty cells and handles CRLF', () => {
  assert.deepEqual(parseCsv('a,b,c\r\n1,,3\r\n'), [['a', 'b', 'c'], ['1', '', '3']]);
});
