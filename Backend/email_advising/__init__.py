"""Email Advising System package."""
from .advisor import EmailAdvisor
from .composers import LLMEmailComposer, TemplateEmailComposer
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

__all__ = [
    "AdvisorReference",
    "AdvisorResponse",
    "ConfidenceSettings",
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
    "TfidfRetriever",
    "TemplateEmailComposer",
    "load_knowledge_base",
    "load_reference_corpus",
]
