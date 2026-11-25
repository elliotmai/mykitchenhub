/*
 * Fetch something from the public web for a signed-in cook (a recipe page,
 * its photo, an Openverse search) without becoming a way into private
 * networks: http(s) on the usual ports only, every address the name resolves
 * to checked at connect time (so a name cannot be re-pointed between the check
 * and the request), redirects followed by hand and checked again, a size cap
 * and a timeout.
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export const USER_AGENT = 'KitchenHub/1.0 (+recipe import)';

const v4 = (ip) => ip.split('.').map(Number);
/** Loopback, private, link-local, CGNAT, multicast, reserved and the like. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = v4(ip);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      s === '::' ||
      s === '::1' ||
      /^f[cd]/.test(s) ||
      /^fe[89ab]/.test(s) ||
      /^ff/.test(s) ||
      s.startsWith('64:ff9b:') ||
      s.startsWith('2001:db8')
    );
  }
  return true;
}

const safeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses)
      ? addresses
      : [{ address: addresses, family: options.family }];
    const bad = list.find((a) => isPrivateAddress(a.address));
    if (bad || !list.length) {
      return callback(
        Object.assign(new Error('That address is not on the public web.'), { code: 'EPRIVATE' })
      );
    }
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

export class PublicFetchError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}

/** A URL we are willing to fetch, or null. */
export function publicUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && !['80', '443'].includes(url.port)) return null;
  if (
    net.isIP(url.hostname.replace(/^\[|\]$/g, '')) &&
    isPrivateAddress(url.hostname.replace(/^\[|\]$/g, ''))
  )
    return null;
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname)) return null;
  return url;
}

function once(url, { accept, maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { 'user-agent': USER_AGENT, accept, 'accept-encoding': 'identity' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, url) });
        }
        if (status >= 400) {
          res.resume();
          return reject(
            new PublicFetchError(
              status === 404
                ? 'That page could not be found.'
                : 'That page could not be loaded right now.',
              status
            )
          );
        }
        const declared = Number(res.headers['content-length'] || 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new PublicFetchError('That is too large to bring in.'));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new PublicFetchError('That is too large to bring in.'));
          } else chunks.push(c);
        });
        res.on('end', () =>
          resolve({
            body: Buffer.concat(chunks),
            type: String(res.headers['content-type'] || ''),
            url,
          })
        );
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new PublicFetchError('That took too long to load.')));
    req.on('error', (err) =>
      reject(
        err instanceof PublicFetchError
          ? err
          : new PublicFetchError(
              err.code === 'EPRIVATE' ? err.message : 'That page could not be loaded right now.'
            )
      )
    );
    req.end();
  });
}

/** GET a public URL: { body: Buffer, type, url } (the final URL after redirects). */
export async function publicFetch(
  value,
  { accept = '*/*', maxBytes = 3_000_000, timeoutMs = 10_000, redirects = 3 } = {}
) {
  let url = publicUrl(value);
  if (!url) throw new PublicFetchError('That link can’t be opened.');
  for (let hop = 0; hop <= redirects; hop += 1) {
    const out = await once(url, { accept, maxBytes, timeoutMs });
    if (!out.redirect) return out;
    url = publicUrl(out.redirect.href);
    if (!url) throw new PublicFetchError('That link can’t be opened.');
  }
  throw new PublicFetchError('That link redirects too many times.');
}
