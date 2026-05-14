# IEOR Email Advising System

An intelligent email management system built for the Columbia IEOR department. Academic advisors use it to respond to student inquiries quickly, consistently, and accurately — with AI handling the routine cases automatically.

**Developed for:** IEOR 3900 / IEOR 4524 — Columbia University
**Team:** Emre Baser, Lara Jones, Mayyada Shair, Yasemin Yuksel
**Year:** 2026

---

## Table of Contents

1. [Overview](#overview)
2. [How It Works](#how-it-works)
3. [AI Pipeline — Deep Dive](#ai-pipeline--deep-dive)
4. [Features](#features)
5. [Tech Stack](#tech-stack)
6. [Project Structure](#project-structure)
7. [Getting Started — Local Setup](#getting-started--local-setup)
8. [Semester Configuration](#semester-configuration)
9. [Database](#database)
10. [API Reference](#api-reference)
11. [Configuration Reference](#configuration-reference)
12. [Authentication](#authentication)
13. [Deployment](#deployment)
14. [Testing](#testing)
15. [Knowledge Base Guide](#knowledge-base-guide)
16. [Advisor Assignment](#advisor-assignment)
17. [Known Quirks & Gotchas](#known-quirks--gotchas)

---

## Overview

The system automates responses to routine IEOR student emails. When an email arrives it is scored against a knowledge base of approved response templates using semantic similarity. High-confidence matches are drafted (or auto-sent); ambiguous or low-confidence emails are routed to an advisor review queue with a pre-filled draft.

The advisor never sees a blank inbox — every email has a suggested reply ready to send or edit.

---

## How It Works

```
Email arrives (Gmail sync or manual entry)
         │
         ▼
Personal guardrail check ──── IS sensitive ───► status="personal" → advisor queue
         │
      NOT sensitive
         │
         ▼
Semantic matching (OpenAI text-embedding-3-small)
         │
         ├─ confidence < 55%  ──────────────────► status="review" → fallback draft
         │
         ├─ top 2 matches within 8%  ───────────► status="review" (ambiguous)
         │
         ├─ 55% ≤ confidence < auto_threshold ──► status="review" → best-match draft
         │
         └─ confidence ≥ auto_threshold (default 90%)
                  │
                  ├─ auto_send_enabled = True + Gmail connected
                  │        └─► send immediately → status="sent"
                  │
                  └─ auto_send_enabled = False
                           └─► status="auto" → Pending Send queue
```

**Email statuses:**

| Status | Meaning |
|--------|---------|
| `review` | Needs advisor review (low confidence, ambiguous, or missing template values) |
| `personal` | Flagged as sensitive — advisor must handle personally, never auto-sent |
| `auto` | High-confidence match, awaiting send (auto-send was off, or Gmail not connected) |
| `sent` | Reply has been sent (auto or manually by advisor) |
| `trash` | Soft-deleted; excluded from all views but kept in database |

---

## AI Pipeline — Deep Dive

### 1. Sensitive Content Guardrail

Before any scoring, the email body is scanned by `PersonalEmailDetector` using pre-compiled regex patterns. Any hit on the keyword or phrase lists flags the email as `personal` and suppresses all AI responses.

When flagged, the suggested reply is replaced with a canned message pointing students to Columbia CPS (212-854-2878) and Columbia Health (212-854-2284). This behavior is not configurable at runtime — it is a hard guardrail.

**File:** [Backend/email_advising/personal_guardrails.py](Backend/email_advising/personal_guardrails.py)

---

### 2. Email Chain Parsing

When a student replies to a thread, the entire quoted prior conversation is included in the raw email body. The system strips the quoted portion before scoring so that the advisor's previous reply doesn't contaminate the confidence score.

`parse_email_chain()` splits the body on:
- Lines starting with `>` (standard quoting)
- `"On <date>, <name> wrote:"` headers (Gmail / Apple Mail style)
- Outlook `"From: ... Sent: ... To: ..."` blocks
- `"--- Original Message ---"` dividers

The **latest message** is used for semantic scoring and metadata extraction. The **prior chain** is passed to the LLM as conversation history so it can avoid repeating information already provided.

**File:** [Backend/api.py](Backend/api.py) — `parse_email_chain()`

---

### 3. Semantic Confidence Scoring

**Model:** OpenAI `text-embedding-3-small` (via the OpenAI Embeddings API). Embeddings are L2-normalized so cosine similarity reduces to a dot product.

**At startup:** Every utterance across all knowledge base articles is encoded and the resulting matrix is cached in memory. This is the most expensive step and happens once per server start.

**At query time:**
1. The email body is split into segments on sentence boundaries (`.!?`) and paragraph breaks (`\n\n`). This isolates the actual question from the greeting and sign-off.
2. Each segment is encoded by the model.
3. For each KB article, `confidence = max cosine similarity across all (segment, utterance) pairs`.
4. Articles are ranked by confidence.

**Fallback:** If `OPENAI_API_KEY` is not set, the system falls back to TF-IDF + Jaccard similarity (no external API required). Confidence scores will be lower and matching less accurate, but the system remains functional.

**File:** [Backend/email_advising/embeddings.py](Backend/email_advising/embeddings.py), [Backend/email_advising/advisor.py](Backend/email_advising/advisor.py)

**Routing thresholds:**

| Confidence | Action |
|---|---|
| ≥ `auto_send_threshold` (default 90%) | `auto` — pending send or immediately sent |
| 55–90% | `review` — best-match draft surfaced |
| Top two articles within 8% | `review` — ambiguous, draft surfaced |
| < 55% | `review` — generic fallback response |

---

### 4. Metadata Extraction

`MetadataExtractor` scans the email body for structured facts and injects them as template variables:

- **Academic term** — e.g., `"Spring 2026"` → `{term}`
- **Student name** — from `"My name is Jane"` / `"This is John"` patterns → `{student_name}`
- **Registration deadline** — dates near words like `"register"`, `"enroll"` → `{registration_deadline}`
- **Withdrawal deadline** — dates near words like `"withdraw"`, `"drop"` → `{withdrawal_deadline}`

Extracted values override the defaults from `semester_config.json` only if a value is actually found. If not found, the semester config defaults apply.

**File:** [Backend/email_advising/metadata.py](Backend/email_advising/metadata.py)

---

### 5. LLM Response Generation

Once the best-match article is selected, **OpenAI GPT-4o** generates the outgoing reply. The model receives:

- The student's latest message (quoted chain stripped)
- Prior conversation history (for threading context)
- The matched knowledge base template as structured guidance
- Up to 3 supporting reference documents
- Extracted metadata (student name, term, deadlines)

The LLM is instructed via a system prompt (`IEOR_SYSTEM_PROMPT`) to be professional and concise, never make promises about exceptions or waivers, never speculate on policy, and to always close with the standard IEOR Advising Team sign-off. URLs are injected separately — the LLM is told explicitly not to generate markdown links or bracket references.

The response is requested as JSON `{"subject": "...", "body": "..."}` for reliable parsing.

**Fallback:** If `OPENAI_API_KEY` is not set or the API call fails, `TemplateEmailComposer` renders the KB template with placeholder substitution and appends the reference links.

**File:** [Backend/email_advising/llm.py](Backend/email_advising/llm.py), [Backend/email_advising/composers.py](Backend/email_advising/composers.py)

---

### 6. Reference Retrieval (RAG)

Supporting documents (advising resource pages, curriculum links, form URLs) are retrieved via `TfidfRetriever` using MMR (Maximal Marginal Relevance) to balance relevance and diversity.

**Index:** TF-IDF vectors built from `document.title + document.content + document.tags`.

**Scoring:** Cosine similarity between the tokenized query (plus article subject/categories) and each document vector.

**Filters:**
- `min_score = 0.20` — documents below this threshold are excluded
- `diversity = 0.7` — penalizes documents that are too similar to already-selected ones
- Maximum 3 references per response

Retrieved references are appended to the email body as a `Resources:` block with numbered links.

**File:** [Backend/email_advising/rag.py](Backend/email_advising/rag.py)

---

## Features

### Dashboard
- Real-time metrics: total emails, emails today, pending reviews, auto-approved count
- All counts sourced directly from the database — no stale caches
- "Emails today" is computed in US Eastern Time (not UTC)

### Email Management

The main working surface. Three sub-views:

- **Needs Review** — emails with `status="review"` or `status="personal"`. These require advisor attention before any reply goes out.
- **Pending Send** — emails with `status="auto"`. High-confidence; ready to send but auto-send is off (or Gmail not connected). Advisor can review and approve.
- **Sent** — read-only history of all sent emails.

Within each view:
- Filter by time period (Today, Yesterday, This Week, This Month, This Year)
- Search by student name, subject, or body text
- Bulk select + bulk actions
- Click any email to open the detail panel: original email, AI draft, confidence score, matched KB article, reference links
- Edit the AI draft inline before sending
- Save a draft locally (stored in `localStorage` — persists through page refresh)
- Waiting time badges (urgency indicators based on age)
- **Assign to advisor** — dropdown to assign an email to a specific advisor from the IEOR team
- **Forward to advisor** — sends the original email to the assigned advisor's Columbia address

### Gmail Integration
- OAuth 2.0 authentication (no passwords stored)
- Sync unread emails from inbox (up to 100 at a time)
- Duplicate detection: same subject + body combination is skipped on re-sync
- Send replies directly through Gmail API
- Outgoing emails are sent as multipart (plain text + HTML) for proper formatting in Gmail

### Analytics
- Confidence distribution chart across all emails
- Average response time metrics
- Pending wait time analysis
- Automation rate insights

### Settings
- **Gmail Connection** — connect / disconnect via OAuth
- **Auto-send toggle** — enable / disable automatic sending for high-confidence emails
- **Confidence threshold slider** (50–100%) — sets the `auto_send_threshold`; emails at or above this score become `status="auto"`
- **Advisor profile** — name, email, department (stored in `localStorage`)
- **Knowledge Base Management** — full CRUD for KB articles directly in the UI
- **Reference Corpus Management** — full CRUD for reference documents; paste a URL to auto-fetch and populate content

### Expo Tab
A presentation-mode view (Senior Design Expo tab) showing the system overview and team information. Not functional — display only.

### UI
- Light / dark mode toggle (preference persisted via `localStorage`)
- Fully responsive layout with collapsible sidebar

---

## Tech Stack

### Backend

| Component | Choice | Notes |
|-----------|--------|-------|
| Web framework | FastAPI | Python, async-capable |
| ORM | SQLAlchemy 2.x | |
| Database (local) | SQLite | `Backend/emails.db`, auto-created |
| Database (prod) | PostgreSQL via Neon | `DATABASE_URL` env var; `postgres://` is auto-rewritten to `postgresql://` |
| Embeddings | OpenAI `text-embedding-3-small` | via `openai` SDK, batched in groups of 100 |
| LLM | OpenAI GPT-4o | `temperature=0.1` for consistency |
| Gmail | Gmail API + OAuth 2.0 | `google-api-python-client` |
| HTML parsing | BeautifulSoup4 | for URL content fetching |
| SSRF protection | `ipaddress` + `socket` | blocks private IPs, loopback, cloud metadata |
| Python version | 3.9+ | required for `zoneinfo` |

### Frontend

| Component | Choice | Notes |
|-----------|--------|-------|
| Framework | Next.js 16 | App Router |
| Language | TypeScript 5 | |
| Styling | Tailwind CSS 4 | |
| Component library | shadcn/ui (Radix primitives) | |
| Charts | Recharts | analytics tab |
| Icons | Lucide React | |
| Theming | next-themes | light/dark |
| Analytics | @vercel/analytics | page-level |

---

## Project Structure

```
IEOR-Email-Advising-Final/
│
├── README.md
├── DEPLOYMENT.md              # Step-by-step cloud deployment guide (Render + Vercel + Neon)
├── render.yaml                # Render auto-deploy config
│
├── Backend/
│   ├── api.py                 # FastAPI app — ALL endpoints, DB models, Gmail OAuth, email routing
│   ├── requirements.txt       # Python dependencies
│   ├── .env.example           # Environment variable template
│   │
│   ├── data/
│   │   ├── knowledge_base.json       # Undergrad KB — response templates & utterances
│   │   ├── knowledge_base_grad.json  # Graduate KB (alternative; not loaded by default)
│   │   ├── reference_corpus.json     # Supporting reference documents for RAG
│   │   ├── semester_config.json      # Term dates & static links — UPDATE EACH SEMESTER
│   │   └── gmail_token.json          # OAuth token (auto-created; gitignored)
│   │
│   ├── email_advising/               # Core AI package
│   │   ├── __init__.py               # Public exports
│   │   ├── __main__.py               # CLI entry point
│   │   ├── advisor.py                # EmailAdvisor — matching engine, routing, fallback
│   │   ├── embeddings.py             # SentenceEmbedder (OpenAI text-embedding-3-small)
│   │   ├── composers.py              # TemplateEmailComposer, LLMGenerativeComposer, LLMEmailComposer
│   │   ├── rag.py                    # TfidfRetriever — RAG reference retrieval with MMR
│   │   ├── knowledge_base.py         # KB loader (JSON → KnowledgeBase)
│   │   ├── models.py                 # Dataclasses: KnowledgeArticle, AdvisorResponse, ConfidenceSettings, etc.
│   │   ├── metadata.py               # MetadataExtractor — term, name, deadline extraction
│   │   ├── personal_guardrails.py    # PersonalEmailDetector — sensitive content detection
│   │   ├── similarity.py             # TF-IDF vectorizer & cosine similarity
│   │   ├── text_processing.py        # Tokenization, stopwords, normalization
│   │   └── llm.py                    # create_openai_llm() — GPT-4o integration
│   │
│   └── tests/
│       └── test_advisor.py           # Backend unit tests
│
├── Frontend/
│   ├── next.config.mjs
│   ├── package.json
│   ├── tsconfig.json
│   │
│   ├── app/
│   │   ├── layout.tsx                # Root layout (ThemeProvider wrapper)
│   │   ├── page.tsx                  # Main app — tab routing (dashboard/emails/analytics/settings/expo)
│   │   ├── globals.css               # Global styles (CSS variables for light + dark)
│   │   ├── providers.tsx             # Theme context provider
│   │   ├── login/
│   │   │   └── page.tsx              # Password login page
│   │   └── api/auth/
│   │       ├── login/route.ts        # POST /api/auth/login — password verification
│   │       └── logout/route.ts       # POST /api/auth/logout — session clear
│   │
│   ├── components/
│   │   ├── sidebar-nav.tsx           # Left navigation bar
│   │   ├── header-top.tsx            # Top bar — dark mode toggle
│   │   ├── emails-tab.tsx            # Email management (parent — manages all sub-tables)
│   │   ├── manual-review-table.tsx   # Emails in "Needs Review" queue
│   │   ├── assigned-table.tsx        # Emails assigned to a specific advisor
│   │   ├── auto-sent-table.tsx       # Emails in "Pending Send" / "Sent" queue
│   │   ├── analytics-tab.tsx         # Analytics charts and metrics
│   │   ├── settings-tab.tsx          # Settings: Gmail, auto-send, KB, corpus
│   │   ├── expo-tab.tsx              # Senior Design Expo presentation view
│   │   ├── metrics-cards.tsx         # Dashboard stat cards
│   │   ├── confidence-badge.tsx      # Color-coded confidence % badge
│   │   ├── draft-badge.tsx           # "Draft saved" indicator
│   │   ├── auth-gate.tsx             # Wraps protected pages; redirects to /login if unauthenticated
│   │   ├── sample-emails.ts          # Sample email payloads for testing
│   │   └── ui/                       # shadcn/ui component library (Radix-based)
│   │
│   ├── hooks/
│   │   ├── use-count-up.ts           # Animated number counter
│   │   ├── use-mobile.ts             # Responsive breakpoint hook
│   │   └── use-toast.ts             # Toast notification hook
│   │
│   └── lib/
│       ├── constants.ts              # BACKEND_URL, ADVISORS list
│       └── utils.ts                  # Tailwind class utilities (cn)
│
└── docs/                             # In-depth technical documentation
    ├── DATABASE_SCHEMA.txt
    ├── EMAIL_LIFECYCLE.txt
    ├── FILE_INVENTORY.txt
    ├── GMAIL_OAUTH_SETUP_GUIDE.txt
    ├── HOW_CONFIDENCE_SCORING_WORKS.txt
    ├── HOW_KNOWLEDGE_BASE_IS_STRUCTURED.txt
    ├── HOW_METADATA_EXTRACTION_WORKS.txt
    ├── HOW_PERSONAL_EMAIL_DETECTION_WORKS.txt
    ├── HOW_RAG_REFERENCE_RETRIEVAL_WORKS.txt
    ├── HOW_SETTINGS_AFFECT_BEHAVIOR.txt
    ├── HOW_TO_RUN_LOCALLY.txt
    └── UI_TO_BACKEND_MAPPING.txt
```

> The `docs/` folder contains standalone explanations of each subsystem. Start there if you need to understand a specific component without reading the source.

---

## Getting Started — Local Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- An **OpenAI API key** (required for embeddings and LLM generation; without it the system falls back to TF-IDF keyword matching only)
- A Google Cloud project with the Gmail API enabled (required only for Gmail sync/send; not required for manual email entry)

### Backend Setup

**1. Navigate to the Backend directory:**
```bash
cd Backend
```

**2. Create and activate a virtual environment:**
```bash
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
```

**3. Install dependencies:**
```bash
pip install -r requirements.txt
```

**4. Create your `.env` file:**

Copy `.env.example` to `.env` and fill in values:
```bash
cp .env.example .env
```

Then edit `.env`:
```
OPENAI_API_KEY=sk-...your-key-here...
GOOGLE_OAUTH_CLIENT_FILE=data/google_client_secrets.json
FRONTEND_URL=http://localhost:3000
```

> **Note:** The `.env.example` mentions `ANTHROPIC_API_KEY` but the system actually uses `OPENAI_API_KEY`. The `.env.example` file was not updated after the LLM migration. Always use `OPENAI_API_KEY`.

**5. Update the semester configuration** — see [Semester Configuration](#semester-configuration).

**6. (Optional) Set up Gmail OAuth:**
- Go to [Google Cloud Console](https://console.cloud.google.com/)
- Create or select a project, enable the Gmail API
- Create OAuth 2.0 credentials (Desktop app type)
- Download the credentials and save as `Backend/data/google_client_secrets.json`

**7. Start the backend:**
```bash
uvicorn api:app --reload --port 8000
```

The backend will start at `http://localhost:8000`. The SQLite database (`emails.db`) is created automatically on first startup. On first request after startup, utterance embeddings are computed via the OpenAI Embeddings API — this takes a few seconds.

You can verify the backend is running at `http://localhost:8000/docs` (FastAPI auto-generated docs).

---

### Frontend Setup

**1. Navigate to the Frontend directory:**
```bash
cd Frontend
```

**2. Install dependencies:**
```bash
npm install
```

**3. Configure the backend URL:**

Create `.env.local` in the `Frontend/` directory:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

If you skip this, the frontend defaults to `http://127.0.0.1:8000`.

**4. Start the dev server:**
```bash
npm run dev
```

Open `http://localhost:3000`. You will be prompted to log in (see [Authentication](#authentication)).

---

## Semester Configuration

**File:** [Backend/data/semester_config.json](Backend/data/semester_config.json)

**This file must be updated at the start of every new semester.** It is the single source of truth for all date and URL placeholders used in response templates.

The file has two sections:

### `SEMESTER` — update every term

```json
{
  "SEMESTER": {
    "term": "Fall 2026",
    "registration_deadline": "September 17",
    "withdrawal_deadline": "November 19",
    "graduation_application_deadline": "January 1",
    "start_date": "TBD",
    "end_date": "TBD"
  }
}
```

These values are substituted into response templates like `{term}`, `{registration_deadline}`, and `{withdrawal_deadline}`. **If a value is left as `"TBD"`, that literal string will appear in outgoing student emails** — always fill in the actual dates before the term begins.

### `STATIC_LINKS` — update only when URLs change

```json
{
  "STATIC_LINKS": {
    "link_to_undergrad_advising": "https://ieor.columbia.edu/...",
    "link_to_undergrad_curriculum": "https://ieor.columbia.edu/...",
    "link_to_csa_declaration": "https://www.cc-seas.columbia.edu/...",
    "ieor_course_approval_request_form": "https://docs.google.com/...",
    ...
  }
}
```

These are injected as metadata when templates reference `{link_to_undergrad_advising}` etc. Check that all links are live before the semester starts.

**How the config is loaded:** `knowledge_base.py` reads `semester_config.json` at startup and merges `SEMESTER` and `STATIC_LINKS` into the `metadata_defaults` used by `EmailAdvisor`. Changes to the JSON file require a backend restart to take effect (the dev server restarts automatically with `--reload`).

---

## Database

### Engine

- **Local / dev:** SQLite at `Backend/emails.db` — created automatically, no setup required.
- **Production:** PostgreSQL (Neon). Set `DATABASE_URL` env var. The backend transparently handles the `postgres://` → `postgresql://` rewrite needed by SQLAlchemy 2.x.

Tables are created automatically at startup via `Base.metadata.create_all()`. Schema migrations (adding new columns, new enum values) run automatically via `_migrate_db()`.

### Tables

**`emails`** — one row per processed email

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `student_name` | VARCHAR | From Gmail "From" header or extracted |
| `uni` | VARCHAR | UNI extracted from `xxx@columbia.edu` or `@barnard.edu` |
| `email_address` | VARCHAR | Full sender address — required for auto-send |
| `subject` | VARCHAR | Email subject |
| `body` | TEXT | Plain-text body (quoted chain stripped) |
| `confidence` | FLOAT | Cosine similarity score 0.0–1.0 |
| `status` | ENUM | `review`, `personal`, `auto`, `sent`, `trash` |
| `suggested_reply` | TEXT | AI-generated draft (editable by advisor) |
| `references_json` | TEXT | JSON array of `{title, url}` reference links |
| `received_at` | DATETIME | UTC timestamp, indexed |
| `approved_at` | DATETIME | When reply was sent (NULL if not yet sent) |
| `assigned_to` | VARCHAR | Advisor name (NULL if unassigned) |

**`email_settings`** — always exactly one row

| Column | Default | Description |
|--------|---------|-------------|
| `auto_send_enabled` | `False` | Whether to send high-confidence replies automatically |
| `auto_send_threshold` | `0.9` | Confidence cutoff for auto-send (0.0–1.0) |
| `email_address` | `""` | Connected Gmail address (auto-synced from OAuth) |
| `last_synced_at` | `NULL` | Timestamp of last Gmail sync |

The IMAP/SMTP columns (`imap_server`, `smtp_server`, etc.) are legacy from a pre-OAuth implementation. They exist for schema compatibility but are not used.

### Inspecting the database

```bash
cd Backend
sqlite3 emails.db

# List all emails
SELECT id, student_name, subject, confidence, status, received_at
FROM emails ORDER BY received_at DESC LIMIT 20;

# Count by status
SELECT status, COUNT(*) FROM emails GROUP BY status;

# Settings
SELECT * FROM email_settings;
```

### Resetting the database

```bash
# Delete only emails (keeps settings)
sqlite3 emails.db "DELETE FROM emails;"

# Full reset
rm Backend/emails.db
# Tables are recreated on next server start
```

---

## API Reference

The backend exposes a REST API at `http://localhost:8000`. Interactive docs at `/docs`.

### Email endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/emails` | List all emails. Optional `?status=review\|auto\|sent\|personal` filter. Excludes `trash`. |
| `POST` | `/emails/ingest` | Ingest a new email manually. Runs full AI pipeline. |
| `POST` | `/emails/sync` | Pull unread Gmail messages (up to `?limit=20`). Requires Gmail connected. |
| `PATCH` | `/emails/{id}` | Update status, suggested_reply, or assigned_to. |
| `DELETE` | `/emails/{id}` | Hard-delete an email from the database. |
| `POST` | `/emails/{id}/send` | Send a reply via Gmail. Optional `reply_text` to override draft. |
| `POST` | `/emails/{id}/forward` | Forward the original email to the assigned advisor's address. |

**`POST /emails/ingest` payload:**
```json
{
  "student_name": "Jane Doe",
  "uni": "jd1234",
  "email_address": "jd1234@columbia.edu",
  "subject": "Registration deadline question",
  "body": "Hi, I wanted to ask about the add/drop deadline for Spring...",
  "received_at": "2026-01-15T10:30:00"  // optional, defaults to now
}
```

### Gmail endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/gmail/status` | Connected email address and last sync time. |
| `GET` | `/gmail/auth-url` | Returns Google OAuth authorization URL. |
| `GET` | `/gmail/oauth2callback` | OAuth redirect handler — Google calls this after authorization. |
| `GET` | `/gmail/fetch` | Alias for `POST /emails/sync`. |
| `POST` | `/gmail/disconnect` | Deletes stored OAuth token. |

### Knowledge base endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/knowledge-base` | List all KB articles. |
| `POST` | `/knowledge-base` | Create a new article. |
| `PATCH` | `/knowledge-base/{id}` | Update an existing article. |
| `DELETE` | `/knowledge-base/{id}` | Delete an article (minimum 1 must remain). |

### Reference corpus endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/reference-corpus` | List all reference documents. |
| `POST` | `/reference-corpus` | Add a reference document. |
| `PATCH` | `/reference-corpus/{id}` | Update a reference document. |
| `DELETE` | `/reference-corpus/{id}` | Delete a reference document. |
| `POST` | `/fetch-url-content` | Fetch and extract text from a URL (SSRF-protected). Used to auto-populate reference content. |

### Settings & metrics endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/email-settings` | Get current auto-send settings. |
| `POST` | `/email-settings` | Update auto-send settings. |
| `GET` | `/metrics` | Dashboard statistics (counts by status, avg confidence). |
| `GET` | `/respond` | Debug/playground: run a query through the advisor and return the response. `?query=...&student_name=...` |

---

## Configuration Reference

### Backend environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Recommended | None | OpenAI key for GPT-4o (LLM) and `text-embedding-3-small` (embeddings). Without this, falls back to TF-IDF keyword matching and template-only composition. |
| `DATABASE_URL` | No | `sqlite:///Backend/emails.db` | PostgreSQL connection string for production. `postgres://` URIs are auto-converted to `postgresql://`. |
| `GOOGLE_OAUTH_CLIENT_FILE` | No | `data/google_client_secrets.json` | Path to Google OAuth client secrets JSON. |
| `FRONTEND_URL` | No | `http://localhost:3000` | CORS origin and OAuth redirect target. |
| `BACKEND_PUBLIC_URL` | No | `http://128.59.149.172.nip.io:8000` | Public-facing backend URL used as the OAuth redirect URI. Set to your Render URL in production. |

### Frontend environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_BACKEND_URL` | No | `http://127.0.0.1:8000` | Backend API base URL. |
| `APP_PASSWORD` | Yes (for auth) | — | Password for the advisor login gate. Set in Vercel dashboard or `.env.local`. |

### Confidence thresholds

| Parameter | Default | Where it's set |
|-----------|---------|----------------|
| `auto_send_threshold` | 90% (0.9) | Settings slider in UI; stored in `email_settings` DB table |
| `review_threshold` | 55% (0.55) | Hardcoded in `models.py:ConfidenceSettings` |
| `ambiguity_gap` | 8% (0.08) | Hardcoded in `models.py:ConfidenceSettings` |

`review_threshold` and `ambiguity_gap` are not currently exposed in the UI and require a code change to adjust.

---

## Authentication

The frontend is password-protected. All pages redirect to `/login` if the user is not authenticated (`AuthGate` component wraps `page.tsx`).

**How it works:**
- `POST /api/auth/login` — Next.js API route that checks the submitted password against the `APP_PASSWORD` environment variable and sets a session cookie.
- `POST /api/auth/logout` — Clears the session cookie.
- `AuthGate` — checks for the session cookie client-side and redirects to `/login` if absent.

**Setting the password:**
- Locally: add `APP_PASSWORD=your-password` to `Frontend/.env.local`
- Production (Vercel): add `APP_PASSWORD` as an environment variable in the Vercel project settings

The backend API itself has no authentication — it's protected only by CORS (only the configured frontend origin is allowed) and the fact that the advisor must be on the frontend to interact with it. For higher security in production, consider adding API key authentication to the backend endpoints.

---

## Deployment

Full step-by-step instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).

**Quick summary:**

| Layer | Service | Cost |
|-------|---------|------|
| Frontend | Vercel | Free |
| Backend | Render (web service) | Free tier (spins down after 15 min idle) |
| Database | Neon (PostgreSQL) | Free |

**Key env vars to set:**

- Render: `OPENAI_API_KEY`, `DATABASE_URL` (Neon connection string), `FRONTEND_URL` (Vercel URL), `BACKEND_PUBLIC_URL` (your Render URL)
- Vercel: `NEXT_PUBLIC_BACKEND_URL` (your Render URL), `APP_PASSWORD`

**Important:** The OAuth redirect URI registered in Google Cloud Console must match `BACKEND_PUBLIC_URL + "/gmail/oauth2callback"`. If the Render URL changes, update it in both Google Cloud Console and the `BACKEND_PUBLIC_URL` env var.

**Render cold starts:** The free tier spins down after 15 minutes of inactivity. The first request after idle takes ~30 seconds. Subsequent requests are fast.

---

## Testing

### Running backend tests

```bash
cd Backend
pip install pytest
pytest tests/
```

Tests cover:
- Article ranking accuracy (correct KB article selected)
- Auto-send threshold routing
- Manual review routing (low confidence, ambiguous)
- Metadata extraction (term, name, deadline)
- Personal email detection

### Manual end-to-end testing

The frontend includes sample email payloads (`Frontend/components/sample-emails.ts`) that can be ingested via the **+ Add Sample** button in the UI. These cover:

- Registration deadline question (expected: high confidence, auto)
- Withdrawal / course drop (expected: high confidence)
- Mental health / personal distress (expected: flagged as personal)
- Ambiguous / multi-topic question (expected: review)

You can also call the debug endpoint directly:
```
GET http://localhost:8000/respond?query=When+is+the+add+drop+deadline
```

---

## Knowledge Base Guide

The KB lives in [Backend/data/knowledge_base.json](Backend/data/knowledge_base.json). Each article has:

```json
{
  "id": "registration_deadline",
  "subject": "Course Registration Deadline Guidance",
  "categories": ["registration", "deadlines"],
  "utterances": [
    "When is the deadline to register for classes?",
    "How late can I add a course?",
    "Last day to enroll?"
  ],
  "response_template": "Hello {student_name},\n\nThe registration period for {term} closes on {registration_deadline}...",
  "follow_up_questions": [
    "Do you have any registration holds on your account?"
  ],
  "metadata": {}
}
```

**Utterances** are the most important field. The semantic matching engine scores the incoming email against every utterance in every article. Adding more diverse, realistic utterances is the most effective way to improve confidence scores for a given topic.

**Template placeholders** use Python `.format_map()` syntax: `{student_name}`, `{term}`, `{registration_deadline}`, etc. Values come from (in priority order):
1. Metadata extracted from the student's email
2. Semester config (`semester_config.json`)
3. Hardcoded defaults in `EmailAdvisor.metadata_defaults`

If a placeholder has no value, it appears literally in the email body (e.g., `{registration_deadline}` shows up verbatim), which triggers a `review` routing decision.

**Adding a new article via the UI:**
1. Settings tab → Knowledge Base section → click **Add Article**
2. Fill in ID (unique, no spaces), subject, categories (comma-separated), utterances (one per line), response template, and optional follow-up questions
3. Save — the change is written to `knowledge_base.json` immediately and the embedding index is rebuilt

**Adding a new article directly in JSON:**
Edit `knowledge_base.json` and restart the backend (or save while `--reload` is active).

**Graduate knowledge base:**
`Backend/data/knowledge_base_grad.json` exists with graduate-specific articles but is not loaded by default. To switch, change the path in `knowledge_base.py`'s `load_knowledge_base()` call or update `api.py`.

---

## Advisor Assignment

The backend has a hardcoded list of IEOR advisors and their Columbia email addresses:

| Advisor | Email |
|---------|-------|
| Winsor | wy2396@columbia.edu |
| Kelly | kk3813@columbia.edu |
| Sabrina | sl5163@columbia.edu |
| Samantha | sas2538@columbia.edu |
| Christine | cc5201@columbia.edu |
| Jean | jf2827@columbia.edu |
| Monique | dh3347@columbia.edu |

**File:** [Backend/api.py](Backend/api.py) — `ADVISOR_EMAILS` dict and `FORWARD_FALLBACK`

When an advisor clicks **Assign** on an email in the UI, the `assigned_to` field is updated via `PATCH /emails/{id}`. When they click **Forward**, `POST /emails/{id}/forward` sends the original email body to the assigned advisor's address. If no advisor is assigned, the email goes to the fallback address (`rr3542@columbia.edu`).

To update the advisor list, edit `ADVISOR_EMAILS` in `api.py` and update the `ADVISORS` array in `Frontend/lib/constants.ts` to match.

---

## Known Quirks & Gotchas

**LLM vs. README mismatch in `.env.example`**
The `.env.example` says `ANTHROPIC_API_KEY` but the system uses `OPENAI_API_KEY`. This was not updated after migrating from Claude to GPT-4o. Always use `OPENAI_API_KEY`.

**Embeddings cost money**
Every backend restart recomputes embeddings for all utterances via the OpenAI Embeddings API. With a small KB (< 500 utterances) this is a fraction of a cent, but it is not free. Embeddings are cached in memory only — they are not persisted to disk between restarts.

**TF-IDF fallback is less accurate**
Without `OPENAI_API_KEY`, the system uses TF-IDF keyword matching. Paraphrases that share no exact words will score 0. This is fine for development but not for production.

**OAuth state is in-memory only**
OAuth flow state is stored in a Python dict (`oauth_flows`) with a 10-minute TTL. If the backend restarts during an OAuth flow, the user gets an "Invalid OAuth state" error and must retry. On Render free tier, a cold start during OAuth is unlikely but possible.

**Duplicate detection is naive**
`POST /emails/sync` deduplicates by matching `subject + body` exactly. If a student sends the same email twice (even with minor edits), the second copy is ingested. There is no Gmail message ID deduplication.

**Timezone handling**
`received_at` is stored as UTC. "Emails today" in the metrics endpoint uses US Eastern Time. If the server clock is wrong, counts may be off by a few hours.

**`emails.db` never shrinks**
Deleted emails are hard-deleted but the SQLite file does not reclaim space. If the database grows large, run `VACUUM` or delete and recreate it.

**`knowledge_base_grad.json` is not loaded by default**
The graduate KB file exists but is not wired up. To use it, change the `load_knowledge_base()` call in `api.py`.

**Render backend URL is hardcoded**
`BACKEND_PUBLIC_URL` defaults to a Columbia server IP (`128.59.149.172.nip.io:8000`). This was a locally deployed server during development. Set `BACKEND_PUBLIC_URL` to your Render URL in production, or the Gmail OAuth redirect will fail.

---

## Acknowledgments

Developed as part of **IEOR 3900 and IEOR 4524** at **Columbia University** for the **Industrial Engineering and Operations Research (IEOR) department**.

Special thanks to the IEOR advising team for their input on response templates, workflow requirements, and real-world email examples.

---

## License

Provided as-is for educational and demonstration purposes.

© 2026 Columbia IEOR
