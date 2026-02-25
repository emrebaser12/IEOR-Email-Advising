import os
import json
import base64
from pathlib import Path
from datetime import datetime, date
from enum import Enum
from typing import List, Optional, Dict, Sequence, Any
from datetime import timezone as dt_timezone, timedelta
from zoneinfo import ZoneInfo

import email
from email.header import decode_header
from email.utils import parseaddr
from email.message import EmailMessage

from fastapi import FastAPI, Query, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict

from email_advising import (
    EmailAdvisor,
    TfidfRetriever,
    KnowledgeArticle,
    KnowledgeBase,
    PersonalEmailDetector,
    load_knowledge_base,
    load_reference_corpus,
)

from sqlalchemy import (
    create_engine,
    Column,
    Integer,
    String,
    Float,
    DateTime,
    Text,
    Enum as SAEnum,
    func,
    Boolean,
    text,
)
from sqlalchemy.orm import declarative_base, sessionmaker, Session

# Gmail / OAuth
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

# =====================================================
# Paths, constants, app setup
# =====================================================

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

CONFIDENCE_THRESHOLD = 0.9  # >= this → auto, else review

# Gmail OAuth configuration
SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]
CLIENT_SECRETS_FILE = os.getenv(
    "GOOGLE_OAUTH_CLIENT_FILE",
    str(DATA_DIR / "google_client_secrets.json"),
)
GMAIL_TOKEN_PATH = DATA_DIR / "gmail_token.json"
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")

# In-memory store for OAuth flows keyed by state
oauth_flows: Dict[str, Flow] = {}

# =====================================================
# FastAPI app + CORS
# =====================================================

