#!/usr/bin/env node
/**
 * Reauth webhook server — runs on the host, called by n8n when WTTJ auth expires.
 * n8n (Docker) calls: POST http://host.docker.internal:3001/reauth
 * Protected by Bearer token matching REAUTH_SECRET in .env
 */

import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = dirname(dirname(__filename));

// Load .env manually (server runs on host before n8n starts)
function loadEnv() {
  const envFile = join(PROJECT_ROOT, ".env");
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim();
    }
  }
}
loadEnv();

const SECRET = process.env.REAUTH_SECRET;
const PORT = parseInt(process.env.REAUTH_PORT || "3001");

if (!SECRET) {
  console.error("[reauth-server] REAUTH_SECRET is not set in .env — refusing to start.");
  process.exit(1);
}

let reauthRunning = false;

function runReauth() {
  if (reauthRunning) {
    console.log("[reauth-server] Reauth already in progress, skipping.");
    return;
  }
  reauthRunning = true;
  console.log("[reauth-server] Starting reauth...");

  const child = spawn("node", [join(PROJECT_ROOT, "scripts/wttj-reauth.mjs")], {
    cwd: PROJECT_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  child.on("close", (code) => {
    reauthRunning = false;
    if (code === 0) {
      console.log("[reauth-server] Reauth completed successfully.");
    } else {
      console.error(`[reauth-server] Reauth exited with code ${code}.`);
    }
  });
}

const server = http.createServer((req, res) => {
  const auth = req.headers["authorization"];

  if (auth !== `Bearer ${SECRET}`) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ running: reauthRunning, pid: process.pid }));
    return;
  }

  if (req.method === "POST" && req.url === "/reauth") {
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "started", alreadyRunning: reauthRunning }));
    runReauth();
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[reauth-server] Listening on port ${PORT}`);
  console.log(`[reauth-server] n8n should call: POST http://host.docker.internal:${PORT}/reauth`);
  console.log(`[reauth-server] WTTJ_EMAIL: ${process.env.WTTJ_EMAIL ? "set" : "NOT SET — will require manual login"}`);
});
