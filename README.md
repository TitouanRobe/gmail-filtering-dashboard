<div align="center">

<img src="https://upload.wikimedia.org/wikipedia/commons/7/7e/Gmail_icon_%282020%29.svg" alt="Gmail" width="104">

<h1>Gmail Filtering Dashboard</h1>

<p><strong>Find out who is really filling up your mailbox — then clean it out in a few clicks.</strong></p>

<p>
Sender ranking&nbsp; · &nbsp;mailbox stats&nbsp; · &nbsp;bulk deletion&nbsp; · &nbsp;one-click newsletter unsubscribe
</p>

<p>
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Polars-CD792C?style=for-the-badge&logo=polars&logoColor=white" alt="Polars">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 8">
  <img src="https://img.shields.io/badge/Cloudscape-232F3E?style=for-the-badge" alt="Cloudscape Design System">
</p>

<p>
  <img src="https://img.shields.io/badge/Gmail%20API-v1-EA4335?style=flat-square&logo=gmail&logoColor=white" alt="Gmail API v1">
  <img src="https://img.shields.io/badge/i18n-EN%20%7C%20FR-4C9A2A?style=flat-square&logo=googletranslate&logoColor=white" alt="English and French">
  <img src="https://img.shields.io/badge/theme-light%20%7C%20dark-6E56CF?style=flat-square" alt="Light and dark theme">
  <img src="https://img.shields.io/badge/runs-100%25%20locally-0A7EA4?style=flat-square" alt="Runs locally">
  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square" alt="PRs welcome">
</p>

<p>
  <a href="#what-it-does"><b>Features</b></a>&nbsp; · &nbsp;
  <a href="#quick-start"><b>Quick start</b></a>&nbsp; · &nbsp;
  <a href="#2-google-cloud-setup-gmail-api"><b>Google setup</b></a>&nbsp; · &nbsp;
  <a href="#44-start-the-backend-server"><b>API</b></a>&nbsp; · &nbsp;
  <a href="#internationalization-i18n"><b>i18n</b></a>&nbsp; · &nbsp;
  <a href="#project-structure"><b>Structure</b></a>&nbsp; · &nbsp;
  <a href="#contributing"><b>Contributing</b></a>
</p>

</div>

---

## What it does

Your mailbox has thousands of emails and a handful of senders are responsible for most of them.
This dashboard pulls the metadata of every message you received, ranks the senders, and gives you
the tools to act on the ranking.

| | |
|---|---|
| 📊 **See the damage** | Total emails received, unique senders, top sender, and a chart of the senders filling up your mailbox. Your own sent emails are excluded from every count. |
| 🔎 **Drill into a sender** | Open any sender to browse their emails, preview one safely (sandboxed iframe, remote images blocked so newsletters cannot track the open), and delete selectively. |
| 🧹 **Clean in bulk** | Select senders and move every one of their emails to the Gmail trash in one action — reversible from Gmail for 30 days. |
| 🚫 **Unsubscribe for real** | Detects the `List-Unsubscribe` header, tells you which senders support RFC 8058 one-click, and fires the requests for you. Optionally deletes their backlog in the same pass. |
| 🌍 **English & French** | Switchable from the top bar, with locale-aware numbers, dates and plurals. Backend messages are translated too. |
| 🌗 **Light & dark** | Built on the Cloudscape Design System, theme preference is remembered. |
| 🔒 **Stays on your machine** | Your emails never leave your laptop: the backend talks to the Gmail API directly and caches metadata in a local CSV. |

---

## Quick start

