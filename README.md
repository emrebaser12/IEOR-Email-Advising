# Email Advising System

An intelligent email management system built for the Columbia IEOR department to help academic advisors respond to student inquiries quickly, consistently, and accurately.

**Developed for:** IEOR 3900 - Columbia University
**Team:** Emre Baser, Lara Jones, Mayyada Shair, Yasemin Yuksel, Samuel Velez-Hurtado
**Year:** 2026

---

## Overview

The Email Advising System automates the process of responding to routine student emails. When an email arrives, it is matched against a knowledge base of pre-approved response templates using semantic embedding similarity. High-confidence matches are either auto-sent or drafted for quick advisor approval; low-confidence or ambiguous emails are routed to the advisor review queue with a pre-filled draft.

### How It Works

1. **Email Ingestion** — Emails arrive via Gmail OAuth integration or manual entry
2. **Sensitive Content Check** — Personal or sensitive emails (mental health, emergencies, financial hardship) are immediately flagged and never auto-sent
3. **Semantic Matching** — The email is encoded by a sentence embedding model and compared against every known utterance in the knowledge base
4. **Confidence Scoring** — Confidence equals the best cosine similarity between any sentence in the email and any utterance in an article
5. **LLM Response Generation** — Claude generates a polished, context-aware reply using the matched template as a base
6. **Routing Decision**:
   - **≥ 95% confidence** → Auto-sent (if auto-send is enabled)
   - **55–95% confidence** → Best-match draft surfaced for advisor review
   - **Ambiguous** (top two articles within 8% of each other) → Draft surfaced for review
   - **< 55% confidence** → Generic fallback response, routed to advisor
7. **Response** — Advisors can review, edit, and send replies directly through the dashboard

---

## Features

### Dashboard
- Real-time metrics: total emails, emails today, pending reviews, auto-approved count
- Quick overview of system performance and workload

### Email Management
- **Three-panel view**: Needs Review, Pending Send, and Sent emails
- **Filtering**: By time period (Today, Yesterday, This Week, This Month, This Year)
- **Search**: Find emails by student name, subject, or content
- **Bulk actions**: Select multiple emails for batch operations
- **Detail panel**: View original email, AI-suggested reply, confidence score
- **Draft editing**: Modify AI suggestions before sending
- **Draft saving**: Save work-in-progress to localStorage
- **Waiting time indicators**: Visual urgency badges based on how long emails have been waiting
- **Personal email detection**: Automatically flags sensitive emails (mental health, emergencies, financial hardship) so they are never auto-replied to

### Gmail Integration
- OAuth 2.0 authentication (no password storage)
- Automatic email syncing from inbox
- Send replies directly through Gmail API
- Auto-send capability for high-confidence responses

### Analytics
- Confidence distribution chart
- Average response time metrics
- Pending wait time analysis
- Key insights on automation rate

### Settings
- **Gmail Connection**: Connect/disconnect Gmail via OAuth
- **Auto-send Toggle**: Enable/disable automatic sending
- **Confidence Threshold**: Adjustable slider (50–100%) for auto-send cutoff
- **Advisor Profile**: Customize name, email, department
- **Knowledge Base Management**: Add, edit, delete response templates
- **Reference Corpus Management**: Add, edit, delete supporting documents

### UI
- **Dark mode toggle**: Sun/moon button in the header switches between light and dark themes; preference is remembered across sessions

---

## AI Pipeline

### 1. Sensitive Content Guardrail

Before any matching occurs, incoming emails are scanned for sensitive keywords and phrases. Matches on categories like mental health (`stress`, `anxiety`, `burnout`, `depression`), medical leave, financial hardship, family emergencies, discrimination, or academic distress immediately set the email to `needs_review` and suppress auto-send, regardless of confidence score.

### 2. Semantic Confidence Scoring

The core matching engine uses `multi-qa-MiniLM-L6-cos-v1` (sentence-transformers), a model trained on question-answer pairs that understands semantic intent rather than just token overlap.

**At startup:** every utterance across all knowledge base articles is encoded into a vector and cached in memory.

**At query time:**
1. The email body is split into segments on sentence boundaries (`.!?`) and paragraph breaks (`\n\n`). This isolates the actual question from the greeting and sign-off so they don't dilute the match.
2. Each segment is encoded by the embedding model.
3. For each KB article, confidence = the maximum cosine similarity across all (segment, utterance) pairs.
4. Articles are ranked by confidence.

