/* eslint-disable no-console */

/**
 * scripts/ping-indexnow.cjs
 * Submit URLs from a sitemap.xml to IndexNow after each deploy/build.
 *
 * - Discovers IndexNow key from either:
 *   - env INDEXNOW_KEY (+ optional INDEXNOW_KEY_PATH)
 *   - a local key file at repo root or /public:
 *       - <32-hex>.txt
 *       - indexnow-<32-hex>.txt
 *
 * - Reads sitemap from first match:
 *   - out/sitemap.xml                      (Next.js export)
 *   - .next/server/app/sitemap.xml.body    (Next.js metadata route build output)
 *   - sitemap.xml                          (static site)
 *
 * Env knobs:
 *   - INDEXNOW_SKIP=1        -> skip
 *   - INDEXNOW_DRY_RUN=1     -> print payload only
 *   - INDEXNOW_ENDPOINT      -> default: https://api.indexnow.org/indexnow
 *   - INDEXNOW_MAX_URLS      -> default: 10000
 *   - INDEXNOW_HOST          -> default: repo folder name (e.g. example.com)
 *   - INDEXNOW_BASE_URL      -> default: https://<host>
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_HOST = path.basename(PROJECT_ROOT);

const HOST = String(process.env.INDEXNOW_HOST || DEFAULT_HOST).trim();
const BASE_URL = String(process.env.INDEXNOW_BASE_URL || `https://${HOST}`)
  .trim()
  .replace(/\/$/, '');

const ENDPOINT = String(process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow').trim();
const MAX_URLS = Number.parseInt(String(process.env.INDEXNOW_MAX_URLS || '10000'), 10);
const SKIP = process.env.INDEXNOW_SKIP;
const DRY_RUN = process.env.INDEXNOW_DRY_RUN;

const KEY_FILE_RE = /^(?:indexnow-)?([0-9a-f]{32})\.txt$/i;

async function fileExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function discoverKeyInfo() {
  const envKey = String(process.env.INDEXNOW_KEY || '').trim();
  if (envKey) {
    const fileName = String(process.env.INDEXNOW_KEY_PATH || `${envKey}.txt`).replace(/^\/+/, '');
    return { key: envKey, fileName };
  }

  const searchDirs = [PROJECT_ROOT, path.join(PROJECT_ROOT, 'public')];
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    let entries = [];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      entries = [];
    }
    for (const name of entries) {
      const match = KEY_FILE_RE.exec(name);
      if (!match) continue;
      return { key: match[1].toLowerCase(), fileName: name };
    }
  }

  return null;
}

function extractUrlsFromSitemap(xml) {
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) urls.push(String(m[1] || '').trim());

  const seen = new Set();
  const unique = [];
  for (const url of urls) {
    if (!url || seen.has(url)) continue;
    seen.add(url);
    unique.push(url);
  }
  return unique;
}

async function readSitemap() {
  const candidates = [
    path.join(PROJECT_ROOT, 'out', 'sitemap.xml'),
    path.join(PROJECT_ROOT, '.next', 'server', 'app', 'sitemap.xml.body'),
    path.join(PROJECT_ROOT, 'sitemap.xml'),
  ];

  for (const p of candidates) {
    if (!(await fileExists(p))) continue;
    const xml = await fsp.readFile(p, 'utf8');
    return { path: p, urls: extractUrlsFromSitemap(xml) };
  }

  return null;
}

function postJson(url, data) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(url);
    const body = Buffer.from(JSON.stringify(data), 'utf8');

    const req = https.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          'User-Agent': 'indexnow-ping/1.0',
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: raw.trim() }));
      },
    );

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  if (SKIP) {
    console.log('[IndexNow] Skipped (INDEXNOW_SKIP set).');
    return 0;
  }

  if (!HOST) {
    console.warn('[IndexNow] Missing host; skipping.');
    return 0;
  }

  const keyInfo = await discoverKeyInfo();
  if (!keyInfo?.key || !keyInfo.fileName) {
    console.warn('[IndexNow] Key file not found and INDEXNOW_KEY not set; skipping.');
    return 0;
  }

  const sitemap = await readSitemap();
  if (!sitemap?.urls?.length) {
    console.warn('[IndexNow] Sitemap not found or empty; skipping.');
    return 0;
  }

  let urlList = sitemap.urls;
  if (Number.isFinite(MAX_URLS) && MAX_URLS > 0 && urlList.length > MAX_URLS) {
    urlList = urlList.slice(0, MAX_URLS);
  }

  const keyLocation = `${BASE_URL}/${keyInfo.fileName.replace(/^\/+/, '')}`;
  const payload = {
    host: HOST,
    key: keyInfo.key,
    keyLocation,
    urlList,
  };

  if (DRY_RUN) {
    console.log('[IndexNow] Dry run payload:');
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(
    `[IndexNow] Posting ${urlList.length} URL(s) from ${path.relative(PROJECT_ROOT, sitemap.path)} to ${ENDPOINT}…`,
  );

  try {
    const res = await postJson(ENDPOINT, payload);
    if (res.status >= 200 && res.status < 300) {
      console.log(`[IndexNow] OK (HTTP ${res.status})`);
      if (res.body) console.log(`[IndexNow] Response: ${res.body.slice(0, 200)}`);
      return 0;
    }
    console.warn(`[IndexNow] Warning: HTTP ${res.status}${res.body ? ` — ${res.body.slice(0, 200)}` : ''}`);
  } catch (err) {
    console.warn('[IndexNow] Network error:', err && err.message ? err.message : String(err));
  }

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[IndexNow] Unexpected error:', err);
    process.exit(0);
  });