app = FastAPI(title="Email Advising System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================
# Load backend advising logic
# =====================================================

knowledge_base = load_knowledge_base()
reference_corpus = load_reference_corpus()
retriever = TfidfRetriever(reference_corpus)
advisor = EmailAdvisor(knowledge_base, retriever=retriever)
personal_detector = PersonalEmailDetector()


# =====================================================
# Knowledge Base CRUD endpoints
# =====================================================

KB_JSON_PATH = DATA_DIR / "knowledge_base.json"
RC_JSON_PATH = DATA_DIR / "reference_corpus.json"
knowledge_base_last_loaded_mtime = (
    KB_JSON_PATH.stat().st_mtime if KB_JSON_PATH.exists() else None
)
reference_corpus_last_loaded_mtime = (
    RC_JSON_PATH.stat().st_mtime if RC_JSON_PATH.exists() else None
)


def _article_to_dict(article: KnowledgeArticle) -> Dict[str, Any]:
    return {
        "id": article.id,
        "subject": article.subject,
        "categories": list(article.categories),
        "utterances": list(article.utterances),
        "response_template": article.response_template,
        "follow_up_questions": list(article.follow_up_questions),
        "metadata": article.metadata or {},
    }


def save_knowledge_base_to_file(articles: Optional[Sequence[KnowledgeArticle]] = None):
    """Persist the current knowledge_base to JSON file."""
    global knowledge_base_last_loaded_mtime
    source = list(articles) if articles is not None else list(knowledge_base.articles)
    data = [_article_to_dict(article) for article in source]
    with open(KB_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    knowledge_base_last_loaded_mtime = KB_JSON_PATH.stat().st_mtime


def save_reference_corpus_to_file():
    """Persist the current reference_corpus to JSON file."""
    global reference_corpus_last_loaded_mtime
    data = [
        {
            "id": doc.id,
            "title": doc.title,
            "url": doc.url,
            "tags": list(doc.tags),
            "content": doc.content,
        }
        for doc in reference_corpus.documents
    ]
    with open(RC_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    reference_corpus_last_loaded_mtime = RC_JSON_PATH.stat().st_mtime


def reload_retriever():
    """Reload the TF-IDF retriever with current reference corpus."""
    global retriever
    retriever = TfidfRetriever(reference_corpus)
    rebuild_advisor()


def rebuild_advisor():
    """Recreate the EmailAdvisor with the latest knowledge base + corpus."""
    global advisor
    advisor = EmailAdvisor(knowledge_base, retriever=retriever)


def replace_knowledge_base(articles: List[KnowledgeArticle]):
    """Swap the in-memory knowledge base and persist it."""
    global knowledge_base
    knowledge_base = KnowledgeBase(articles)
    save_knowledge_base_to_file(articles)
    rebuild_advisor()


def ensure_knowledge_base_is_fresh():
    """Reload knowledge base if the JSON file changed on disk."""
    global knowledge_base, knowledge_base_last_loaded_mtime
    if not KB_JSON_PATH.exists():
        return
    current_mtime = KB_JSON_PATH.stat().st_mtime
    if (
        knowledge_base_last_loaded_mtime is None
        or current_mtime > knowledge_base_last_loaded_mtime
    ):
        knowledge_base = load_knowledge_base(KB_JSON_PATH)
        knowledge_base_last_loaded_mtime = current_mtime
        rebuild_advisor()


def ensure_reference_corpus_is_fresh():
    """Reload the reference corpus from disk if the JSON file changed."""
    global reference_corpus, reference_corpus_last_loaded_mtime
    if not RC_JSON_PATH.exists():
        return
    current_mtime = RC_JSON_PATH.stat().st_mtime
    if reference_corpus_last_loaded_mtime is None or current_mtime > reference_corpus_last_loaded_mtime:
        reference_corpus = load_reference_corpus(RC_JSON_PATH)
        reference_corpus_last_loaded_mtime = current_mtime
        reload_retriever()


@app.get("/knowledge-base")
def get_knowledge_base_articles():
    """Expose the current knowledge base articles for the frontend settings view."""
    ensure_knowledge_base_is_fresh()
    return [_article_to_dict(article) for article in knowledge_base.articles]


class KBArticleCreate(BaseModel):
    """Payload to create a new knowledge base article."""
    id: str
    subject: str
    categories: List[str] = []
    utterances: List[str] = []
    response_template: str = ""
    follow_up_questions: List[str] = []
    metadata: Optional[Dict] = None


class KBArticleUpdate(BaseModel):
    """Payload to update an existing knowledge base article."""
    subject: Optional[str] = None
    categories: Optional[List[str]] = None
    utterances: Optional[List[str]] = None
    response_template: Optional[str] = None
    follow_up_questions: Optional[List[str]] = None
    metadata: Optional[Dict] = None


@app.post("/knowledge-base")
def create_knowledge_base_article(article: KBArticleCreate):
    """Add a new article to the knowledge base."""
    ensure_knowledge_base_is_fresh()
    current_articles = list(knowledge_base.articles)
    for existing in current_articles:
        if existing.id == article.id:
            raise HTTPException(status_code=400, detail=f"Article with id '{article.id}' already exists")

    new_article = KnowledgeArticle(
        id=article.id,
        subject=article.subject,
        categories=list(article.categories),
        utterances=list(article.utterances),
        response_template=article.response_template,
        follow_up_questions=list(article.follow_up_questions),
        metadata=article.metadata,
    )
    current_articles.append(new_article)
    replace_knowledge_base(current_articles)
    
    return {
        "ok": True,
        "article": _article_to_dict(new_article),
    }


@app.patch("/knowledge-base/{article_id}")
def update_knowledge_base_article(article_id: str, update: KBArticleUpdate):
    """Update an existing knowledge base article."""
    ensure_knowledge_base_is_fresh()
    updated_article = None
    updated_articles: List[KnowledgeArticle] = []
    for article in knowledge_base.articles:
        if article.id == article_id:
            updated_article = KnowledgeArticle(
                id=article.id,
                subject=update.subject if update.subject is not None else article.subject,
                categories=(
                    list(update.categories)
                    if update.categories is not None
                    else list(article.categories)
                ),
                utterances=(
                    list(update.utterances)
                    if update.utterances is not None
                    else list(article.utterances)
                ),
                response_template=(
                    update.response_template
                    if update.response_template is not None
                    else article.response_template
                ),
                follow_up_questions=(
                    list(update.follow_up_questions)
                    if update.follow_up_questions is not None
                    else list(article.follow_up_questions)
                ),
                metadata=update.metadata if update.metadata is not None else dict(article.metadata or {}),
            )
            updated_articles.append(updated_article)
        else:
            updated_articles.append(article)

    if updated_article is None:
        raise HTTPException(status_code=404, detail=f"Article with id '{article_id}' not found")

    replace_knowledge_base(updated_articles)
    return {
        "ok": True,
        "article": _article_to_dict(updated_article),
    }


@app.delete("/knowledge-base/{article_id}")
def delete_knowledge_base_article(article_id: str):
    """Delete an article from the knowledge base."""
    ensure_knowledge_base_is_fresh()
    remaining_articles = [article for article in knowledge_base.articles if article.id != article_id]
    if len(remaining_articles) == len(knowledge_base.articles):
        raise HTTPException(status_code=404, detail=f"Article with id '{article_id}' not found")
    if not remaining_articles:
        raise HTTPException(
            status_code=400,
            detail="Knowledge base must contain at least one article.",
        )

    replace_knowledge_base(remaining_articles)
    return {"ok": True, "deleted_id": article_id}


# =====================================================
# Reference Corpus CRUD endpoints
# =====================================================

@app.get("/reference-corpus")
def get_reference_corpus_documents():
    """Expose reference corpus documents so advisors can manage linked websites."""
    ensure_reference_corpus_is_fresh()
    return [
        {
            "id": document.id,
            "title": document.title,
            "url": document.url,
            "tags": list(document.tags),
            "content": document.content,
        }
        for document in reference_corpus.documents
    ]


class RCDocumentCreate(BaseModel):
    """Payload to create a new reference corpus document."""
    id: str
    title: str
    url: str = ""
    tags: List[str] = []
    content: str = ""


class RCDocumentUpdate(BaseModel):
    """Payload to update an existing reference corpus document."""
    title: Optional[str] = None
    url: Optional[str] = None
    tags: Optional[List[str]] = None
    content: Optional[str] = None


@app.post("/reference-corpus")
def create_reference_corpus_document(doc: RCDocumentCreate):
    """Add a new document to the reference corpus."""
    from email_advising.models import ReferenceDocument
    ensure_reference_corpus_is_fresh()
    
    # Check for duplicate ID
    for existing in reference_corpus.documents:
        if existing.id == doc.id:
            raise HTTPException(status_code=400, detail=f"Document with id '{doc.id}' already exists")
    
    new_doc = ReferenceDocument(
        id=doc.id,
        title=doc.title,
        url=doc.url,
        tags=set(doc.tags),
        content=doc.content,
    )
    reference_corpus.documents.append(new_doc)
    save_reference_corpus_to_file()
    reload_retriever()  # Rebuild TF-IDF index
    
    return {
        "ok": True,
        "document": {
            "id": new_doc.id,
            "title": new_doc.title,
            "url": new_doc.url,
            "tags": list(new_doc.tags),
            "content": new_doc.content,
        }
    }


@app.patch("/reference-corpus/{doc_id}")
def update_reference_corpus_document(doc_id: str, update: RCDocumentUpdate):
    """Update an existing reference corpus document."""
    ensure_reference_corpus_is_fresh()
    for doc in reference_corpus.documents:
        if doc.id == doc_id:
            if update.title is not None:
                doc.title = update.title
            if update.url is not None:
                doc.url = update.url
            if update.tags is not None:
                doc.tags = set(update.tags)
            if update.content is not None:
                doc.content = update.content
            
            save_reference_corpus_to_file()
            reload_retriever()  # Rebuild TF-IDF index
            
            return {
                "ok": True,
                "document": {
                    "id": doc.id,
                    "title": doc.title,
                    "url": doc.url,
                    "tags": list(doc.tags),
                    "content": doc.content,
                }
            }
    
    raise HTTPException(status_code=404, detail=f"Document with id '{doc_id}' not found")


@app.delete("/reference-corpus/{doc_id}")
def delete_reference_corpus_document(doc_id: str):
    """Delete a document from the reference corpus."""
    ensure_reference_corpus_is_fresh()
    for i, doc in enumerate(reference_corpus.documents):
        if doc.id == doc_id:
            reference_corpus.documents.pop(i)
            save_reference_corpus_to_file()
            reload_retriever()  # Rebuild TF-IDF index
            return {"ok": True, "deleted_id": doc_id}
    
    raise HTTPException(status_code=404, detail=f"Document with id '{doc_id}' not found")


class FetchURLRequest(BaseModel):
    """Request to fetch content from a URL."""
    url: str


class SendEmailRequest(BaseModel):
    """Payload to send a manual or edited reply via Gmail."""
    reply_text: Optional[str] = None


@app.post("/fetch-url-content")
def fetch_url_content(req: FetchURLRequest):
    """
    Fetch text content from a URL for adding to the reference corpus.
    This is a helper endpoint that advisors can use to auto-populate content.
    """
    import requests
    from bs4 import BeautifulSoup
    
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; EmailAdvisingBot/1.0)"
        }
        response = requests.get(req.url, headers=headers, timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        # Remove script and style elements
        for script in soup(["script", "style", "nav", "footer", "header"]):
            script.decompose()
        
        # Get text
        text = soup.get_text(separator=" ", strip=True)
        
        # Clean up whitespace
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = " ".join(chunk for chunk in chunks if chunk)
        
        # Truncate if too long
        if len(text) > 5000:
            text = text[:5000] + "..."
        
        # Try to get page title
        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        
        return {
            "ok": True,
            "title": title,
            "content": text,
            "url": req.url,
        }
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing URL: {str(e)}")

# =====================================================
# Database setup (SQLite + SQLAlchemy)
# =====================================================

DATABASE_URL = "sqlite:///./emails.db"  # file in Backend directory

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # needed for SQLite + threads
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

# =====================================================
# Email models (Enum, Pydantic, SQLAlchemy ORM)
# =====================================================


class EmailStatus(str, Enum):
    auto = "auto"          # approved / high-confidence
    review = "review"      # needs manual review
    sent = "sent"          # reply has been sent
    personal = "personal"  # flagged as personal / sensitive — never auto-send


# ---------- Pydantic models (API schemas) ----------


class EmailIn(BaseModel):
    """
    Payload when a *new email* arrives to the system.
    This is what your ingestion script or frontend button sends.
    """
    student_name: Optional[str] = None
    uni: Optional[str] = None
    email_address: Optional[str] = None  # sender's email address
    subject: str
    body: str
    received_at: Optional[datetime] = None


class Email(BaseModel):
    """
    Full email object as stored/returned by the backend.
    """
    id: int
    student_name: Optional[str] = None
    uni: Optional[str] = None
    email_address: Optional[str] = None
    subject: str
    body: str
    confidence: float
    status: EmailStatus
    suggested_reply: str
    received_at: datetime
    approved_at: Optional[datetime] = None
    assigned_to: Optional[str] = None


class EmailUpdate(BaseModel):
    """
    Fields that can be updated by the advisor (or system).
    Supports changing status, editing the suggested_reply, and assigning an advisor.
    """
    status: Optional[EmailStatus] = None
    suggested_reply: Optional[str] = None
    assigned_to: Optional[str] = None


class EmailSettings(BaseModel):
    """
    Stored in the email_settings table.
    We still keep the IMAP/SMTP fields for backwards-compat/schema,
    but the frontend now only really uses auto_* and last_synced_at.
    """
    email_address: str
    imap_server: str
    imap_port: int
    smtp_server: str
    smtp_port: int
    use_tls: bool
    auto_send_enabled: bool
    auto_send_threshold: float  # 0–1
    last_synced_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class EmailSettingsUpdate(BaseModel):
    """
    Partial update. The new Settings tab only sends:
    - auto_send_enabled
    - auto_send_threshold
    but we keep the other fields optional for backwards compat.
    """
    email_address: Optional[str] = None
    app_password: Optional[str] = None  # legacy; ignored for OAuth
    imap_server: Optional[str] = None
    imap_port: Optional[int] = None
    smtp_server: Optional[str] = None
    smtp_port: Optional[int] = None
    use_tls: Optional[bool] = None
    auto_send_enabled: Optional[bool] = None
    auto_send_threshold: Optional[float] = None


# ---------- SQLAlchemy ORM model (DB tables) ----------


class EmailSettingsORM(Base):
    __tablename__ = "email_settings"

    id = Column(Integer, primary_key=True, index=True)
    email_address = Column(String, nullable=False, default="")
    # app_password kept for backwards compat but not used with OAuth
    app_password = Column(String, nullable=False, default="")
    imap_server = Column(String, nullable=False, default="imap.gmail.com")
    imap_port = Column(Integer, nullable=False, default=993)
    smtp_server = Column(String, nullable=False, default="smtp.gmail.com")
    smtp_port = Column(Integer, nullable=False, default=587)
    use_tls = Column(Boolean, nullable=False, default=True)
    auto_send_enabled = Column(Boolean, nullable=False, default=False)
    auto_send_threshold = Column(Float, nullable=False, default=CONFIDENCE_THRESHOLD)
    last_synced_at = Column(DateTime, nullable=True)


class EmailORM(Base):
    __tablename__ = "emails"

    id = Column(Integer, primary_key=True, index=True)
    student_name = Column(String, nullable=True)
    uni = Column(String, nullable=True)
    email_address = Column(String, nullable=True)  # sender's email for replies
    subject = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False)
    status = Column(SAEnum(EmailStatus), nullable=False)
    suggested_reply = Column(Text, nullable=False)
    received_at = Column(DateTime, nullable=False, index=True)
    approved_at = Column(DateTime, nullable=True)  # when advisor approved/sent
    assigned_to = Column(String, nullable=True)  # advisor assigned to this email


# Create tables if they don't exist yet
Base.metadata.create_all(bind=engine)


def _migrate_db():
    """Add columns introduced after initial schema creation."""
    with engine.connect() as conn:
        existing = {row[1] for row in conn.execute(text("PRAGMA table_info(emails)"))}
        if "assigned_to" not in existing:
            conn.execute(text("ALTER TABLE emails ADD COLUMN assigned_to VARCHAR"))
            conn.commit()


_migrate_db()

# =====================================================
# Gmail OAuth helpers
# =====================================================


def load_gmail_credentials() -> tuple[Optional[Credentials], Optional[str]]:
    """
    Load stored Gmail OAuth credentials (if any).
    Returns (creds, email_address).
    """
    if not GMAIL_TOKEN_PATH.exists():
        return None, None

    with GMAIL_TOKEN_PATH.open("r") as f:
        data = json.load(f)

    email_address = data.get("email_address")
    creds_info = {k: v for k, v in data.items() if k != "email_address"}

    try:
        creds = Credentials.from_authorized_user_info(creds_info, SCOPES)
    except Exception:
        return None, email_address

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(GoogleAuthRequest())
                # Persist refreshed tokens so future loads stay valid
                if email_address:
                    save_gmail_credentials(creds, email_address)
            except Exception:
                return None, email_address
        else:
            return None, email_address

    return creds, email_address


def save_gmail_credentials(creds: Credentials, email_address: str) -> None:
    """
    Persist Gmail OAuth credentials + email address to disk.
    """
    data = json.loads(creds.to_json())
    data["email_address"] = email_address
    GMAIL_TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    with GMAIL_TOKEN_PATH.open("w") as f:
        json.dump(data, f)


def get_or_create_settings(db: Session) -> EmailSettingsORM:
    settings = db.query(EmailSettingsORM).first()
    if settings is None:
        settings = EmailSettingsORM(
            email_address="",
            app_password="",  # legacy / unused with OAuth
            imap_server="imap.gmail.com",
            imap_port=993,
            smtp_server="smtp.gmail.com",
            smtp_port=587,
            use_tls=True,
            auto_send_enabled=False,
            auto_send_threshold=CONFIDENCE_THRESHOLD,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def extract_text_from_email(msg: email.message.Message) -> str:
    """Return the plain-text body from an email.message.Message"""
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get("Content-Disposition") or "")
            if ctype == "text/plain" and "attachment" not in disp:
                charset = part.get_content_charset() or "utf-8"
                try:
                    return part.get_payload(decode=True).decode(
                        charset, errors="ignore"
                    )
                except Exception:
                    continue
        return ""
    else:
        charset = msg.get_content_charset() or "utf-8"
        try:
            return msg.get_payload(decode=True).decode(charset, errors="ignore")
        except Exception:
            return ""


def send_email_via_gmail_api(
    creds: Credentials,
    from_addr: str,
    to_addr: str,
    subject: str,
    body: str,
) -> None:
    """
    Send email using Gmail API with proper HTML formatting.
    Handles both plain text and HTML rendering.
    """
    import html
    
    msg = EmailMessage()
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg["Subject"] = f"Re: {subject}" if not subject.startswith("Re:") else subject
    
    # Set plain text version
    msg.set_content(body)
    
    # Create HTML version with proper formatting
    # Escape HTML entities and convert newlines to <br> tags
    escaped_body = html.escape(body)
    html_body = f"""<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {{ font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.5; color: #333; }}
        p {{ margin: 0 0 1em 0; }}
    </style>
</head>
<body>
    {escaped_body.replace(chr(10), '<br>')}
</body>
</html>"""
    
    msg.add_alternative(html_body, subtype="html")

    raw_bytes = msg.as_bytes()
    raw_b64 = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")

    service = build("gmail", "v1", credentials=creds)
    service.users().messages().send(
        userId="me",
        body={"raw": raw_b64},
    ).execute()


# ---------- Utility: DB session + conversion ----------

def get_db() -> Session:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def orm_to_schema(email_obj: EmailORM) -> Email:
    return Email(
        id=email_obj.id,
        student_name=email_obj.student_name,
        uni=email_obj.uni,
        email_address=email_obj.email_address,
        subject=email_obj.subject,
        body=email_obj.body,
        confidence=email_obj.confidence,
        status=email_obj.status,
        suggested_reply=email_obj.suggested_reply,
        received_at=email_obj.received_at,
        approved_at=email_obj.approved_at,
        assigned_to=email_obj.assigned_to,
    )


def settings_orm_to_schema(settings: EmailSettingsORM) -> EmailSettings:
    """Convert ORM model to Pydantic schema."""
    return EmailSettings(
        email_address=settings.email_address,
        imap_server=settings.imap_server,
        imap_port=settings.imap_port,
        smtp_server=settings.smtp_server,
        smtp_port=settings.smtp_port,
        use_tls=settings.use_tls,
        auto_send_enabled=settings.auto_send_enabled,
        auto_send_threshold=settings.auto_send_threshold,
        last_synced_at=settings.last_synced_at,
    )


# =====================================================
# Email client settings
# =====================================================


@app.get("/email-settings", response_model=EmailSettings)
def read_email_settings():
    db = SessionLocal()
    try:
        settings = get_or_create_settings(db)
        return settings_orm_to_schema(settings)
    finally:
        db.close()


@app.post("/email-settings", response_model=EmailSettings)
def update_email_settings(payload: EmailSettingsUpdate):
    db = SessionLocal()
    try:
        settings = get_or_create_settings(db)
        data = payload.model_dump(exclude_unset=True)

        for field, value in data.items():
            if field == "app_password":
                # Legacy: ignore or only update if you really want to keep it
                continue
            setattr(settings, field, value)

        db.add(settings)
        db.commit()
        db.refresh(settings)
        return settings_orm_to_schema(settings)
    finally:
        db.close()


# =====================================================
# Gmail OAuth endpoints
# =====================================================


@app.get("/gmail/status")
def gmail_status():
    """
    Return whether Gmail is connected, what address, and (optionally) last sync time.
    Used by Settings tab on load.
    """
    db = SessionLocal()
    try:
        settings = get_or_create_settings(db)
        creds, email_address = load_gmail_credentials()
        connected = bool(creds and email_address)

        # Keep email_settings.email_address in sync with Gmail profile
        if connected and email_address and settings.email_address != email_address:
            settings.email_address = email_address
            db.add(settings)
            db.commit()

        return {
            "connected": connected,
            "email_address": email_address or settings.email_address,
            "last_synced_at": settings.last_synced_at.isoformat()
            if settings.last_synced_at
            else None,
        }
    finally:
        db.close()


@app.get("/gmail/auth-url")
def gmail_auth_url():
    """
    Create an OAuth flow and return the Google authorization URL.
    Frontend will redirect the browser to this URL when user clicks "Connect Gmail".
    """
    if not Path(CLIENT_SECRETS_FILE).exists():
        raise HTTPException(
            status_code=500,
            detail="Google OAuth client secrets file not found. "
            "Expected at GOOGLE_OAUTH_CLIENT_FILE or data/google_client_secrets.json",
        )

    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri="http://127.0.0.1:8000/gmail/oauth2callback",
    )

    # NOTE: include_granted_scopes removed – it was causing the 400 error.
    auth_url, state = flow.authorization_url(
        access_type="offline",
        prompt="consent",
    )

    oauth_flows[state] = flow
    return {"auth_url": auth_url}