```bash
# 1. Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
python main.py                              # OAuth + first emails.csv
uvicorn backend.main:app --reload           # http://localhost:8000

# 2. Frontend (second terminal)
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Needs a `secrets.json` from Google Cloud at the root of the project — see
[Google Cloud setup](#2-google-cloud-setup-gmail-api) below.

---

## Requirements

| Tool | Recommended version |
|------|---------------------|
| **Python** | 3.11+ |
| **Node.js** | 18+ |
| **npm** | 9+ (bundled with Node.js) |
| **pip** | latest |

---

## 1. Clone the project

```bash
git clone <repo-url>
cd gmail-filtering-dashboard
```

---

## 2. Google Cloud setup (Gmail API)

The project uses the Gmail API to read and manage your emails. You need a Google Cloud project and
OAuth 2.0 credentials.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or reuse an existing one)
3. Enable the **Gmail API** under *APIs & Services > Library*
4. Configure the *OAuth consent screen*:
   - Type: **External**
   - Add your own email address as a test user
5. Create OAuth 2.0 credentials:
   - Go to *APIs & Services > Credentials*
   - Click **Create Credentials > OAuth client ID**
   - Application type: **Desktop app**
   - Download the JSON file
6. Rename the downloaded file to **`secrets.json`** and put it at the **root** of the project
7. Go to *Google Auth Platform > Public > Test Users* and add your email address

> **Never commit `secrets.json`** — it is already listed in `.gitignore`.

---

## 3. Configure the `.env` file

Create a `.env` file at the root of the project:

```bash
touch .env
```

```env
GMAIL_API=<your-google-api-key>
# Optional: skips one Gmail API call at startup and excludes your own emails
# from the ranking even when the profile cannot be read.
GMAIL_USER_EMAIL=<your-address@gmail.com>
```

> The API key comes from *Google Cloud Console > APIs & Services > Credentials > API Keys*.

---

## 4. Backend (FastAPI)

### 4.1 Create the Python virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate    # macOS / Linux
# .venv\Scripts\activate     # Windows
```

### 4.2 Install the dependencies

```bash
pip install -r backend/requirements.txt
```

### 4.3 Generate `emails.csv` (first run)

Before starting the dashboard, the metadata of your emails has to be fetched:

```bash
python main.py
```

> On the first run a browser window opens for the OAuth flow. Accept the requested permissions; a
> `token.json` file is created automatically and `emails.csv` is written at the root of the project.

To update the CSV later:

```bash
python refresh_csv.py
```

The dashboard also triggers this script itself through the **Sync** button in the top bar.

### 4.4 Start the backend server

```bash
uvicorn backend.main:app --reload
```

The server listens on **http://localhost:8000**.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/me` | Address of the connected Gmail account |
| `GET` | `/api/stats` | Global stats (total emails, unique senders, top sender) |
| `GET` | `/api/senders?limit=50` | Sender ranking |
| `GET` | `/api/senders/{email}/emails` | Emails of a given sender |
| `GET` | `/api/emails/{id}` | Full content of one email (headers + body) |
| `POST` | `/api/emails/trash` | Move the given emails to the trash |
| `POST` | `/api/senders/trash` | Move every email of the given senders to the trash |
| `GET` | `/api/reload` | Reload the CSV in memory |
| `POST` | `/api/sync/start` | Start a Gmail sync in the background |
| `GET` | `/api/sync/status` | Progress of the running sync |
| `GET` | `/api/unsubscribe/senders` | Sender ranking enriched with the unsubscribe status |
| `POST` | `/api/unsubscribe/scan` | Probe the `List-Unsubscribe` header of the given senders |
| `POST` | `/api/unsubscribe/run` | Run the unsubscribe for the given senders |

---

## 5. Frontend (React + Vite)

```bash
cd frontend
npm install
npm run dev
```

The dev server runs on **http://localhost:5173**. Point it at another API with a
`frontend/.env` file:

```env
VITE_API_BASE=http://localhost:8000/api
```

---

## 6. Run the whole project

Open **two terminals**:

