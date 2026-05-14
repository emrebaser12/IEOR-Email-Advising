"""Command line interface for the Email Advising System."""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict

from .advisor import EmailAdvisor
from .knowledge_base import load_knowledge_base
from .models import AdvisorResponse, ConfidenceSettings
from .rag import TfidfRetriever, load_reference_corpus


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate advising email responses")
    parser.add_argument("--query", required=True, help="Student email body text")
    parser.add_argument("--student-name", dest="student_name", help="Student name")
    parser.add_argument("--student-id", dest="student_id", help="Student ID")
    parser.add_argument("--term", help="Academic term referenced in the question")
    parser.add_argument(
        "--registration-deadline",
        dest="registration_deadline",
        help="Registration deadline to mention in the response",
    )
    parser.add_argument(
        "--withdrawal-deadline",
        dest="withdrawal_deadline",
        help="Withdrawal deadline to mention in the response",
    )
    parser.add_argument(
        "--financial-aid-phone",
        dest="financial_aid_phone",
        help="Financial aid office phone number",
    )
    parser.add_argument(
        "--financial-aid-email",
        dest="financial_aid_email",
        help="Financial aid office email",
    )
    parser.add_argument(
        "--knowledge-base",
        dest="knowledge_base",
        help="Path to a custom knowledge base JSON file",
    )
    parser.add_argument(
        "--auto-threshold",
        type=float,
        dest="auto_threshold",
        help="Override the auto-send confidence threshold",
    )
    parser.add_argument(
        "--review-threshold",
        type=float,
        dest="review_threshold",
        help="Override the review confidence threshold",
    )
    parser.add_argument(
        "--format",
        choices=["text", "json"],
        default="text",
        help="Output format",
    )
    parser.add_argument(
        "--reference-corpus",
        dest="reference_corpus",
        help="Path to a JSON file containing supporting documents for retrieval.",
    )
    parser.add_argument(
        "--max-references",
        dest="max_references",
        type=int,
        default=3,
        help="Maximum number of references to attach to the response (default: 3).",
    )
    parser.add_argument(
        "--disable-references",
        action="store_true",
        help="Disable retrieval of supporting references.",
    )
    return parser


def _build_confidence_settings(args: argparse.Namespace) -> ConfidenceSettings:
    if args.auto_threshold is None and args.review_threshold is None:
        return ConfidenceSettings()
    auto = args.auto_threshold if args.auto_threshold is not None else ConfidenceSettings().auto_send_threshold
    review = args.review_threshold if args.review_threshold is not None else ConfidenceSettings().review_threshold
    return ConfidenceSettings(auto_send_threshold=auto, review_threshold=review)


def _collect_metadata(args: argparse.Namespace) -> Dict[str, str]:
    metadata: Dict[str, str] = {}
    for field in [
        "student_name",
        "student_id",
        "term",
        "registration_deadline",
        "withdrawal_deadline",
        "financial_aid_phone",
        "financial_aid_email",
    ]:
        value = getattr(args, field)
        if value:
            metadata[field] = value
    return metadata


def _response_to_dict(response: AdvisorResponse) -> Dict[str, Any]:
    payload = {
        "subject": response.subject,
        "body": response.body,
        "auto_send": response.auto_send,
        "confidence": response.confidence,
        "decision": response.decision,
        "article_id": response.article_id,
        "follow_up_questions": response.follow_up_questions,
        "reasons": response.reasons,
        "matches": [
            {"article_id": match.article_id, "subject": match.subject, "confidence": match.confidence}
            for match in response.ranked_matches
        ],
        "references": [
            {
                "document_id": reference.document_id,
                "title": reference.title,
                "url": reference.url,
                "snippet": reference.snippet,
                "score": reference.score,
            }
            for reference in response.references
        ],
    }
    return payload


def format_text_response(response: AdvisorResponse) -> str:
    status = "AUTO-SEND" if response.auto_send else "REQUIRES REVIEW"
    header = [f"Decision: {status} (confidence {response.confidence:.2f})"]
    if response.article_id:
        header.append(f"Matched article: {response.article_id}")
    header.append(f"Subject: {response.subject}")
    body = "\n".join(header)
    detail_lines = ["", "Body:", response.body, "", "Reasons:"]
    detail_lines.extend(f"- {reason}" for reason in response.reasons)
    if response.follow_up_questions:
        detail_lines.append("")
        detail_lines.append("Follow-up prompts for advisors:")
        detail_lines.extend(f"- {item}" for item in response.follow_up_questions)
    if response.references:
        detail_lines.append("")
        detail_lines.append("References:")
        for idx, reference in enumerate(response.references, start=1):
            line = f"[{idx}] {reference.title}"
            if reference.url:
                line += f" ({reference.url})"
            line += f" — support score {reference.score:.2f}"
            detail_lines.append(line)
            if reference.snippet:
                detail_lines.append(f"    {reference.snippet}")
    detail_lines.append("")
    detail_lines.append("Top matches:")
    for match in response.ranked_matches[:3]:
        detail_lines.append(
            f"- {match.subject} (ID: {match.article_id}, confidence {match.confidence:.2f})"
        )
    return body + "\n" + "\n".join(detail_lines)


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    knowledge_base = load_knowledge_base(args.knowledge_base)
    confidence = _build_confidence_settings(args)
    retriever = None
    reference_limit = args.max_references if args.max_references is not None else 3
    if not args.disable_references:
        try:
            corpus = load_reference_corpus(args.reference_corpus)
        except FileNotFoundError as exc:
            if args.reference_corpus:
                raise
            print(f"Warning: {exc}. Continuing without references.", file=sys.stderr)
        else:
            retriever = TfidfRetriever(corpus)
    advisor = EmailAdvisor(
        knowledge_base,
        confidence_settings=confidence,
        retriever=retriever,
        reference_limit=reference_limit,
    )
    metadata = _collect_metadata(args)
    response = advisor.process_query(args.query, metadata)
    if args.format == "json":
        print(json.dumps(_response_to_dict(response), indent=2))
    else:
        print(format_text_response(response))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
