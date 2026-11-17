// Manual tests from the formats QA already has: an Excel or CSV export with
// one row per step (testcase-generator, TestRail, Xray, Zephyr), JSON
// (testcase-generator's cases), or pasted text.
import ExcelJS from 'exceljs';
import { normalizeTest } from '../model.js';

const COLUMN_ALIASES = {
  id: ['id', 'test case id', 'tc id', 'case id', 'key', 'test id'],
  title: ['title', 'test case', 'test case title', 'test case name', 'summary', 'name', 'test name'],
  description: ['description', 'objective'],
  preconditions: ['preconditions', 'pre-conditions', 'precondition', 'pre conditions', 'prerequisites'],
  stepNo: ['step #', 'step no', 'step number', 'step no.', '#', 's.no'],
  action: ['step', 'steps', 'action', 'test step', 'test steps', 'step description', 'step action'],
  expected: ['expected result', 'expected results', 'expected', 'expected outcome', 'expected behaviour', 'expected behavior'],
  priority: ['priority'],
  category: ['type', 'category', 'test type'],
  platform: ['platform', 'component'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function mapHeader(cells) {
  const map = {};
  cells.forEach((cell, i) => {
    const h = norm(cell);
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (map[key] === undefined && aliases.includes(h)) map[key] = i;
    }
  });
  return map.action !== undefined && (map.title !== undefined || map.id !== undefined) ? map : null;
}

// A cell holding "1. Open…\n2. Click…" is several steps.
function splitNumbered(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^\d+[.)]\s/.test(l))) return lines.map((l) => l.replace(/^\d+[.)]\s+/, ''));
  return lines.length ? [lines.join(' ')] : [];
}

/** Rows (arrays of cell text) with a header row somewhere in the first 10 -> ManualTest[]. */
export function testsFromRows(rows) {
  let headerAt = -1;
  let map = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    map = mapHeader(rows[i]);
    if (map) {
      headerAt = i;
      break;
    }
  }
  if (!map) throw new Error('No header row found. Expected columns such as "Title" (or "ID") and "Step", with "Expected result" optional.');

  const tests = [];
  let current = null;
  const cell = (row, key) => (map[key] === undefined ? '' : String(row[map[key]] ?? '').trim());
  for (const row of rows.slice(headerAt + 1)) {
    const id = cell(row, 'id');
    const title = cell(row, 'title');
    // A row with its own id or title starts a case; rows without continue it.
    if (id || title || !current) {
      if (!id && !title && !cell(row, 'action') && !cell(row, 'expected')) continue;
      current = {
        id, title,
        description: cell(row, 'description'),
        preconditions: splitNumbered(cell(row, 'preconditions')).flatMap((p) => p.split(/\r?\n/)),
        priority: cell(row, 'priority') || null,
        category: cell(row, 'category') || null,
        platform: cell(row, 'platform') || null,
        steps: [],
      };
      tests.push(current);
    }
    const actions = splitNumbered(cell(row, 'action'));
    const expected = cell(row, 'expected').replace(/^\d+[.)]\s+/gm, '').trim();
    if (actions.length) {
      actions.forEach((a, i) => current.steps.push({ action: a, expected: i === actions.length - 1 ? expected : '' }));
    } else if (expected) {
      const last = current.steps.at(-1);
      if (last) last.expected = [last.expected, expected].filter(Boolean).join('\n');
      else current.steps.push({ action: '', expected });
    }
  }
  return tests.filter((t) => t.steps.length).map(normalizeTest);
}

export async function readXlsx(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  for (const sheet of workbook.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (c, col) => {
        cells[col - 1] = c.text ?? '';
      });
      rows.push(Array.from(cells, (v) => v ?? ''));
    });
    try {
      return testsFromRows(rows);
    } catch {
      // not a test sheet (e.g. "Test Data"): try the next one
    }
  }
  throw new Error('No sheet in the workbook has a test case header row ("Title"/"ID" and "Step").');
}