@app.get("/gmail/oauth2callback")
def gmail_oauth2callback(request: Request, state: str, code: str):
    """
    OAuth redirect URI that Google calls with ?state=...&code=...
    Exchanges code for tokens, stores them, and then redirects user back to the frontend.
    """
    flow = oauth_flows.get(state)
    if not flow:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    # Complete the OAuth flow
    flow.fetch_token(code=code)
    creds: Credentials = flow.credentials

    # Use Gmail API to get the user's email address
    service = build("gmail", "v1", credentials=creds)
    profile = service.users().getProfile(userId="me").execute()
    email_address = profile.get("emailAddress")

    if not email_address:
        raise HTTPException(status_code=400, detail="Unable to determine Gmail address")

    save_gmail_credentials(creds, email_address)

    # Clean up the used state
    oauth_flows.pop(state, None)

    # Redirect back to the frontend app
    redirect_url = FRONTEND_URL
    if "?" in redirect_url:
        redirect_url = f"{redirect_url}&tab=settings"
    else:
        redirect_url = f"{redirect_url}?tab=settings"
    return RedirectResponse(url=redirect_url)


# =====================================================
# Endpoint: ingest email (manual)
# =====================================================


@app.post("/emails/ingest", response_model=Email)
def ingest_email(email_in: EmailIn):
    """
    Simulate 'an email came into the advisor inbox'.

    1. Run the EmailAdvisor on the email body.
    2. Decide if it's auto or review based on confidence.
    3. Store it in SQLite.
    4. If auto and settings enabled, send immediately.
    5. Return the stored email object.
    """
    received_at = email_in.received_at or datetime.utcnow()

    # Run advisor on the body (what the student actually wrote)
    result = advisor.process_query(
        email_in.body,
        {"student_name": email_in.student_name},
    )

    confidence = float(result.confidence or 0.0)
    suggested_reply = result.body

    db = SessionLocal()
    try:
        # Get user's threshold from settings
        settings = get_or_create_settings(db)
        threshold = settings.auto_send_threshold or CONFIDENCE_THRESHOLD

        # Guardrail: check for personal / sensitive content first
        guardrail = personal_detector.check(email_in.body)
        if guardrail.is_personal:
            status = EmailStatus.personal
            # Override suggested reply for personal emails
            suggested_reply = (
                "Hello {name},\n\n"
                "Thank you for reaching out. Your message has been flagged for personal "
                "attention from our advising team. An advisor will follow up with you "
                "directly.\n\n"
                "If you need immediate support, please contact:\n"
                "• Columbia Counseling and Psychological Services (CPS): (212) 854-2878\n"
                "• Columbia Health: (212) 854-2284\n\n"
                "Best,\nAcademic Advising Team"
            ).format(name=email_in.student_name or "there")
        else:
            # Normal policy: high confidence => auto, otherwise => review
            status = (
                EmailStatus.auto
                if confidence >= threshold
                else EmailStatus.review
            )

        email_obj = EmailORM(
            student_name=email_in.student_name,
            uni=email_in.uni,
            email_address=email_in.email_address,
            subject=email_in.subject,
            body=email_in.body,
            confidence=confidence,
            status=status,
            suggested_reply=suggested_reply,
            received_at=received_at,
        )
        db.add(email_obj)
        db.commit()
        db.refresh(email_obj)

        # Auto-send if status is auto and settings allow it
        if status == EmailStatus.auto:
            if settings.auto_send_enabled and email_in.email_address:
                try:
                    creds, gmail_address = load_gmail_credentials()
                    if creds and creds.valid:
                        send_email_via_gmail_api(
                            creds=creds,
                            from_addr=gmail_address or settings.email_address,
                            to_addr=email_in.email_address,
                            subject=email_obj.subject,
                            body=suggested_reply,
                        )
                        email_obj.status = EmailStatus.sent
                        email_obj.approved_at = datetime.utcnow()
                        db.add(email_obj)
                        db.commit()
                        db.refresh(email_obj)
                except Exception as exc:
                    print(f"Failed to auto-send email to {email_in.email_address}: {exc}")
                    # Keep status as auto if send fails, don't crash

        return orm_to_schema(email_obj)
    finally:
        db.close()


