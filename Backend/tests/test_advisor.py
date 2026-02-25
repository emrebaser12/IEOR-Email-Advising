import json
from pathlib import Path
import sys

import pytest

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from email_advising import (
    EmailAdvisor,
    LLMEmailComposer,
    TfidfRetriever,
    load_knowledge_base,
    load_reference_corpus,
)


@pytest.fixture(scope="module")
def knowledge_base():
    data_path = PROJECT_ROOT / "data" / "knowledge_base.json"
    return load_knowledge_base(data_path)


@pytest.fixture(scope="module")
def reference_corpus():
    corpus_path = PROJECT_ROOT / "data" / "reference_corpus.json"
    return load_reference_corpus(corpus_path)


@pytest.fixture(scope="module")
def advisor(knowledge_base, reference_corpus) -> EmailAdvisor:
    return EmailAdvisor(knowledge_base, retriever=TfidfRetriever(reference_corpus))


@pytest.fixture()
def llm_advisor(knowledge_base, reference_corpus) -> EmailAdvisor:
    def fake_llm(prompt: str) -> str:
        return json.dumps(
            {
                "subject": "LLM Transcript Guidance",
                "body": "Hello! Here is how to order your transcript. [1]",
            }
        )

    composer = LLMEmailComposer(fake_llm)
    return EmailAdvisor(
        knowledge_base,
        retriever=TfidfRetriever(reference_corpus),
        composer=composer,
    )


def test_rankings_sorted(advisor: EmailAdvisor) -> None:
    matches = advisor.rank_articles("I would like to know how to request an official transcript")
    confidences = [match.confidence for match in matches]
    assert confidences == sorted(confidences, reverse=True)


def test_auto_send_for_direct_match(advisor: EmailAdvisor) -> None:
    metadata = {"student_name": "Alex"}
    response = advisor.process_query("How do I order my transcript?", metadata)
    assert response.auto_send is True
    assert response.article_id == "transcript_request"
    assert response.confidence >= 0.95
    assert "Official Transcript" in response.subject
    assert response.references
    assert "References:" in response.body
    assert any("transcript" in ref.snippet.lower() for ref in response.references)


def test_unknown_question_requires_review(advisor: EmailAdvisor) -> None:
    response = advisor.process_query("I would like help planning a study abroad semester.")
    assert response.auto_send is False
    assert response.article_id is None
    assert response.decision == "needs_review"
    assert any("review" in reason.lower() for reason in response.reasons)


def test_follow_up_questions_present(advisor: EmailAdvisor) -> None:
    response = advisor.process_query(
        "I might need to withdraw from a course due to personal reasons",
        {"student_name": "Jordan", "term": "Fall 2024", "withdrawal_deadline": "October 21"},
    )
    assert response.article_id == "course_withdrawal"
    assert response.follow_up_questions
    assert any("draft" in reason.lower() for reason in response.reasons)
    assert response.references
    assert any("withdraw" in ref.snippet.lower() for ref in response.references)


def test_llm_composer_generates_email(llm_advisor: EmailAdvisor) -> None:
    response = llm_advisor.process_query(
        "Need instructions for an official transcript",
        {"student_name": "Morgan"},
    )
    assert response.subject == "LLM Transcript Guidance"
    assert "Hello!" in response.body
    assert "References:" in response.body
    assert response.references
    assert "[1]" in response.body


def test_synonym_expansion_improves_withdrawal_match(advisor: EmailAdvisor) -> None:
    matches = advisor.rank_articles("I need to remove a course from my schedule.")
    assert matches
    assert matches[0].article_id == "course_withdrawal"


def test_metadata_extraction_autofills_placeholders(advisor: EmailAdvisor) -> None:
    response = advisor.process_query(
        "Hi, my name is Taylor. I need to remove a course for Fall 2024 before October 21.",
        {},
    )
    assert response.article_id == "course_withdrawal"
    assert "Taylor" in response.body
    assert "Fall 2024" in response.body
    assert "October 21" in response.body
    assert any("Taylor" in reason for reason in response.reasons)


def test_ambiguous_queries_require_review(advisor: EmailAdvisor) -> None:
    response = advisor.process_query(
        "Can you help me register for classes and request an official transcript?",
        {"student_name": "Jamie"},
    )
    assert response.auto_send is False
    assert response.article_id is None
    assert any("Multiple templates" in reason for reason in response.reasons)