This approach correctly handles paraphrases — "How late can I add a course this term?" and "What is the deadline to register for classes?" score high against the same article even though they share almost no words.

**Routing thresholds:**

| Confidence | Action |
|---|---|
| ≥ 95% | Auto-send (if enabled) |
| 55–95% | Best-match draft → needs review |
| Top two articles within 8% | Best-match draft → needs review (ambiguous) |
| < 55% | Generic fallback → needs review |

### 3. LLM Response Generation

Once the best-match article is identified, Claude (`claude-sonnet-4-6`) generates the outgoing reply. The LLM receives:
- The student's original email
- The matched knowledge base template as a starting point
- Supporting reference documents retrieved from the reference corpus
- Metadata extracted from the email (student name, term, deadlines)

Claude rewrites the template into a natural, personalized response while staying faithful to the approved content. If the Anthropic API key is not configured, the system falls back to rendering the template directly with placeholder substitution.

### 4. Reference Retrieval (RAG)

Supporting documents (e.g., links to the IEOR curriculum page, withdrawal form, advising resources) are retrieved using TF-IDF similarity between the query and the reference corpus. A minimum relevance threshold filters out loosely-matching documents so only genuinely relevant references appear in the response. Up to 3 references are included.

### 5. Metadata Extraction

Key facts are extracted from the email body automatically — student name, academic term, registration deadlines — and injected into the response template as context. This allows responses to be personalized without advisor intervention.

---

## Tech Stack

### Frontend
- **Framework**: Next.js 16 (React)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **Charts**: Recharts
- **Icons**: Lucide React

### Backend
- **Framework**: FastAPI (Python)
- **Database**: SQLite with SQLAlchemy ORM
- **Email**: Gmail API with OAuth 2.0
- **Embeddings**: `sentence-transformers` — `multi-qa-MiniLM-L6-cos-v1`
- **LLM**: Anthropic Claude (`claude-sonnet-4-6`) via `anthropic` SDK
- **Security**: SSRF protection on URL-fetching endpoints

---

## Project Structure

```
├── Backend/
│   ├── api.py                    # FastAPI application & all endpoints
│   ├── requirements.txt          # Python dependencies
│   ├── data/
│   │   ├── knowledge_base.json   # Response templates and utterances
│   │   ├── reference_corpus.json # Supporting reference documents
│   │   └── gmail_token.json      # OAuth credentials (gitignored)
│   └── email_advising/           # Core AI package
│       ├── advisor.py            # Matching engine and routing logic
│       ├── embeddings.py         # SentenceEmbedder wrapper
│       ├── composers.py          # Template and Claude response generation
│       ├── rag.py                # TF-IDF reference retrieval
│       ├── knowledge_base.py     # KB loader
│       ├── metadata.py           # Auto-extraction of names/dates
│       ├── personal_guardrails.py# Sensitive content detection
│       └── text_processing.py    # Tokenization, stopwords, normalization
│
├── Frontend/
│   ├── app/
│   │   ├── page.tsx              # Main application page
│   │   ├── layout.tsx            # Root layout
│   │   ├── providers.tsx         # Theme provider wrapper
│   │   └── globals.css           # Global styles (light + dark)
│   ├── components/
│   │   ├── sidebar-nav.tsx       # Navigation sidebar
│   │   ├── header-top.tsx        # Top header bar with dark mode toggle
│   │   ├── emails-tab.tsx        # Email management view
│   │   ├── manual-review-table.tsx # Emails awaiting advisor review
│   │   ├── analytics-tab.tsx     # Analytics dashboard
│   │   ├── settings-tab.tsx      # Settings panel
│   │   ├── metrics-cards.tsx     # Dashboard metrics
│   │   └── sample-emails.ts      # Sample emails for testing
│   └── lib/
│       └── utils.ts              # Utility functions
│
└── README.md
```

---

## Getting Started

### Prerequisites
- Python 3.9+
- Node.js 18+
- Google Cloud Console project (for Gmail API)
- Anthropic API key (for Claude LLM — optional, falls back to templates)

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd Backend
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
   On first run, `sentence-transformers` will download the `multi-qa-MiniLM-L6-cos-v1` model (~90 MB). This happens once and is cached locally.