# =====================================================
# Endpoint: sync emails from Gmail (OAuth)
# =====================================================


@app.post("/emails/sync")
def sync_emails(limit: int = 20):
    """
    Use Gmail API (OAuth) to pull unread emails, run them through the advisor,
    store them in SQLite, and optionally auto-send replies.
    """
    db = SessionLocal()
    try:
        settings = get_or_create_settings(db)
        creds, gmail_address = load_gmail_credentials()
        if not creds or not creds.valid:
            raise HTTPException(
                status_code=400,
                detail="Gmail is not connected. Use /gmail/auth-url via the Settings tab.",
            )

        service = build("gmail", "v1", credentials=creds)

        # Pull unread messages
        res = (
            service.users()
            .messages()
            .list(userId="me", q="is:unread", maxResults=limit)
            .execute()
        )
        messages = res.get("messages", [])

        ingested = 0
        auto_sent = 0
        threshold = settings.auto_send_threshold or CONFIDENCE_THRESHOLD

        for m in messages:
            msg_id = m["id"]
            msg_data = (
                service.users()
                .messages()
                .get(userId="me", id=msg_id, format="raw")
                .execute()
            )

            raw_b64 = msg_data["raw"]
            raw_bytes = base64.urlsafe_b64decode(raw_b64.encode("utf-8"))
            msg = email.message_from_bytes(raw_bytes)

            raw_subject = msg.get("Subject", "")
            decoded = decode_header(raw_subject)[0]
            subject, enc = decoded
            if isinstance(subject, bytes):
                subject = subject.decode(enc or "utf-8", errors="ignore")

            from_name, from_addr = parseaddr(msg.get("From", ""))

            body = extract_text_from_email(msg)
            if not body.strip():
                # Mark as read but skip storing empty messages
                service.users().messages().modify(
                    userId="me",
                    id=msg_id,
                    body={"removeLabelIds": ["UNREAD"]},
                ).execute()
                continue

            # Naive duplicate check (subject + body)
            existing = (
                db.query(EmailORM)
                .filter(EmailORM.subject == subject, EmailORM.body == body)
                .first()
            )
            if existing:
                # Still mark as read
                service.users().messages().modify(
                    userId="me",
                    id=msg_id,
                    body={"removeLabelIds": ["UNREAD"]},
                ).execute()
                continue

            result = advisor.process_query(
                body,
                {"student_name": from_name},
            )
            confidence = float(result.confidence or 0.0)
            suggested_reply = result.body

            # Guardrail: check for personal / sensitive content
            guardrail = personal_detector.check(body)
            if guardrail.is_personal:
                status_enum = EmailStatus.personal
                suggested_reply = (
                    "Hello {name},\n\n"
                    "Thank you for reaching out. Your message has been flagged for personal "
                    "attention from our advising team. An advisor will follow up with you "
                    "directly.\n\n"
                    "If you need immediate support, please contact:\n"
                    "• Columbia Counseling and Psychological Services (CPS): (212) 854-2878\n"
                    "• Columbia Health: (212) 854-2284\n\n"
                    "Best,\nAcademic Advising Team"
                ).format(name=from_name or "there")
            else:
                status_enum = (
                    EmailStatus.auto if confidence >= threshold else EmailStatus.review
                )

            # Extract UNI from email address (format: UNI@columbia.edu)
            extracted_uni = None
            if from_addr:
                from_addr_lower = from_addr.lower()
                if from_addr_lower.endswith("@columbia.edu"):
                    extracted_uni = from_addr_lower.replace("@columbia.edu", "")
                elif from_addr_lower.endswith("@barnard.edu"):
                    extracted_uni = from_addr_lower.replace("@barnard.edu", "")

            email_obj = EmailORM(
                student_name=from_name or None,
                uni=extracted_uni,
                email_address=from_addr,  # Store sender's email for replies!
                subject=subject or "(no subject)",
                body=body,
                confidence=confidence,
                status=status_enum,
                suggested_reply=suggested_reply,
                received_at=datetime.utcnow(),
            )
            db.add(email_obj)
            db.commit()
            db.refresh(email_obj)
            ingested += 1

            # Optional auto-send via Gmail API
            if (
                status_enum == EmailStatus.auto
                and settings.auto_send_enabled
                and from_addr
            ):
                try:
                    send_email_via_gmail_api(
                        creds=creds,
                        from_addr=gmail_address or settings.email_address,
                        to_addr=from_addr,
                        subject=subject,
                        body=suggested_reply,
                    )
                    email_obj.status = EmailStatus.sent
                    db.add(email_obj)
                    db.commit()
                    auto_sent += 1
                except Exception as exc:
                    print("Failed to auto-send reply:", exc)

            # Mark the original message as read
            service.users().messages().modify(
                userId="me",
                id=msg_id,
                body={"removeLabelIds": ["UNREAD"]},
            ).execute()

        et_tz = dt_timezone(timedelta(hours=-5))
        settings.last_synced_at = datetime.now(et_tz).replace(tzinfo=None)

        db.add(settings)
        db.commit()

        return {
            "ingested": ingested,
            "auto_sent": auto_sent,
            "last_synced_at": settings.last_synced_at.isoformat()
            if settings.last_synced_at
            else None,
        }
    finally:
        db.close()


