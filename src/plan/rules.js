// Deterministic planning: the phrasing manual testers use most, turned into
// actions. Works offline and is unit-tested. Anything it does not recognise
// becomes a `manual` action, emitted as a TODO, never a guess.

const QUOTED = /["“”'‘’`]([^"“”'‘’`]+)["“”'‘’`]/;
const ROLE_WORDS = {
  button: 'button', btn: 'button', link: 'link', hyperlink: 'link', tab: 'tab', checkbox: 'checkbox', 'check box': 'checkbox',
  radio: 'radio', 'radio button': 'radio', dropdown: 'combobox', 'drop-down': 'combobox', 'drop down': 'combobox', select: 'combobox',
  field: 'textbox', textbox: 'textbox', 'text box': 'textbox', 'text field': 'textbox', input: 'textbox', 'input field': 'textbox', box: 'textbox',
  icon: 'button', menu: 'menuitem', 'menu item': 'menuitem', option: 'option', heading: 'heading', header: 'heading', title: 'heading',
  message: null, label: null, text: null, section: null, page: null, popup: 'dialog', 'pop-up': 'dialog', modal: 'dialog', dialog: 'dialog',
};
const ROLE_SUFFIX = new RegExp(`\\s+(${Object.keys(ROLE_WORDS).sort((a, b) => b.length - a.length).join('|')})$`, 'i');
const KEYS = { enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', space: 'Space', backspace: 'Backspace', 'arrow down': 'ArrowDown', 'arrow up': 'ArrowUp' };
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const STATUS_WORDS = { ok: 200, created: 201, accepted: 202, 'no content': 204, 'bad request': 400, unauthorized: 401, unauthorised: 401, forbidden: 403, 'not found': 404, conflict: 409, 'unprocessable entity': 422, 'internal server error': 500 };

const clean = (s) => String(s || '').trim().replace(/^(?:\d+[.)]\s*|[-*•]\s*)/, '').replace(/[.;]+$/, '').trim();
const unquote = (s) => {
  const m = String(s).match(QUOTED);
  return (m ? m[1] : String(s)).trim();
};
const stripArticles = (s) => s.replace(/^(?:the|a|an|on|on the|into|in|to)\s+/i, '').trim();

/** "the Email address field" -> { description: 'Email address', role: 'textbox' } */
export function target(phrase, defaultRole = null) {
  let description = stripArticles(stripArticles(String(phrase).trim()));
  let role = defaultRole;
  const quoted = description.match(QUOTED);
  const suffix = description.match(ROLE_SUFFIX);
  if (suffix) {
    const r = ROLE_WORDS[suffix[1].toLowerCase()];
    if (r !== undefined && (r || !role)) role = r ?? role;
    description = description.slice(0, suffix.index).trim();
  }
  if (quoted) description = quoted[1];
  description = description.replace(/^(?:the|a|an)\s+/i, '').trim();
  return { description, role, locator: null, resolved: false };
}

function urlFrom(text) {
  const m = text.match(/(https?:\/\/[^\s"'”)]+|(?:^|\s)(\/[^\s"'”)]*))/);
  if (!m) return null;
  return (m[2] ?? m[1]).trim().replace(/[.,]$/, '');
}

function parseBody(text) {
  const start = text.indexOf('{');
  const startArr = text.indexOf('[');
  const i = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (i === -1) return null;
  const candidate = text.slice(i).replace(/[.;]+$/, '');
  try {
    return JSON.stringify(JSON.parse(candidate));
  } catch {
    return null;
  }
}

/** One step's action text -> actions. */
export function parseAction(raw, { kind = 'web' } = {}) {
  const text = clean(raw);
  if (!text) return [];
  let m;

  // A check written as a step: "Verify the error message is shown"
  if (VERIFY.test(text)) return parseExpectation(text, { kind });

  // API: "Send a POST request to /api/users with body {...}", "GET /api/users/1"
  if ((m = text.match(new RegExp(`\\b(${METHODS})\\b\\s+(?:request\\s+)?(?:to\\s+|on\\s+|at\\s+)?(?:the\\s+)?(?:endpoint\\s+)?(\\S+)`, 'i')))) {
    const headers = [...text.matchAll(/header\s+["']?([\w-]+)["']?\s*[:=]\s*["']?([^"',]+)["']?/gi)].map((h) => ({ name: h[1], value: h[2].trim() }));
    return [{ type: 'request', method: m[1].toUpperCase(), path: m[2].replace(/[.,]$/, ''), headers, body: parseBody(text) }];
  }

  // Navigation
  if ((m = text.match(/^(?:navigate|go|open|launch|visit|browse|load|access)\b(.*)$/i))) {
    const url = urlFrom(m[1]);
    if (url) return [{ type: 'goto', url }];
    if (kind === 'mobile' && /\b(app|application)\b/i.test(m[1])) return [{ type: 'goto', url: null, launch: true }];
    const where = m[1].replace(/^\s*(?:to\s+)?(?:the\s+)?/i, '').trim();
    return [{ type: 'goto', url: '/', note: where ? `URL for "${where}" was not given; set it` : null, guessed: true }];
  }

  // Keys
  if ((m = text.match(/^(?:press|hit)\s+(?:the\s+)?(enter|return|tab|escape|esc|space|backspace|arrow down|arrow up)\b(?:\s+key)?(?:\s+(?:in|on)\s+(.+))?$/i))) {
    return [{ type: 'press', key: KEYS[m[1].toLowerCase()], target: m[2] ? target(m[2]) : null }];
  }

  // Waits
  if ((m = text.match(/^wait\s+(?:for\s+)?(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|secs?|seconds?)\b/i))) {
    return [{ type: 'wait', ms: Math.round(Number(m[1]) * (/^ms|milli/i.test(m[2]) ? 1 : 1000)) }];
  }

  // Select from a dropdown: Select "India" from the Country dropdown
  if ((m = text.match(/^(?:select|choose|pick)\s+(.+?)\s+(?:from|in)\s+(.+)$/i))) {
    return [{ type: 'select', value: unquote(m[1]), target: target(m[2], 'combobox') }];
  }

  // Checkboxes
  if ((m = text.match(/^(?:check|tick|enable|select)\s+(?:the\s+)?(.+?)\s+(?:checkbox|check box|toggle|switch)$/i)) || (m = text.match(/^(?:check|tick)\s+(.+)$/i))) {
    return [{ type: 'check', target: target(m[1], 'checkbox') }];
  }
  if ((m = text.match(/^(?:uncheck|untick|disable|deselect|clear)\s+(?:the\s+)?(.+?)(?:\s+(?:checkbox|check box|toggle|switch))?$/i))) {
    return [{ type: 'uncheck', target: target(m[1], 'checkbox') }];
  }

  // Typing: Enter "ana@x.com" in the Email field / Fill the Email field with "x" / Enter Email: x
  if ((m = text.match(/^(?:enter|type|input|fill(?:\s+in)?|provide|key\s+in|set|write)\s+(.+?)\s+(?:in|into|inside|on|for|as\s+the)\s+(?:the\s+)?(.+)$/i)) && !/\bwith\b/i.test(m[2])) {
    return [{ type: 'fill', value: unquote(m[1]).replace(/^(?:value|text)\s+/i, ''), target: target(m[2], 'textbox') }];
  }
  if ((m = text.match(/^(?:enter|type|input|fill(?:\s+in)?|set|update|change)\s+(?:the\s+)?(.+?)\s+(?:with|to|as)\s+(.+)$/i))) {
    return [{ type: 'fill', value: unquote(m[2]), target: target(m[1], 'textbox') }];
  }
  if ((m = text.match(/^(?:enter|type|input|fill(?:\s+in)?)\s+(?:the\s+)?([^:]+?)\s*:\s*(.+)$/i))) {
    return [{ type: 'fill', value: unquote(m[2]), target: target(m[1], 'textbox') }];
  }
  if ((m = text.match(/^(?:clear)\s+(?:the\s+)?(.+)$/i))) {
    return [{ type: 'fill', value: '', target: target(m[1], 'textbox') }];
  }

  // Hover
  if ((m = text.match(/^(?:hover|mouse\s*over|move the mouse)\s+(?:on|over|to)?\s*(.+)$/i))) {
    return [{ type: 'hover', target: target(m[1]) }];
  }

  // Click / tap (last: "select" and "press" have more specific forms above)
  if ((m = text.match(/^(?:click|tap|press|hit|select|choose|double[- ]click)\s+(?:on\s+)?(.+)$/i))) {
    // "Click Save and Continue" is one control; "Click Add, then Save" is two
    const parts = m[1].split(/\s*,?\s+(?:and\s+)?then\s+(?:click\s+)?/i);
    return parts.map((p) => ({ type: 'click', target: target(p, null) }));
  }

  return [{ type: 'manual' }];
}

function statusFrom(text) {
  let m = text.match(/\bstatus(?:\s+code)?\s*(?:should\s+be|must\s+be|is|=|==|of|:|equals?)?\s*(\d{3})\b/i) || text.match(/\b(\d{3})\s+(?:status|response|ok|created|no content|bad request|unauthori[sz]ed|forbidden|not found)\b/i)
    || text.match(/\breturns?\s+(?:a\s+)?(\d{3})\b/i);
  if (m) return Number(m[1]);
  m = text.match(new RegExp(`\\b(${Object.keys(STATUS_WORDS).join('|')})\\b\\s*(?:status|response)`, 'i'));
  return m ? STATUS_WORDS[m[1].toLowerCase()] : null;
}

/** One expected result -> assertions. */
export function parseExpectation(raw, { kind = 'web' } = {}) {
  const sentences = String(raw || '').split(/\r?\n|;\s+|\.\s+(?=[A-Z])/).map(clean).filter(Boolean);
  return sentences.flatMap((sentence) => {
    const verify = VERIFY.test(sentence);
    const text = sentence.replace(VERIFY, '');
    let m;
    const status = statusFrom(text);
    if (kind === 'api' || /\bresponse\b|\bstatus code\b|\bjson\b/i.test(text)) {
      const out = [];
      if (status) out.push({ type: 'expectStatus', code: status });
      // response contains field "token" / body.id equals 5 / response has "name" equal to "Ana"
      for (const b of text.matchAll(/(?:contains?|includes?|has|returns?|with)\s+(?:a\s+|an\s+|the\s+)?(?:non-empty\s+)?(?:field|property|key|attribute)?\s*["'`]?([A-Za-z_][\w.[\]]*)["'`]?(?:\s+(?:equal\s+to|equals?|=|==|with\s+value|as|of)\s+(["'`][^"'`]*["'`]|[\w.\-@]+))?/gi)) {
        if (/^(status|code|response|body|json|a|an|the|value|data)$/i.test(b[1]) || /^\d+$/.test(b[1])) continue;
        out.push(b[2] !== undefined ? { type: 'expectBody', path: b[1], equals: unquote(b[2]) } : { type: 'expectBody', path: b[1], exists: true });
      }
      for (const b of text.matchAll(/\b([A-Za-z_][\w.[\]]*)\s+(?:should\s+be|is|equals?|==)\s+(["'`][^"'`]*["'`]|-?\d+(?:\.\d+)?|true|false|null)(?=[\s.,;]|$)/gi)) {
        if (/^(status|code|response|it|this)$/i.test(b[1]) || out.some((o) => o.path === b[1])) continue;
        out.push({ type: 'expectBody', path: b[1], equals: unquote(b[2]) });
      }
      if (out.length) return out;
    }
    if ((m = text.match(/(?:redirected|navigated|taken|lands?|landed|moved)\s+(?:to|on)\s+(?:the\s+)?(.+?)(?:\s+(?:page|screen|url))?$/i))
      || (m = text.match(/\burl\s+(?:should\s+)?(?:contains?|includes?|be|is|ends with|=)\s+(.+)$/i))) {
      const value = urlFrom(m[1]) || unquote(m[1]).replace(/\s+/g, '-').toLowerCase();
      return [{ type: 'expectUrl', value }];
    }
    if ((m = text.match(/\b(?:page\s+)?title\s+(?:should\s+)?(?:be|is|contains?)\s+(.+)$/i))) return [{ type: 'expectTitle', value: unquote(m[1]) }];
    if ((m = text.match(/^(.+?)\s+(?:field|box|input)?\s*(?:should\s+)?(?:contains?|shows?|has\s+(?:the\s+)?value|displays?\s+the\s+value)\s+["“'](.+?)["”']$/i))) {
      return [{ type: 'expectValue', target: target(m[1], 'textbox'), value: m[2] }];
    }
    // A quoted message: Error "Invalid password" is displayed / user sees "Welcome"
    if ((m = text.match(QUOTED)) && /\b(display|shown|show|see|visible|appear|message|text|read|says?|toast|alert|error|banner|label|heading|title)/i.test(text)) {
      if (/\b(not|no longer|disappear|hidden)\b/i.test(text)) return [{ type: 'expectHidden', target: { description: m[1], role: null, locator: null, resolved: false, byText: true } }];
      return [{ type: 'expectText', text: m[1], target: null }];
    }
    if ((m = text.match(/^(?:the\s+)?(.+?)\s+(?:should\s+(?:be|remain|stay)|is|must\s+be|remains|stays)\s+(disabled|greyed out|grayed out|inactive|not clickable|enabled|active|clickable)$/i))) {
      return [{ type: /^(enabled|active|clickable)$/i.test(m[2]) ? 'expectEnabled' : 'expectDisabled', target: target(m[1]) }];
    }
    if ((m = text.match(/^(?:the\s+)?(.+?)\s+(?:should\s+not\s+be|is\s+not|isn't|must\s+not\s+be)\s+(?:displayed|visible|shown|present)|^(?:the\s+)?(.+?)\s+(?:disappears|is\s+hidden|should\s+be\s+hidden|closes)$/i))) {
      return [{ type: 'expectHidden', target: target(m[1] ?? m[2]) }];
    }
    if ((m = text.match(/^(?:the\s+)?(?:user\s+(?:should\s+)?(?:see|sees)\s+(?:the\s+)?)?(.+?)\s+(?:should\s+be|is|are|must\s+be|gets?)\s+(?:displayed|visible|shown|present|opened|open)\b/i))
      || (m = text.match(/^(?:the\s+)?user\s+(?:should\s+)?(?:see|sees|can\s+see)\s+(?:the\s+)?(.+)$/i))
      || (m = text.match(/^(?:the\s+)?(.+?)\s+(?:appears?|opens?|loads?)$/i))) {
      // "The Sign in page is displayed": a page shows itself by its heading.
      if (/\b(page|screen)$/i.test(m[1].trim())) {
        const name = m[1].trim().replace(/^(?:the|a|an)\s+/i, '').replace(/\s+(page|screen)$/i, '');
        return [{ type: 'expectVisible', target: { description: name, role: 'heading', locator: null, resolved: false }, guessed: true }];
      }
      return [{ type: 'expectVisible', target: target(m[1]) }];
    }
    if (status && kind !== 'api') return [{ type: 'expectStatus', code: status }];
    // "Verify the logo" with nothing else: the thing named should be there.
    if (verify && text.split(/\s+/).length <= 6) return [{ type: 'expectVisible', target: target(text) }];
    return [{ type: 'manual' }];
  });
}

const VERIFY = /^(?:verify|validate|ensure|confirm|assert|observe|check\s+that|check\s+if|make\s+sure)\s+(?:that\s+)?/i;

/** ManualTest -> Plan */
export function planWithRules(test, { kind = 'web' } = {}) {
  const actions = [];
  const push = (list, source) => list.forEach((a) => actions.push({ ...a, source }));
  test.preconditions.forEach((text, i) => {
    const url = urlFrom(text);
    if (url && /\b(open|on|navigate|logged|at|visit)\b/i.test(text)) push([{ type: 'goto', url }], { step: 0, kind: 'precondition', text, index: i });
    else if (kind === 'api' && new RegExp(`\\b(${METHODS})\\b`).test(text)) push(parseAction(text, { kind }), { step: 0, kind: 'precondition', text, index: i });
    else push([{ type: 'manual', precondition: true }], { step: 0, kind: 'precondition', text, index: i });
  });
  test.steps.forEach((s, i) => {
    if (s.action) push(parseAction(s.action, { kind }), { step: i + 1, kind: 'step', text: s.action });
    if (s.expected) push(parseExpectation(s.expected, { kind }), { step: i + 1, kind: 'expected', text: s.expected });
  });
  return { test, actions };
}
