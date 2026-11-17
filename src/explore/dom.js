// Runs inside the browser through page.evaluate, so every function here must
// be self-contained: no imports, no closures over module scope.

/** Visible elements a step could mean, each marked data-agent-cand="<index>". */
export function scanCandidates({ limit = 1500 } = {}) {
  const TEXT_TAGS = ['div', 'span', 'p', 'li', 'td', 'th', 'dt', 'dd', 'strong', 'em', 'b', 'i', 'small', 'label', 'legend', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
  const SELECTOR = [
    'a', 'button', 'input', 'select', 'textarea', 'summary', 'img', 'option', 'label',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role]', '[data-testid]', '[data-test]', '[data-qa]', '[data-cy]',
    '[onclick]', '[tabindex]', '[contenteditable=""]', '[contenteditable="true"]', ...TEXT_TAGS,
  ].join(',');
  const TEST_ATTRS = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
  const IMPLICIT = {
    button: 'button', select: 'combobox', textarea: 'textbox', img: 'img', li: 'listitem', option: 'option', summary: 'button',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', dialog: 'dialog',
  };
  const INPUT_ROLES = { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', reset: 'button', image: 'button', range: 'slider', number: 'spinbutton', search: 'searchbox' };
  const clean = (s, max = 120) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') return INPUT_ROLES[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox';
    if (tag === 'a') return el.hasAttribute('href') ? 'link' : '';
    return IMPLICIT[tag] || '';
  };
  const labelOf = (el) => {
    if (el.labels && el.labels.length) return clean(el.labels[0].innerText);
    const ids = el.getAttribute('aria-labelledby');
    if (ids) return clean(ids.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
    return '';
  };
  const cssPath = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 8; n = n.parentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) {
        parts.unshift('#' + CSS.escape(n.id));
        break;
      }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };

  document.querySelectorAll('[data-agent-cand]').forEach((e) => e.removeAttribute('data-agent-cand'));
  const out = [];
  for (const el of document.querySelectorAll(SELECTOR)) {
    if (out.length >= limit) break;
    if (!isVisible(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (TEXT_TAGS.includes(tag) && !el.matches('[role],[data-testid],[data-test],[data-qa],[data-cy],[onclick],[tabindex],h1,h2,h3,h4,h5,h6,label')) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
      if (!clean(own)) continue;
    }
    const testIdAttr = TEST_ATTRS.find((a) => el.hasAttribute(a)) || '';
    const type = (el.getAttribute('type') || '').toLowerCase();
    el.setAttribute('data-agent-cand', String(out.length));
    const within = el.parentElement?.closest('[data-agent-cand]');
    out.push({
      index: out.length,
      within: within ? Number(within.getAttribute('data-agent-cand')) : null,
      tag, type,
      id: el.id || '',
      testIdAttr, testId: testIdAttr ? el.getAttribute(testIdAttr) : '',
      name: el.getAttribute('name') || '',
      role: roleOf(el),
      text: clean(el.innerText || el.textContent),
      ariaLabel: clean(el.getAttribute('aria-label')),
      label: labelOf(el),
      placeholder: clean(el.getAttribute('placeholder')),
      title: clean(el.getAttribute('title')),
      alt: clean(el.getAttribute('alt')),
      value: tag === 'input' && ['submit', 'button', 'reset'].includes(type) ? clean(el.value) : '',
      path: cssPath(el),
      editable: el.isContentEditable || ['input', 'textarea', 'select'].includes(tag),
      disabled: !!el.disabled,
    });
  }
  return out;
}

/** The first { using, value } (css selector | xpath) that finds exactly candidate `index`, or null. */
export function firstUnique(options, index) {
  for (const option of options) {
    const found = [];
    try {
      if (option.using === 'css') {
        found.push(...document.querySelectorAll(option.value));
      } else {
        const r = document.evaluate(option.value, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < r.snapshotLength; i++) found.push(r.snapshotItem(i));
      }
    } catch {
      continue;
    }
    if (found.length === 1 && found[0].getAttribute('data-agent-cand') === String(index)) return option;
  }
  return null;
}

export function clearMarkers() {
  document.querySelectorAll('[data-agent-cand]').forEach((e) => e.removeAttribute('data-agent-cand'));
}
