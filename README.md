# WTTJ Job Tracker

Automatically captures job links from Welcome to the Jungle email alerts into a Google Sheet using n8n.

## Architecture

```
Gmail (WTTJ alerts)
  → n8n Gmail Trigger (polls every 5 min)
  → Get Full Email (fetches HTML body via Gmail API)
  → Parse WTTJ Email (extracts company, title, salary, location)
  → Resolve Tracking URL (follows SendGrid redirects to get clean WTTJ URL)
  → Extract Final URL (pulls app.welcometothejungle.com/jobs/... link)
  → Google Sheets (appends row)
```

## Google Sheet Setup

Create a Google Sheet named **"WTTJ Job Tracker"** with these headers in row 1:

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| Date Received | Company | Job Title | URL | Location | Salary | Status |

## Google Cloud Setup

Before configuring n8n, create a Google Cloud project with OAuth2 credentials:

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. "n8n-wttj")
3. Enable these APIs under **APIs & Services > Library**:
   - **Gmail API**
   - **Google Sheets API**
   - **Google Drive API**
4. Configure **OAuth consent screen** (APIs & Services > OAuth consent screen):
   - Choose **External**
   - Add your email as a **Test user**
5. Create **OAuth credentials** (APIs & Services > Credentials > Create Credentials > OAuth client ID):
   - Application type: **Web application**
   - Authorized redirect URI: `http://localhost:5678/rest/oauth2-credential/callback`
   - Copy the **Client ID** and **Client Secret**

## n8n Setup

### Start n8n (Docker)

```bash
docker run -d --name n8n \
  -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  -e N8N_SECURE_COOKIE=false \
  n8nio/n8n
```

Open http://localhost:5678 and create an account.

### Import the Workflow

1. In n8n UI, go to **Workflows** > **Import from File**
2. Select `n8n/wttj-to-sheets-v2.json`
3. The workflow has 6 nodes:
   - **Gmail Trigger - WTTJ Alerts** — polls for emails from `help@welcometothejungle.com`
   - **Get Full Email** — fetches the full email HTML body using the Gmail API
   - **Parse WTTJ Email** — extracts job data from the HTML structure
   - **Resolve Tracking URL** — follows SendGrid tracking redirects
   - **Extract Final URL** — extracts the clean `app.welcometothejungle.com/jobs/...` URL
   - **Append to WTTJ Job Tracker** — writes each job as a row in Google Sheets

### Configure Credentials

You need to set up two credential types using the Client ID and Client Secret from Google Cloud.

#### Gmail OAuth2

Used by both the **Gmail Trigger** and **Get Full Email** nodes:

1. Click the **Gmail Trigger** node
2. Under **Credential to connect with**, click **Create New** > **Gmail OAuth2**
3. Paste your **Client ID** and **Client Secret**
4. Click **Sign in with Google** > **Continue** past the "unverified app" warning > **Allow**
5. Click the **Get Full Email** node and select the same Gmail credential

#### Google Sheets OAuth2

1. Click the **Append to WTTJ Job Tracker** node
2. Under **Credential to connect with**, click **Create New** > **Google Sheets OAuth2**
3. Paste the same **Client ID** and **Client Secret**
4. Click **Sign in with Google** > **Continue** > **Allow**
5. Select your **"WTTJ Job Tracker"** spreadsheet and **Sheet1**

### Test the Workflow

1. Make sure you have a recent WTTJ alert email in your Gmail
2. Click **Test Workflow**
3. Check each node's output:
   - **Gmail Trigger** should find the email
   - **Get Full Email** should return the full HTML body
   - **Parse WTTJ Email** should output one item per job with Company, Job Title, Salary, Location
   - **Resolve Tracking URL** / **Extract Final URL** should resolve to `app.welcometothejungle.com` URLs
   - **Google Sheets** should append rows
4. Verify the data appears in your Google Sheet

### Activate

Toggle the workflow **Active** to run automatically. It polls Gmail every 5 minutes.

## How the Email Parser Works

WTTJ alert emails have this structure per job:

```html
<a href="sendgrid-tracking-url">
  <table class="es-content-body">
    <tbody class="greyHover">
      <img alt="CompanyName logo" ...>
      <strong>CompanyName</strong>
      <strong>Job Title</strong>
      <em>Salary: $X-YK<br>Location</em>
    </tbody>
  </table>
</a>
```

The parser:
1. Splits the HTML on `greyHover` to isolate each job card
2. Extracts company name from the logo `alt` attribute
3. Extracts job title from `<strong>` tags (skipping the company name)
4. Splits salary and location from the `<em>` tag using `<br>` as delimiter
5. Grabs the SendGrid tracking URL from the wrapping `<a>` tag
6. The HTTP Request node then follows the redirect to get the clean WTTJ URL

## Managing n8n

```bash
# Stop
docker stop n8n

# Start again
docker start n8n

# View logs
docker logs -f n8n

# Remove container (data persists in ~/.n8n)
docker rm -f n8n
```

## Troubleshooting

- **"No Gmail data found"** — No recent email from `help@welcometothejungle.com` in your inbox. Wait for a new alert or check the sender filter.
- **"NO HTML BODY"** — The Get Full Email node didn't return the body. Check that `simple` is set to `false` in that node.
- **"NO JOBS PARSED"** — The HTML structure may have changed. Run the workflow manually and inspect the Parse node input to see the raw HTML.
- **Google API errors** — Make sure Gmail API, Google Sheets API, and Google Drive API are all enabled in your Google Cloud project.
- **"unverified app" warning** — Expected. Click Continue. Your app is in Testing mode, which is fine for personal use.

## Files

| File | Purpose |
|------|---------|
| `n8n/wttj-to-sheets-v2.json` | n8n workflow (current version) |
| `n8n/wttj-to-sheets.json` | n8n workflow (v1, deprecated) |
| `README.md` | This file |
