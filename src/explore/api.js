// Runs API plans against the live service: each request is sent, and each
// status and body check is marked verified or failed against the real
// response, so the report shows which expectations hold today.

/** "data.items[0].id" -> value in `obj`, or undefined. */
export function jsonPath(obj, path) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Does the body check hold? Values compare as text, so "5" equals 5. */
export function bodyHolds(action, value) {
  if (action.equals !== undefined) return value !== undefined && String(typeof value === 'object' ? JSON.stringify(value) : value) === String(action.equals);
  if (action.contains !== undefined) return value !== undefined && String(typeof value === 'object' ? JSON.stringify(value) : value).includes(action.contains);
  return value !== undefined && value !== null;
}

export async function exploreApi(plans, { baseUrl, urlGuard = null, onProgress = () => {} } = {}) {
  for (const plan of plans) {
    let response = null;
    let body;
    let stopped = null;
    for (const action of plan.actions) {
      onProgress({ test: plan.test, action });
      if (action.type === 'manual') {
        action.status = 'manual';
        continue;
      }
      if (stopped) {
        action.status = 'ok';
        action.note = `not run: ${stopped}`;
        continue;
      }
      if (action.type === 'request') {
        try {
          const headers = Object.fromEntries((action.headers || []).map((h) => [h.name, h.value]));
          if (action.body && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
          const target = new URL(action.path, baseUrl);
          if (urlGuard) await urlGuard(target.href);
          // Hosted, a redirect is reported rather than followed, so it cannot lead somewhere private.
          const res = await fetch(target, { method: action.method, headers, body: action.body ?? undefined, signal: AbortSignal.timeout(15000), redirect: urlGuard ? 'manual' : 'follow' });
          const text = await res.text();
          response = res;
          try {
            body = text ? JSON.parse(text) : undefined;
          } catch {
            body = undefined;
          }
          action.status = 'ok';
          action.note = `${res.status} ${res.statusText}`.trim();
        } catch (err) {
          action.status = 'failed';
          action.note = err.cause?.code || err.message;
          stopped = `request in step ${action.source?.step} failed`;
        }
      } else if (action.type === 'expectStatus') {
        if (!response) {
          action.status = 'failed';
          action.note = 'no request before this check';
        } else {
          action.status = response.status === action.code ? 'verified' : 'failed';
          if (action.status === 'failed') action.note = `got ${response.status}`;
        }
      } else if (action.type === 'expectBody') {
        const value = jsonPath(body, action.path);
        action.status = bodyHolds(action, value) ? 'verified' : 'failed';
        if (action.status === 'failed') action.note = value === undefined ? `"${action.path}" is not in the response` : `got ${JSON.stringify(value).slice(0, 80)}`;
      } else {
        action.status = 'ok';
      }
    }
  }
  return plans;
}
