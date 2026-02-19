#!/usr/bin/env node
// Apply Navigator — semi-automated job application via Playwright
// Usage: npm run apply

import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

// ── Load .env ──────────────────────────────────────────────────────────
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

// ── Validate config ────────────────────────────────────────────────────
const profile = {
  firstName: process.env.APPLICANT_FIRST_NAME,
  lastName: process.env.APPLICANT_LAST_NAME,
  email: process.env.APPLICANT_EMAIL,
  phone: process.env.APPLICANT_PHONE,
  linkedin: process.env.APPLICANT_LINKEDIN || '',
  resumePath: process.env.APPLICANT_RESUME_PATH
    ? resolve(PROJECT_ROOT, process.env.APPLICANT_RESUME_PATH)
    : '',
};

const WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook';

const missing = [];
if (!profile.firstName) missing.push('APPLICANT_FIRST_NAME');
if (!profile.lastName) missing.push('APPLICANT_LAST_NAME');
if (!profile.email) missing.push('APPLICANT_EMAIL');
if (!profile.phone) missing.push('APPLICANT_PHONE');
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  console.error('Add them to .env and try again.');
  process.exit(1);
}

if (profile.resumePath && !existsSync(profile.resumePath)) {
  console.log(`Warning: Resume file not found at ${profile.resumePath}`);
  console.log('Forms will be filled without a resume.\n');
}

// ── ATS fillers ────────────────────────────────────────────────────────
import { fillGreenhouse } from './ats/greenhouse.mjs';
import { fillLever } from './ats/lever.mjs';
import { fillUsajobs } from './ats/usajobs.mjs';

function detectATS(url) {
  if (/greenhouse\.io/i.test(url) || /boards\.greenhouse/i.test(url)) return 'greenhouse';
  if (/lever\.co/i.test(url) || /jobs\.lever/i.test(url)) return 'lever';
  if (/usajobs\.gov/i.test(url)) return 'usajobs';
  return null;
}

// ── Webhook helpers ────────────────────────────────────────────────────
async function webhookPost(payload) {
  const res = await fetch(`${WEBHOOK_URL}/apply-helper`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Webhook ${res.status}: ${text}`);
  if (!text) return { success: true };
  try { return JSON.parse(text); } catch { return { success: true }; }
}

async function getPendingJobs() {
  return webhookPost({ action: 'get-pending' });
}

async function updateProgress(jobId, progress, applied = '') {
  return webhookPost({ action: 'update-progress', jobId, progress, applied });
}

// ── Interactive prompt ─────────────────────────────────────────────────
function prompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('Apply Navigator\n');

  // Fetch pending jobs
  let data;
  try {
    data = await getPendingJobs();
  } catch (err) {
    console.error(`Failed to fetch pending jobs: ${err.message}`);
    console.error('Is n8n running? Try: docker compose up -d');
    process.exit(1);
  }

  const jobs = data.jobs || [];
  if (jobs.length === 0) {
    console.log('All caught up! No pending jobs to apply to.');
    process.exit(0);
  }

  console.log(`Found ${jobs.length} pending job(s):\n`);
  for (const job of jobs) {
    console.log(`  ${job.company} — ${job.jobTitle}`);
  }
  console.log();

  // Launch browser with persistent profile
  const userDataDir = resolve(PROJECT_ROOT, 'auth', 'chrome-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
    viewport: { width: 1280, height: 900 },
  });

  // Ensure screenshots directory exists
  const screenshotsDir = resolve(PROJECT_ROOT, 'screenshots');
  if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

  const summary = { submitted: 0, filled: 0, skipped: 0, errors: 0 };
  let quit = false;

  for (let i = 0; i < jobs.length && !quit; i++) {
    const job = jobs[i];
    const idx = `[${i + 1}/${jobs.length}]`;
    console.log(`\n${idx} ${job.company} — ${job.jobTitle}`);
    console.log(`    Apply URL: ${job.applyUrl}`);

    const page = await context.newPage();

    try {
      // Navigate to apply URL
      await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Detect ATS from the actual URL (handles redirects)
      const actualUrl = page.url();
      const ats = detectATS(actualUrl);

      let fillSuccess = false;

      if (ats === 'greenhouse') {
        console.log('    Detected: Greenhouse');
        fillSuccess = await fillGreenhouse(page, profile);
      } else if (ats === 'lever') {
        console.log('    Detected: Lever');
        fillSuccess = await fillLever(page, profile);
      } else if (ats === 'usajobs') {
        console.log('    Detected: USAJobs');
        fillSuccess = await fillUsajobs(page, context, profile);
      } else {
        console.log(`    Unknown ATS (${actualUrl}) — fill manually`);
      }

      if (fillSuccess) {
        console.log('    Form auto-filled successfully');
      } else if (ats) {
        console.log('    Could not auto-fill form — fill manually');
      }

      // Interactive prompt
      console.log('\n    Commands: [Enter]=submitted  filled=filled  skip=skip  quit=exit');
      const answer = await prompt('    > ');

      if (answer === 'quit' || answer === 'q') {
        quit = true;
        // Still update progress for this job as opened
        try {
          await updateProgress(job.jobId, 'opened');
        } catch { /* ignore */ }
      } else if (answer === 'skip') {
        try {
          await updateProgress(job.jobId, 'skipped');
          console.log('    -> Skipped');
          summary.skipped++;
        } catch (err) {
          console.error(`    -> Failed to update: ${err.message}`);
          summary.errors++;
        }
      } else if (answer === 'filled' || answer === 'f') {
        try {
          await updateProgress(job.jobId, 'filled');
          console.log('    -> Marked as filled');
          summary.filled++;
        } catch (err) {
          console.error(`    -> Failed to update: ${err.message}`);
          summary.errors++;
        }
      } else {
        // Default (Enter): mark as submitted
        const today = new Date().toISOString().split('T')[0];
        try {
          await updateProgress(job.jobId, 'submitted', today);
          console.log('    -> Marked as submitted');
          summary.submitted++;
        } catch (err) {
          console.error(`    -> Failed to update: ${err.message}`);
          summary.errors++;
        }
      }
    } catch (err) {
      console.error(`    Error: ${err.message}`);
      summary.errors++;

      // Screenshot on failure
      try {
        const screenshotPath = resolve(screenshotsDir, `${job.jobId || 'unknown'}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`    Screenshot saved: ${screenshotPath}`);
      } catch { /* ignore screenshot errors */ }
    } finally {
      await page.close().catch(() => {});
    }
  }

  // Print summary
  console.log('\n--- Session Summary ---');
  console.log(`  Submitted: ${summary.submitted}`);
  console.log(`  Filled:    ${summary.filled}`);
  console.log(`  Skipped:   ${summary.skipped}`);
  console.log(`  Errors:    ${summary.errors}`);

  await context.close();
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
