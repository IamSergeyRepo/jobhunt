#!/usr/bin/env node

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(dirname(__filename));
const AUTH_DIR = join(PROJECT_ROOT, "auth");
const STATE_FILE = join(AUTH_DIR, "wttj-state.json");
const META_FILE = join(AUTH_DIR, "meta.json");
const ENV_FILE = join(PROJECT_ROOT, ".env");

const GRAPHQL_URL = "https://api.exp.welcometothejungle.com/graphql";
const SIGN_IN_URL = "https://app.welcometothejungle.com/sign_in";
const DASHBOARD_URL = "https://app.welcometothejungle.com/dashboard";
const CANARY_QUERY = `query { currentUser { id } }`;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 2000;
const N8N_HEALTH_TIMEOUT_MS = 30 * 1000;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[reauth] ${msg}`);
}

function extractAuth(state) {
  const wttjCookies = state.cookies.filter((c) =>
    c.domain.endsWith("welcometothejungle.com")
  );
  const cookieHeader = wttjCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const csrfCookie = wttjCookies.find((c) => c.name === "_csrf_token");
  const csrfToken = csrfCookie ? csrfCookie.value : null;
  return { cookieHeader, csrfToken };
}

async function canaryQuery(cookieHeader, csrfToken) {
  try {
    const headers = {
      "Content-Type": "application/json",
      Origin: "https://app.welcometothejungle.com",
      Cookie: cookieHeader,
    };
    if (csrfToken) {
      headers["x-csrf-token"] = csrfToken;
    }
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: CANARY_QUERY }),
    });

    if (res.status === 429) return "RATE_LIMITED";
    if (res.status >= 500) return "WTTJ_DOWN";
    if (res.status === 401 || res.status === 403) return "AUTH_EXPIRED";

    const json = await res.json();
    if (json.data?.currentUser?.id) return "VALID";
    return "AUTH_EXPIRED";
  } catch (err) {
    if (err.cause?.code === "ENOTFOUND" || err.cause?.code === "ETIMEDOUT") {
      return "WTTJ_DOWN";
    }
    return "WTTJ_DOWN";
  }
}

function ensureAuthDir() {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
}

function loadState() {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveState(state) {
  ensureAuthDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  chmodSync(STATE_FILE, 0o600);
}

function saveMeta(meta) {
  ensureAuthDir();
  writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
}

function loadMeta() {
  if (!existsSync(META_FILE)) return {};
  try {
    return JSON.parse(readFileSync(META_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function updateEnv(cookieHeader, csrfToken) {
  let content = readFileSync(ENV_FILE, "utf-8");

  if (content.match(/^WTTJ_COOKIE=.*/m)) {
    content = content.replace(/^WTTJ_COOKIE=.*/m, `WTTJ_COOKIE=${cookieHeader}`);
  } else {
    content += `\nWTTJ_COOKIE=${cookieHeader}\n`;
  }

  if (content.match(/^WTTJ_CSRF_TOKEN=.*/m)) {
    content = content.replace(/^WTTJ_CSRF_TOKEN=.*/m, `WTTJ_CSRF_TOKEN=${csrfToken}`);
  } else {
    content += `WTTJ_CSRF_TOKEN=${csrfToken}\n`;
  }

  writeFileSync(ENV_FILE, content);
  chmodSync(ENV_FILE, 0o600);
}

async function restartN8n() {
  log("Restarting n8n...");
  execSync("docker compose up -d n8n", { cwd: PROJECT_ROOT, stdio: "inherit" });

  log("Waiting for n8n to be healthy...");
  const deadline = Date.now() + N8N_HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://localhost:5678/healthz");
      if (res.ok) {
        log("n8n is up.");
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  log("Warning: n8n health check timed out after 30s. It may still be starting.");
}

// ─── Phase 1: Check existing state ────────────────────────────────────────────

async function phase1() {
  log("Phase 1: Checking existing auth state...");
  const state = loadState();
  if (!state) {
    log("No saved state found. Browser login required.");
    return "AUTH_EXPIRED";
  }

  const { cookieHeader, csrfToken } = extractAuth(state);
  if (!cookieHeader) {
    log("Saved state has no WTTJ cookies. Browser login required.");
    return "AUTH_EXPIRED";
  }

  log(`Checking canary query (cookie: ${cookieHeader.length} chars)...`);
  const status = await canaryQuery(cookieHeader, csrfToken);
  log(`Canary result: ${status}`);
  return status;
}

// ─── Phase 2: Interactive login ───────────────────────────────────────────────

async function phase2() {
  log("Phase 2: Opening browser for login...");
  log("Please log in within 5 minutes. The script will detect when you're done.");

  // Use system Chrome + persistent profile to avoid Google's "browser not secure" block
  const userDataDir = join(AUTH_DIR, "chrome-profile");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    channel: "chrome",
  });

  const page = context.pages()[0] || await context.newPage();
  await page.goto(SIGN_IN_URL, { waitUntil: "domcontentloaded" });

  // Wait for login: poll canary query using live browser cookies
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let authenticated = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    // Quick heuristic: skip polling if still on sign_in/sign_up
    const url = page.url();
    if (url.includes("/sign_in") || url.includes("/sign_up")) {
      continue;
    }

    // Authoritative check: canary query with current browser cookies
    const state = await context.storageState();
    const { cookieHeader, csrfToken } = extractAuth(state);
    if (!cookieHeader) continue;

    const status = await canaryQuery(cookieHeader, csrfToken);
    if (status === "VALID") {
      authenticated = true;
      log("Login detected! Saving state...");
      break;
    }
  }

  if (!authenticated) {
    await context.close();
    throw new Error("Login timed out after 5 minutes.");
  }

  // Navigate to dashboard to ensure all cookies are set
  try {
    await page.goto(DASHBOARD_URL, { waitUntil: "networkidle", timeout: 15000 });
  } catch {
    // networkidle timeout is not critical
  }

  const finalState = await context.storageState();
  saveState(finalState);
  log("Browser state saved.");

  await context.close();
  return finalState;
}

// ─── Phase 3: Update .env ─────────────────────────────────────────────────────

function phase3(state) {
  log("Phase 3: Updating .env...");
  const { cookieHeader, csrfToken } = extractAuth(state);

  if (!csrfToken) {
    log("Warning: No _csrf_token cookie found. WTTJ_CSRF_TOKEN will be empty.");
  }

  updateEnv(cookieHeader, csrfToken || "");
  log(`Updated .env (cookie: ${cookieHeader.length} chars, csrf: ${csrfToken ? csrfToken.length : 0} chars)`);
}

// ─── Phase 4: Restart n8n ─────────────────────────────────────────────────────

async function phase4() {
  log("Phase 4: Restarting n8n...");
  await restartN8n();
}

// ─── Phase 5: Final verification ──────────────────────────────────────────────

async function phase5() {
  log("Phase 5: Final verification...");
  const state = loadState();
  const { cookieHeader, csrfToken } = extractAuth(state);
  const status = await canaryQuery(cookieHeader, csrfToken);

  if (status === "VALID") {
    log("Verification passed. Auth is working end-to-end.");
    const meta = loadMeta();
    meta.last_validated_at = new Date().toISOString();
    saveMeta(meta);
  } else {
    log(`Warning: Final verification returned ${status}. You may need to re-run.`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  log("Starting WTTJ reauth...\n");

  // Phase 1: Check existing state
  const status = await phase1();

  if (status === "RATE_LIMITED") {
    log("WTTJ is rate-limiting requests. Try again in a few minutes.");
    process.exit(1);
  }
  if (status === "WTTJ_DOWN") {
    log("WTTJ appears to be down or unreachable. Try again later.");
    process.exit(1);
  }

  let state;
  if (status === "VALID") {
    log("Existing auth is still valid. Skipping browser login.");
    state = loadState();
  } else {
    // Phase 2: Interactive login
    state = await phase2();
    const meta = loadMeta();
    meta.last_reauth_at = new Date().toISOString();
    saveMeta(meta);
  }

  // Phase 3: Update .env
  phase3(state);

  // Phase 4: Restart n8n
  await phase4();

  // Phase 5: Verify
  await phase5();

  log("\nDone!");
}

main().catch((err) => {
  console.error(`[reauth] Fatal: ${err.message}`);
  process.exit(1);
});
