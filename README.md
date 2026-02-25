# Email Advising System

An intelligent email management system built for the Columbia IEOR department to help academic advisors respond to student inquiries quickly, consistently, and accurately.

**Developed for:** IEOR 3900 - Columbia University  
**Team:** Emre Baser, Lara Jones, Mayyada Shair, Samuel Velez-Hurtado  
**Year:** 2025

---

## Overview

The Email Advising System automates the process of responding to routine student emails. It uses a knowledge base of pre-approved response templates, matches incoming emails to the most relevant template using TF-IDF similarity scoring, and either auto-sends high-confidence responses or routes lower-confidence ones to advisors for review.

### How It Works

1. **Email Ingestion** - Emails arrive via Gmail OAuth integration or manual entry
2. **AI Matching** - The system analyzes the email content and matches it against knowledge base templates
3. **Confidence Scoring** - Each match receives a confidence score (0-100%)
4. **Routing Decision**:
   - **High confidence (≥ threshold)** → Auto-approved for sending
   - **Low confidence (< threshold)** → Flagged for human review
5. **Response** - Advisors can review, edit, and send replies directly through the dashboard

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
- **Confidence Threshold**: Adjustable slider (50-100%) for auto-send cutoff
- **Advisor Profile**: Customize name, email, department
- **Knowledge Base Management**: Add, edit, delete response templates
- **Reference Corpus Management**: Add, edit, delete supporting documents

### AI Capabilities
- **TF-IDF Similarity Matching**: Finds the best template for each query
- **Synonym Expansion**: Understands variations (e.g., "drop" = "withdraw")
- **Metadata Extraction**: Auto-detects student names, terms, deadlines from email text
- **Ambiguity Detection**: Flags emails that match multiple templates similarly
- **Confidence Calibration**: Combines multiple signals for accurate scoring

---

## Tech Stack

### Frontend
- **Framework**: Next.js 14 (React)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **Charts**: Recharts
- **Icons**: Lucide React

### Backend
- **Framework**: FastAPI (Python)
- **Database**: SQLite with SQLAlchemy ORM
- **Email**: Gmail API with OAuth 2.0
- **AI/ML**: Custom TF-IDF implementation (no external ML dependencies)

---

## Project Structure

```
├── Backend/
│   ├── api.py                    # FastAPI application & endpoints
│   ├── data/
│   │   ├── knowledge_base.json   # Response templates
│   │   ├── reference_corpus.json # Supporting documents
│   │   └── gmail_token.json      # OAuth credentials (gitignored)
│   ├── email_advising/           # Core AI package
│   │   ├── advisor.py            # Main matching engine
│   │   ├── similarity.py         # TF-IDF implementation
│   │   ├── composers.py          # Email composition strategies
│   │   ├── knowledge_base.py     # KB loader
│   │   ├── rag.py                # Retrieval-augmented generation
│   │   ├── metadata.py           # Auto-extraction utilities
│   │   └── text_processing.py    # Tokenization & normalization
│   └── tests/
│       └── test_advisor.py       # Unit tests
│
├── Frontend/
│   └── code/
│       ├── app/
│       │   ├── page.tsx          # Main application page
│       │   ├── layout.tsx        # Root layout
│       │   └── globals.css       # Global styles
│       ├── components/
│       │   ├── sidebar-nav.tsx   # Navigation sidebar
│       │   ├── header-top.tsx    # Top header bar
│       │   ├── emails-tab.tsx    # Email management view
│       │   ├── analytics-tab.tsx # Analytics dashboard
│       │   ├── settings-tab.tsx  # Settings panel
│       │   ├── metrics-cards.tsx # Dashboard metrics
│       │   └── ui/               # shadcn/ui components
│       └── lib/
│           └── utils.ts          # Utility functions
│
└── README.md
```

---

## Getting Started

### Prerequisites
- Python 3.9+
- Node.js 18+
- Google Cloud Console project (for Gmail API)

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd Backend
   ```

2. **Create virtual environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   ```

3. **Install dependencies:**
   ```bash
   pip install fastapi uvicorn sqlalchemy google-auth google-auth-oauthlib google-api-python-client
   ```

4. **Set up Gmail OAuth:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable Gmail API
   - Create OAuth 2.0 credentials (Desktop app)
   - Download `client_secrets.json` and place in `Backend/data/google_client_secrets.json`

5. **Run the server:**
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

4. **Open browser:**
   Navigate to `http://localhost:3000`

---

## Usage

### Connecting Gmail

1. Go to **Settings** tab
2. Click **Connect Gmail**
3. Complete Google OAuth flow
4. Gmail is now connected for syncing and sending

### Processing Emails

1. Click **Sync from Gmail** to pull new emails, or use **+ Add Sample** for testing
2. Emails appear in **Needs Review** (low confidence) or **Pending Send** (high confidence)
3. Click any email to view details and AI-suggested response
4. Edit the response if needed
5. Click **Send** to deliver via Gmail

### Adjusting Automation

1. Go to **Settings** tab
2. Adjust the **confidence threshold** slider
3. Toggle **Auto-send** on/off
4. Higher threshold = more human review, lower threshold = more automation

### Managing Knowledge Base

1. Go to **Settings** tab
2. Scroll to **Knowledge Base** section
3. Add new templates with:
   - Unique ID
   - Subject line
   - Categories (comma-separated)
   - Sample utterances (what students might say)
   - Response template (with `{placeholders}`)
   - Follow-up questions

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/emails` | List all emails |
| POST | `/emails/ingest` | Add new email manually |
| PATCH | `/emails/{id}` | Update email status/content |
| DELETE | `/emails/{id}` | Delete an email |
| POST | `/emails/{id}/send` | Send reply via Gmail |
| GET | `/gmail/status` | Check Gmail connection |
| GET | `/gmail/auth-url` | Get OAuth URL |
| POST | `/gmail/disconnect` | Disconnect Gmail |
| GET | `/metrics` | Get dashboard metrics |
| GET | `/knowledge-base` | List KB articles |
| POST | `/knowledge-base` | Add KB article |
| PATCH | `/knowledge-base/{id}` | Update KB article |
| DELETE | `/knowledge-base/{id}` | Delete KB article |

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_OAUTH_CLIENT_FILE` | Path to OAuth credentials | `data/google_client_secrets.json` |
| `FRONTEND_URL` | Frontend URL for OAuth redirect | `http://localhost:3000` |

### Confidence Threshold

The confidence threshold determines the auto-send cutoff:
- **Default**: 90%
- **Range**: 50% - 100%
- **Stored in**: localStorage (frontend) + database (backend)

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
- Synonym expansion
- Metadata extraction
- Ambiguous query handling

---

## Acknowledgments

This project was developed as part of **IEOR 3900** at **Columbia University** for the **Industrial Engineering and Operations Research (IEOR) department**.

Special thanks to the IEOR advising team for their input on response templates and workflow requirements.

---

## License

This project is provided as-is for educational and demonstration purposes.

© 2025 Columbia IEOR