# =====================================================
# Gmail fetch endpoint (GET alias for sync)
# =====================================================


@app.get("/gmail/fetch")
def gmail_fetch(limit: int = Query(default=20, description="Max emails to fetch")):
    """
    Fetch new emails from Gmail. GET endpoint for easy triggering.
    This is an alias for POST /emails/sync for convenience.
    """
    return sync_emails(limit=limit)


# =====================================================
# Endpoint: Send reply for a specific email
# =====================================================


@app.post("/emails/{email_id}/send")
def send_email_reply(email_id: int, payload: Optional[SendEmailRequest] = None):
    """
    Send a reply email via Gmail API for the given email.
    Optionally override the reply text.
    Updates status to 'sent' after successful send.
    """
    db = SessionLocal()
    try:
        email_obj = db.query(EmailORM).filter(EmailORM.id == email_id).first()
        if email_obj is None:
            raise HTTPException(status_code=404, detail="Email not found")

        # Get Gmail credentials
        creds, gmail_address = load_gmail_credentials()
        if not creds or not creds.valid:
            raise HTTPException(
                status_code=400,
                detail="Gmail is not connected. Please connect Gmail in Settings.",
            )

        # Determine recipient
        to_addr = email_obj.email_address
        if not to_addr:
            # Try to construct from UNI if available
            if email_obj.uni:
                to_addr = f"{email_obj.uni}@columbia.edu"
            else:
                raise HTTPException(
                    status_code=400,
                    detail="No recipient email address available for this email.",
                )

        # Use provided reply text or the stored suggested_reply
        new_reply = payload.reply_text if payload else None
        final_reply = new_reply if new_reply is not None else email_obj.suggested_reply

        # Update the suggested_reply if a new one was provided
        if new_reply is not None:
            email_obj.suggested_reply = new_reply

        # Send the email
        try:
            send_email_via_gmail_api(
                creds=creds,
                from_addr=gmail_address,
                to_addr=to_addr,
                subject=email_obj.subject,
                body=final_reply,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to send email: {str(exc)}",
            )

        # Update status to sent and set approved_at if not already set
        email_obj.status = EmailStatus.sent
        if email_obj.approved_at is None:
            email_obj.approved_at = datetime.utcnow()
        db.add(email_obj)
        db.commit()
        db.refresh(email_obj)

        return {
            "ok": True,
            "message": f"Reply sent to {to_addr}",
            "email": orm_to_schema(email_obj),
        }
    finally:
        db.close()


