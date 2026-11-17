// What a public deployment needs that a laptop does not: a password in front
// of the page, and no exploring of private addresses. The agent opens
// whatever URL it is given in a browser, so without the second check a
// hosted copy could be pointed at its own network or cloud metadata.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

function isPrivate(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Throws unless `url` is http(s) and resolves only to public addresses (or is in `allowed`). */
export async function assertPublicUrl(url, allowed = []) {
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('The app URL must start with http:// or https://.');
  if (allowed.some((a) => a && parsed.origin === new URL(a).origin)) return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (!addresses.length) throw new Error(`Could not resolve ${parsed.hostname}.`);
  if (addresses.some(isPrivate)) throw new Error(`${parsed.hostname} is a private address. This hosted agent only explores public URLs; run it on your own machine (npm run serve) for internal apps.`);
}

/** A checker for every URL a run touches, remembering each host's answer. */
export function createUrlGuard(allowed = []) {
  const hosts = new Map();
  return async (url) => {
    const { origin } = new URL(url);
    if (!hosts.has(origin)) hosts.set(origin, assertPublicUrl(url, allowed).then(() => null, (err) => err));
    const err = await hosts.get(origin);
    if (err) throw err;
  };
}

/** HTTP Basic auth against APP_PASSWORD (any user name). Returns true when the request may continue. */
export function checkPassword(req, res, password) {
  if (!password) return true;
  const header = req.headers.authorization || '';
  const given = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8').split(':').slice(1).join(':') : '';
  const a = Buffer.from(given);
  const b = Buffer.from(password);
  if (a.length === b.length && timingSafeEqual(a, b)) return true;
  res.writeHead(401, { 'www-authenticate': 'Basic realm="Automation Script Agent", charset="UTF-8"', 'content-type': 'text/plain' });
  res.end('Sign in with any user name and the APP_PASSWORD.');
  return false;
}

export { isPrivate };