**Terminal 1 — backend:**
```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173**.

---

## Internationalization (i18n)

The interface ships in **English (default)** and **French**. The language is picked from the
dropdown in the top navigation bar, stored in `localStorage`, and pre-selected from the browser
language on the first visit.

### Where the messages live

```
frontend/src/i18n/
├── locales/
│   ├── en.json           # Source of truth — every new key is added here first
│   └── fr.json           # French translation, same keys
├── I18nContext.jsx       # Provider, useI18n() hook, locale-aware formatters
└── backendMessages.js    # Translation of the messages produced by the API
```

`I18nContext` also feeds the Cloudscape `I18nProvider`, so the strings built into the components
(table sorting labels, pagination, popovers...) follow the same language.

### Using it in a component

```jsx
import { useI18n } from "../i18n/I18nContext";

const { t, formatNumber, formatDate, formatRelative, formatPercent } = useI18n();

t("senders.title");                             // "Senders"
t("common.emailCount", { count: 1250 });        // "1,250 emails" / "1 250 mails"
```

- `{placeholders}` in a catalog entry are replaced by the matching key of the params object.
- A catalog entry may be an object of plural forms (`{"one": ..., "other": ...}`); the right one is
  picked by `Intl.PluralRules` from `params.count`, because English and French do not agree on
  where the plural starts.
- A key missing from a catalog falls back to English, then to the key itself — a translation gap
  never renders as an empty label.
- Numbers, dates, relative dates and percentages go through `Intl`, so they follow the selected
  language too.

### Adding a language

1. Copy `frontend/src/i18n/locales/en.json` to `<code>.json` and translate the values.
2. Register it in `LANGUAGES` in `frontend/src/i18n/I18nContext.jsx`, with its `Intl` tag and the
   matching Cloudscape catalog (`@cloudscape-design/components/i18n/messages/all.<code>.json`).

The dropdown, the formatters and the fallbacks pick it up automatically.

### Messages coming from the backend

The API never sends UI text it decided on its own: it sends a stable **key** plus its parameters,
and an English **fallback**.

```jsonc
// GET /api/sync/status
{ "status": "running", "current": 120, "total": 900,
  "message_key": "extracting",                       // → syncStatus.extracting in the catalog
  "message_params": { "current": 120, "total": 900 },
  "message": "Extracting metadata… 120/900" }        // English fallback

// Error of any endpoint
{ "detail": { "code": "token_missing", "params": null,
              "message": "token.json not found. Run main.py first." } }
```

The frontend translates the key when the catalog knows it (`apiError.*`, `syncStatus.*`,
`unsubDetail.*`) and displays the English fallback otherwise — an unexpected exception or a newer
backend degrades into readable English, never into a raw key.

---

## Project structure

```
gmail-filtering-dashboard/
├── backend/
│   ├── main.py               # FastAPI API
│   └── requirements.txt      # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── components/       # Tables, chart, email preview, toasts
│   │   ├── context/          # Shared state (data, toasts)
│   │   ├── i18n/             # Message catalogs and language provider
│   │   ├── layouts/          # Top bar, side navigation
│   │   ├── pages/            # Dashboard, Senders, Unsubscribe
│   │   └── api.js            # API client
│   ├── public/               # Static assets
│   ├── package.json          # Node.js dependencies
│   └── vite.config.js        # Vite configuration
├── main.py                   # Init script (OAuth + CSV generation)
├── refresh_csv.py            # CSV update script (run by the Sync button)
├── .env                      # Environment variables (not committed)
├── secrets.json              # Google OAuth credentials (not committed)
├── token.json                # Gmail auth token (not committed)
├── emails.csv                # Email metadata cache (not committed)
├── sync_status.json          # Progress of the running sync (not committed)
├── unsubscribe_cache.json    # List-Unsubscribe probe results (not committed)
└── .gitignore
```

---

## Contributing

Everything written in the repository is **English**: code, identifiers, comments, docstrings, log
messages, commit messages and documentation. The only French in the project lives in
`frontend/src/i18n/locales/fr.json`.

When adding a user-facing string:

1. Add the key to `en.json`.
2. Add the same key to `fr.json`.
3. Use it through `t("your.key")` — never hardcode text in a component.