# =====================================================
# Gmail disconnect
# =====================================================


@app.post("/gmail/disconnect")
def gmail_disconnect():
    """
    Deletes stored Gmail OAuth credentials locally.
    Does NOT revoke on Google's side (optional), but removes access for our app.
    """
    if GMAIL_TOKEN_PATH.exists():
        try:
            GMAIL_TOKEN_PATH.unlink()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    return {"ok": True}


# =====================================================
# Endpoint: list emails
# =====================================================


@app.get("/emails", response_model=List[Email])
def list_emails(
    status: Optional[EmailStatus] = Query(
        default=None,
        description="Filter by 'auto', 'review', or 'sent'. Leave empty for all.",
    )
):
    """
    Returns a list of stored emails for the dashboard.
    /emails               → all
    /emails?status=auto   → only auto
    /emails?status=review → only review
    /emails?status=sent   → only sent
    """
    db = SessionLocal()
    try:
        query = db.query(EmailORM)
        if status is not None:
            query = query.filter(EmailORM.status == status)
        query = query.order_by(EmailORM.received_at.desc())
        emails = query.all()
        return [orm_to_schema(e) for e in emails]
    finally:
        db.close()


# =====================================================
# Endpoint: update email (advisor actions)
# =====================================================


@app.patch("/emails/{email_id}", response_model=Email)
def update_email(email_id: int, update: EmailUpdate):
    """
    Update an email (e.g., change status from 'review' to 'auto',
    and/or edit the suggested_reply text).
    """
    db = SessionLocal()
    try:
        email_obj = db.query(EmailORM).filter(EmailORM.id == email_id).first()
        if email_obj is None:
            raise HTTPException(status_code=404, detail="Email not found")

        data = update.model_dump(exclude_unset=True)
        
        # Set approved_at timestamp when status changes to auto or sent
        if "status" in data:
            new_status = data["status"]
            if new_status in (EmailStatus.auto, EmailStatus.sent) and email_obj.approved_at is None:
                email_obj.approved_at = datetime.utcnow()
        
        for field, value in data.items():
            setattr(email_obj, field, value)

        db.commit()
        db.refresh(email_obj)
        return orm_to_schema(email_obj)
    finally:
        db.close()