/** RFC 4180 CSV; the delimiter (comma, semicolon or tab) is taken from the header line. */
export function parseCsv(text) {
  const head = text.split(/\r?\n/, 1)[0];
  const delimiter = [',', ';', '\t'].sort((a, b) => head.split(b).length - head.split(a).length)[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === '') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** testcase-generator cases ({ title, steps[], stepResults[], expectedResults[] }) or this tool's own shape. */
export function testsFromJson(value) {
  const list = Array.isArray(value) ? value : value.testCases || value.cases || value.items || [value];
  return list.map((t, i) => {
    const steps = (t.steps || []).map((s, n) => {
      if (typeof s !== 'string') return s;
      const perStep = t.stepResults?.[n] ?? '';
      const last = n === t.steps.length - 1 && !t.stepResults?.length ? (t.expectedResults || []).join('\n') : '';
      return { action: s, expected: perStep || last };
    });
    return normalizeTest({
      id: t.key ?? t.id,
      title: t.title ?? t.name,
      description: t.description,
      preconditions: t.preconditions,
      steps,
      priority: t.priority,
      category: t.category ?? t.testTypeLabel,
      platform: t.platformLabel ?? t.platform,
    }, i);
  });
}

/**
 * Pasted text. A case starts at a line like "TC-1 Login works", "Test case: …"
 * or "# …"; numbered lines are steps; "Expected: …" belongs to the step above
 * it; "Precondition: …" lines are preconditions.
 */
export function testsFromText(text) {
  const tests = [];
  let current = null;
  const start = (title) => {
    const m = title.match(/^([A-Z][A-Z0-9]*-\d+)\s*[:\-–]?\s*(.*)$/);
    current = { id: m ? m[1] : '', title: m ? m[2] : title, preconditions: [], steps: [] };
    tests.push(current);
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = line.match(/^(?:#+\s*|test\s*case\s*[:\-]\s*|title\s*:\s*)(.+)$/i)) || /^[A-Z][A-Z0-9]*-\d+\b/.test(line)) {
      start(m ? m[1].trim() : line);
    } else if ((m = line.match(/^pre-?conditions?\s*:\s*(.*)$/i))) {
      if (!current) start('Untitled test');
      if (m[1]) current.preconditions.push(m[1]);
    } else if ((m = line.match(/^(?:expected(?:\s+result)?s?|then|verify that)\s*:\s*(.+)$/i))) {
      if (!current) start('Untitled test');
      const last = current.steps.at(-1);
      if (last) last.expected = [last.expected, m[1]].filter(Boolean).join('\n');
      else current.steps.push({ action: '', expected: m[1] });
    } else if ((m = line.match(/^(?:step\s*)?\d+[.):]\s*(.+)$/i)) || (m = line.match(/^[-*•]\s+(.+)$/))) {
      if (!current) start('Untitled test');
      current.steps.push({ action: m[1], expected: '' });
    } else if (current && !current.steps.length) {
      current.preconditions.push(line);
    } else {
      if (!current) start('Untitled test');
      current.steps.push({ action: line, expected: '' });
    }
  }
  return tests.filter((t) => t.steps.length).map(normalizeTest);
}

/** { name, data: Buffer | string } -> ManualTest[] */
export async function readManualTests({ name = 'tests.txt', data }) {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'txt').toLowerCase();
  if (ext === 'xlsx') return readXlsx(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const text = Buffer.isBuffer(data) ? data.toString('utf8').replace(/^﻿/, '') : String(data);
  if (ext === 'csv' || ext === 'tsv') return testsFromRows(parseCsv(text));
  if (ext === 'json') return testsFromJson(JSON.parse(text));
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return testsFromJson(JSON.parse(trimmed));
  // Pasted spreadsheet rows (CSV, or tab-separated straight from Excel) keep their columns.
  const firstLine = trimmed.split(/\r?\n/, 1)[0];
  if (/[,;\t]/.test(firstLine)) {
    const rows = parseCsv(trimmed);
    if (rows.length && mapHeader(rows[0])) return testsFromRows(rows);
  }
  return testsFromText(text);
}
