"""Email Advising System package."""
from .advisor import EmailAdvisor
from .composers import LLMGenerativeComposer, LLMEmailComposer, TemplateEmailComposer
from .embeddings import SentenceEmbedder
from .knowledge_base import KnowledgeBase, KnowledgeArticle, load_knowledge_base
from .models import (
    AdvisorReference,
    AdvisorResponse,
    ConfidenceSettings,
    RankedMatch,
    ReferenceCorpus,
    ReferenceDocument,
)

from .rag import TfidfRetriever, load_reference_corpus
from .metadata import MetadataExtractor
from .personal_guardrails import PersonalEmailDetector, GuardrailResult
from .llm import create_openai_llm

__all__ = [
    "AdvisorReference",
    "AdvisorResponse",
    "ConfidenceSettings",
    "LLMGenerativeComposer",
    "EmailAdvisor",
    "GuardrailResult",
    "KnowledgeArticle",
    "KnowledgeBase",
    "LLMEmailComposer",
    "MetadataExtractor",
    "PersonalEmailDetector",
    "RankedMatch",
    "ReferenceCorpus",
    "ReferenceDocument",
    "SentenceEmbedder",
    "TfidfRetriever",
    "TemplateEmailComposer",
    "create_openai_llm",
    "load_knowledge_base",
    "load_reference_corpus",
]
