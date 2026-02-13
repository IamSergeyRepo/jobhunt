# WTTJ Job Tracker

Automatically captures job recommendations from Welcome to the Jungle into a Google Sheet, classifies them by location relevance, and provides semi-automated job application via Playwright.

## Architecture

```
Gmail (WTTJ alerts)
  -> n8n v3 workflow (GraphQL API)
     -> Get Recommendations (WTTJ GraphQL)
     -> Get Job Details (per job)
     -> Parse & Classify (DMV/remote = Relevant, else Skip)
     -> Filter Duplicates (dedup by URL)
     -> Append to Google Sheet

npm run apply
  -> Fetch pending Relevant jobs (via n8n Apply Helper webhook)
  -> Open Chrome (persistent profile)
  -> For each job:
     -> Navigate to Apply URL
     -> Detect ATS (Greenhouse / Lever)
     -> Auto-fill form (name, email, phone, resume, LinkedIn)
     -> Pause for review
     -> User: submit / filled / skip / quit
     -> Update Progress in sheet via webhook
```

## Google Sheet Columns

| Column | Description |
|--------|-------------|
| Date Received | When the job was captured |
| Company | Company name |
| Job Title | Position title |
| URL | WTTJ job page |
| Location | Formatted location(s) |
| Remote | Yes/No |
| Salary | Formatted salary range |
| Experience | Required years |
| Technologies | Tech stack |
| Function | Job function/subfunction |
| Company Size | Size category |
| Funding | Total funding amount |
| Status | `Relevant` / `Skip` / `Error` |
| Source | `graphql` |
| Job ID | WTTJ `externalId` (stable key) |
| Apply URL | Company ATS link (Greenhouse/Lever/etc.) |
| Progress | `new` / `opened` / `filled` / `submitted` / `skipped` |
| Applied | Date string (set when submitted) |

## Setup

### Prerequisites

- Docker & Docker Compose
- Node.js 18+
- Google Cloud project with OAuth2 credentials (Gmail API, Google Sheets API, Google Drive API enabled)

### 1. Start n8n

```bash
docker compose up -d
```

Open http://localhost:5678 and create an account.

### 2. Configure WTTJ Auth

Extract cookies from browser DevTools (Network tab, any request to `api.exp.welcometothejungle.com`):

```bash
# .env
WTTJ_COOKIE=<your cookie string>
WTTJ_CSRF_TOKEN=<your csrf token>
```

### 3. Import Workflows

**v3 Workflow** (`n8n/wttj-to-sheets-v3.json`):
1. Import in n8n UI or deploy via API
2. Configure Gmail OAuth2 credential on the Gmail Trigger node
3. Configure Google Sheets OAuth2 credential on Read Existing Jobs and Append nodes
4. Select your "WTJ Job Tracker" spreadsheet

**Apply Helper** (`n8n/apply-helper.json`):
1. Import or deploy via API
2. Configure Google Sheets OAuth2 credential on Read Sheet and Update Sheet nodes
3. Select the same "WTJ Job Tracker" spreadsheet
4. Activate the workflow (webhook must be live)

### 4. Configure Apply Navigator

```bash
# .env
APPLICANT_FIRST_NAME=Your Name
APPLICANT_LAST_NAME=Last Name
APPLICANT_EMAIL=you@example.com
APPLICANT_PHONE=+15551234567
APPLICANT_LINKEDIN=https://linkedin.com/in/yourprofile
APPLICANT_RESUME_PATH=./auth/resume.pdf
N8N_WEBHOOK_URL=http://localhost:5678/webhook
```

Place your resume PDF in the `auth/` directory.

### 5. Install Dependencies

```bash
npm install
npx playwright install chromium
```

## Usage

### Capture Jobs

The v3 workflow runs automatically when a WTTJ alert email arrives. It fetches full job details via the GraphQL API and classifies each job as Relevant (remote or DMV area) or Skip.

### Apply to Jobs

```bash
npm run apply
```

The Apply Navigator:
1. Fetches pending Relevant jobs (Progress = `new`, Apply URL present)
2. Opens Chrome with a persistent profile
3. For each job, navigates to the Apply URL and detects the ATS platform
4. Auto-fills standard fields on Greenhouse and Lever forms
5. Pauses for you to review and fill any custom questions

**Interactive commands:**
- **Enter** — mark as `filled` (form filled, not submitted)
- **submit** — mark as `submitted` with today's date
- **skip** — mark as `skipped`
- **quit** — exit the session

### Re-authenticate WTTJ Session

```bash
npm run reauth
```

Opens Chrome to refresh WTTJ session cookies when they expire.

## Supported ATS Platforms

| Platform | Auto-fill | Notes |
|----------|-----------|-------|
| Greenhouse (`boards.greenhouse.io`, `job-boards.greenhouse.io`) | Yes | Name, email, phone, country, resume, LinkedIn |
| Lever (`jobs.lever.co`) | Yes | Name, email, phone, resume, LinkedIn |
| Others (Ashby, Workday, etc.) | No | Opens the page for manual filling |

## n8n MCP Server

The `n8n-mcp/` directory contains an MCP server that wraps the n8n REST API for use with Claude Code. It provides tools to list, create, update, activate/deactivate workflows, and trigger webhooks.

```bash
# Started on-demand by Claude Code (uses Docker Compose profiles)
docker compose run --rm -T n8n-mcp
```

## Files

| File | Purpose |
|------|---------|
| `n8n/wttj-to-sheets-v3.json` | v3 workflow — GraphQL API, dedup, classification |
| `n8n/wttj-to-sheets-v2.json` | v2 workflow (deprecated) — email HTML parsing |
| `n8n/apply-helper.json` | Apply Helper webhook workflow |
| `scripts/apply-navigator.mjs` | Main apply orchestration script |
| `scripts/ats/greenhouse.mjs` | Greenhouse form auto-filler |
| `scripts/ats/lever.mjs` | Lever form auto-filler |
| `scripts/ats/utils.mjs` | Shared form-filling helpers |
| `scripts/wttj-reauth.mjs` | WTTJ session re-authentication |
| `docker-compose.yml` | n8n + MCP server |
| `package.json` | Node.js scripts and dependencies |

## Troubleshooting

- **"Failed to fetch pending jobs"** — Is n8n running? `docker compose up -d`. Is the Apply Helper workflow activated?
- **"Unknown ATS — fill manually"** — The job's ATS platform isn't supported yet. Fill the form manually.
- **"Could not auto-fill form"** — The ATS page structure may differ from expected. Fill manually.
- **"ProcessSingleton" error** — A previous Chrome session is still running. Kill it: `pkill -f "Google Chrome for Testing"`
- **Phone country code issues** — The script auto-selects US (+1) for phone numbers starting with `+1`.
- **Google API errors** — Ensure Gmail API, Google Sheets API, and Google Drive API are enabled.
- **WTTJ auth expired** — Run `npm run reauth` to refresh session cookies.