4. **Set environment variables** (create a `.env` file in `Backend/`):
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   GOOGLE_OAUTH_CLIENT_FILE=data/google_client_secrets.json
   FRONTEND_URL=http://localhost:3000
   ```

5. **Set up Gmail OAuth** (optional — required for Gmail sync/send):
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create or select a project, enable the Gmail API
   - Create OAuth 2.0 credentials (Desktop app)
   - Download and save as `Backend/data/google_client_secrets.json`

6. **Run the server:**
   ```bash
   uvicorn api:app --reload --port 8000
   ```

### Frontend Setup

1. **Navigate to frontend directory:**
   ```bash
   cd Frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

4. Open `http://localhost:3000`

---

## Usage

### Connecting Gmail

1. Go to **Settings** tab
2. Click **Connect Gmail**
3. Complete the Google OAuth flow
4. Gmail is now connected for syncing and sending

### Processing Emails

1. Click **Sync from Gmail** to pull new emails, or use **+ Add Sample** for testing
2. Emails appear in **Needs Review** (low/ambiguous confidence) or **Pending Send** (high confidence)
3. Click any email to view the original message and the AI-generated response
4. Edit the response if needed, then click **Send**

### Adjusting Automation

1. Go to **Settings** tab
2. Adjust the **confidence threshold** slider (default: 90%)
3. Toggle **Auto-send** on/off
4. Higher threshold = more human review; lower threshold = more automation

### Managing the Knowledge Base

1. Go to **Settings** tab → **Knowledge Base** section
2. Add new articles with:
   - **ID**: unique identifier
   - **Subject**: email subject line
   - **Categories**: topic tags (comma-separated)
   - **Utterances**: example questions students might ask — the more varied and realistic, the better the matching
   - **Response template**: reply text with `{placeholder}` variables
   - **Follow-up questions**: optional clarifying questions

> **Tip:** Confidence scores are directly limited by utterance coverage. If a particular question type scores low, adding utterances that match how students actually phrase it is the most effective fix.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/emails` | List all emails |
| POST | `/emails/ingest` | Ingest and score a new email |
| POST | `/emails/sync` | Sync emails from Gmail inbox |
| PATCH | `/emails/{id}` | Update email status/content |
| DELETE | `/emails/{id}` | Delete an email |
| POST | `/emails/{id}/send` | Send reply via Gmail |
| GET | `/metrics` | Get dashboard metrics |
| GET | `/email-settings` | Get auto-send settings |
| POST | `/email-settings` | Update auto-send settings |
| GET | `/gmail/status` | Check Gmail connection status |
| GET | `/gmail/auth-url` | Get OAuth authorization URL |
| GET | `/gmail/oauth2callback` | OAuth redirect callback |
| GET | `/gmail/fetch` | Fetch raw emails from Gmail |
| POST | `/gmail/disconnect` | Disconnect Gmail |
| GET | `/knowledge-base` | List KB articles |
| POST | `/knowledge-base` | Add KB article |
| PATCH | `/knowledge-base/{id}` | Update KB article |
| DELETE | `/knowledge-base/{id}` | Delete KB article |
| GET | `/reference-corpus` | List reference corpus documents |
| POST | `/reference-corpus` | Add reference corpus document |
| PATCH | `/reference-corpus/{id}` | Update reference corpus document |
| DELETE | `/reference-corpus/{id}` | Delete reference corpus document |
| POST | `/fetch-url-content` | Fetch and extract text from a URL |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude LLM | None (falls back to templates) |
| `GOOGLE_OAUTH_CLIENT_FILE` | Path to Google OAuth credentials | `data/google_client_secrets.json` |
| `FRONTEND_URL` | Frontend URL for OAuth redirect | `http://localhost:3000` |

### Confidence Thresholds

| Threshold | Default | Description |
|---|---|---|
| `auto_send_threshold` | 95% | Minimum confidence to auto-send |
| `review_threshold` | 55% | Below this, email gets a generic fallback |
| `ambiguity_gap` | 8% | If top two articles are within this gap, route to review |

The auto-send threshold is also adjustable at runtime via the Settings slider.

---

## Testing

### Backend Tests
```bash
cd Backend
pytest
```

### Test Coverage
- Article ranking accuracy
- Auto-send threshold behavior
- Manual review routing
- Ambiguous query handling
- Metadata extraction

---

## Acknowledgments

This project was developed as part of **IEOR 3900** at **Columbia University** for the **Industrial Engineering and Operations Research (IEOR) department**.

Special thanks to the IEOR advising team for their input on response templates and workflow requirements.

---

## License

This project is provided as-is for educational and demonstration purposes.

© 2025 Columbia IEOR