# =====================================================
# Endpoint: delete email
# =====================================================


@app.delete("/emails/{email_id}")
def delete_email(email_id: int):
    """
    Delete an email from the database.
    """
    db = SessionLocal()
    try:
        email_obj = db.query(EmailORM).filter(EmailORM.id == email_id).first()
        if email_obj is None:
            raise HTTPException(status_code=404, detail="Email not found")

        db.delete(email_obj)
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# =====================================================
# Endpoint: respond (playground / dev tool)
# =====================================================


@app.get("/respond")
def respond(
    query: str = Query(..., description="Student's email query"),
    student_name: Optional[str] = None,
):
    """
    Process a student query using the EmailAdvisor backend.
    Returns subject, body, and confidence.

    This is like a playground / test endpoint for manually trying prompts.
    """
    result = advisor.process_query(query, {"student_name": student_name})
    return {
        "subject": result.subject,
        "body": result.body,
        "confidence": result.confidence,
    }

# =====================================================
# Endpoint: metrics (REAL data from DB)
# =====================================================

from zoneinfo import ZoneInfo  # Add this import at top of file (Python 3.9+)
# OR for older Python: from pytz import timezone

@app.get("/metrics")
def metrics():
    """
    Returns real dashboard statistics computed from the database.
    Emails today is calculated based on US Eastern timezone calendar day.
    """
    db = SessionLocal()
    try:
        # Total emails
        total = db.query(func.count(EmailORM.id)).scalar() or 0

        # =====================================================
        # FIXED: Calculate "emails today" based on Eastern Time calendar day
        # This matches what users see in the UI (ET timezone)
        # =====================================================
        eastern = ZoneInfo("America/New_York")
        now_eastern = datetime.now(eastern)
        
        # Start of today in Eastern time
        start_of_today_eastern = now_eastern.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Convert to UTC for database comparison (assuming received_at is stored in UTC)
        start_of_today_utc = start_of_today_eastern.astimezone(ZoneInfo("UTC"))
        
        emails_today = (
            db.query(func.count(EmailORM.id))
            .filter(EmailORM.received_at >= start_of_today_utc)
            .scalar()
            or 0
        )

        # Counts by status
        auto_count = (
            db.query(func.count(EmailORM.id))
            .filter(EmailORM.status == EmailStatus.auto)
            .scalar()
            or 0
        )
        review_count = (
            db.query(func.count(EmailORM.id))
            .filter(EmailORM.status == EmailStatus.review)
            .scalar()
            or 0
        )
        sent_count = (
            db.query(func.count(EmailORM.id))
            .filter(EmailORM.status == EmailStatus.sent)
            .scalar()
            or 0
        )

        # Average confidence for ALL emails
        avg_conf = db.query(func.avg(EmailORM.confidence)).scalar()
        if avg_conf is None:
            avg_conf = 0.0

        # Average confidence for approved (auto) emails only
        avg_auto_conf = (
            db.query(func.avg(EmailORM.confidence))
            .filter(EmailORM.status == EmailStatus.auto)
            .scalar()
        )
        if avg_auto_conf is None:
            avg_auto_conf = 0.0

        return {
            "emails_total": int(total),
            "emails_today": int(emails_today),
            "auto_count": int(auto_count),
            "review_count": int(review_count),
            "sent_count": int(sent_count),
            "avg_confidence": float(avg_conf),
            "avg_auto_confidence": float(avg_auto_conf),
        }
    finally:
        db.close()