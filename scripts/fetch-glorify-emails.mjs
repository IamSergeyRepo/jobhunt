#!/usr/bin/env node
// fetch-glorify-emails.mjs — Download Outlook emails via Microsoft Graph API
// Usage: npm run fetch-emails

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Load .env ──────────────────────────────────────────────────────────────
const envPath = resolve(PROJECT_ROOT, '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx);
    const val = trimmed.slice(idx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Config ─────────────────────────────────────────────────────────────────
const CLIENT_ID  = process.env.MICROSOFT_CLIENT_ID;
const TENANT_ID  = process.env.MICROSOFT_TENANT_ID;
const DATE_FROM  = '2021-12-03T00:00:00Z';
const DATE_TO    = '2022-08-01T23:59:59Z';
const EMAILS_DIR = resolve(PROJECT_ROOT, 'emails');
const SCOPE      = 'https://graph.microsoft.com/Mail.Read offline_access';

if (!CLIENT_ID || !TENANT_ID) {
  console.error('[fetch-emails] Missing MICROSOFT_CLIENT_ID or MICROSOFT_TENANT_ID in .env');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function log(...args) {
  console.log('[fetch-emails]', ...args);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeSubject(subject) {
  return (subject || 'no-subject')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatFilename(receivedDateTime, subject) {
  // "2022-01-15T09:30:00Z" → "2022-01-15_09-30"
  const dt = new Date(receivedDateTime);
  const date = dt.toISOString().slice(0, 10); // "2022-01-15"
  const time = dt.toISOString().slice(11, 16).replace(':', '-'); // "09-30"
  return `${date}_${time}_${sanitizeSubject(subject)}.eml`;
}

// ── Phase 1: Device Code Auth ───────────────────────────────────────────────
async function authenticate() {
  const base = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0`;

  log('Requesting device code...');
  const dcRes = await fetch(`${base}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE }),
  });

  if (!dcRes.ok) {
    const err = await dcRes.text();
    throw new Error(`Device code request failed: ${err}`);
  }

  const dc = await dcRes.json();
  log('');
  log(dc.message);
  log('');

  const pollInterval = (dc.interval || 5) * 1000;
  const expiresAt = Date.now() + (dc.expires_in || 900) * 1000;

  while (Date.now() < expiresAt) {
    await sleep(pollInterval);

    const tokenRes = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: dc.device_code,
      }),
    });

    const token = await tokenRes.json();

    if (tokenRes.ok) {
      log('Authenticated successfully.');
      return token.access_token;
    }

    if (token.error === 'authorization_pending') {
      process.stdout.write('.');
      continue;
    } else if (token.error === 'slow_down') {
      await sleep(5000);
      continue;
    } else if (token.error === 'expired_token') {
      throw new Error('Device code expired. Please run again.');
    } else if (token.error === 'authorization_declined') {
      throw new Error('Authorization was declined.');
    } else {
      throw new Error(`Token error: ${token.error} — ${token.error_description}`);
    }
  }

  throw new Error('Authentication timed out.');
}

// ── Phase 2: Fetch Message List ─────────────────────────────────────────────
async function fetchMessageList(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const filter = `receivedDateTime ge ${DATE_FROM} and receivedDateTime le ${DATE_TO}`;
  const select = 'id,subject,receivedDateTime';
  const top = 100;

  let url = `https://graph.microsoft.com/v1.0/me/messages`
    + `?$filter=${encodeURIComponent(filter)}`
    + `&$select=${select}`
    + `&$top=${top}`
    + `&$orderby=receivedDateTime asc`;

  const messages = [];
  let page = 1;

  while (url) {
    log(`Fetching page ${page} of messages...`);
    const res = await fetch(url, { headers });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch messages (page ${page}): ${err}`);
    }

    const data = await res.json();
    const batch = data.value || [];
    messages.push(...batch);
    log(`  → Got ${batch.length} messages (total so far: ${messages.length})`);

    url = data['@odata.nextLink'] || null;
    page++;
  }

  return messages;
}

// ── Phase 3: Download Raw MIME ──────────────────────────────────────────────
async function downloadMessages(accessToken, messages) {
  mkdirSync(EMAILS_DIR, { recursive: true });

  const total = messages.length;
  let saved = 0;
  let skipped = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const filename = formatFilename(msg.receivedDateTime, msg.subject);
    const filepath = resolve(EMAILS_DIR, filename);

    if (existsSync(filepath)) {
      log(`[${i + 1}/${total}] Skip (exists): ${filename}`);
      skipped++;
      continue;
    }

    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${msg.id}/$value`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!res.ok) {
      const err = await res.text();
      log(`[${i + 1}/${total}] ERROR downloading ${filename}: ${err}`);
      continue;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filepath, buffer);
    log(`[${i + 1}/${total}] Saved: ${filename}`);
    saved++;

    await sleep(50);
  }

  return { saved, skipped, total };
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  log(`Date range: ${DATE_FROM} → ${DATE_TO}`);
  log(`Output dir: ${EMAILS_DIR}`);

  const accessToken = await authenticate();
  console.log('');

  const messages = await fetchMessageList(accessToken);
  log(`Total messages to download: ${messages.length}`);
  console.log('');

  const { saved, skipped, total } = await downloadMessages(accessToken, messages);
  log(`Done. ${saved} saved, ${skipped} skipped, ${total} total.`);
}

main().catch(err => {
  console.error('[fetch-emails] Fatal error:', err.message);
  process.exit(1);
});
