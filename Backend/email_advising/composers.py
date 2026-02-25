"""Email composition helpers, including LLM-backed workflows."""
from __future__ import annotations

import json
import textwrap
from typing import Callable, Dict, Sequence, Tuple

from .models import AdvisorReference, KnowledgeArticle


class EmailComposer:
    """Interface for classes that produce final email subject and body text."""

    def compose(
        self,
        *,
        article: KnowledgeArticle,
        base_subject: str,
        base_body: str,
        query: str,
        metadata: Dict[str, str],
        references: Sequence[AdvisorReference],
    ) -> Tuple[str, str]:  # pragma: no cover - interface method
        raise NotImplementedError


class TemplateEmailComposer(EmailComposer):
    """Default composer that relies on the knowledge base templates."""

    def __init__(self, include_references: bool = True, reference_heading: str = "References") -> None:
        self.include_references = include_references
        self.reference_heading = reference_heading

    def compose(
        self,
        *,
        article: KnowledgeArticle,
        base_subject: str,
        base_body: str,
        query: str,
        metadata: Dict[str, str],
        references: Sequence[AdvisorReference],
    ) -> Tuple[str, str]:
        del article, query, metadata  # unused by template-based composition
        body = base_body.rstrip()
        if self.include_references and references:
            reference_text = self.format_references(references)
            body = body + "\n\n" + reference_text
        return base_subject, body

    def format_references(self, references: Sequence[AdvisorReference]) -> str:
        lines = [self.reference_heading + ":"]
        for index, reference in enumerate(references, start=1):
            url_part = f" ({reference.url})" if reference.url else ""
            snippet_part = f" — {reference.snippet}" if reference.snippet else ""
            lines.append(f"[{index}] {reference.title}{url_part}{snippet_part}")
        return "\n".join(lines)


class LLMEmailComposer(EmailComposer):
    """Compose emails with the help of a Large Language Model (LLM)."""

    def __init__(
        self,
        llm: Callable[[str], str],
        *,
        style: str = "professional",
        fallback_composer: TemplateEmailComposer | None = None,
        ensure_references: bool = True,
    ) -> None:
        self.llm = llm
        self.style = style
        self.fallback_composer = fallback_composer or TemplateEmailComposer()
        self.ensure_references = ensure_references

    def compose(
        self,
        *,
        article: KnowledgeArticle,
        base_subject: str,
        base_body: str,
        query: str,
        metadata: Dict[str, str],
        references: Sequence[AdvisorReference],
    ) -> Tuple[str, str]:
        prompt = self._build_prompt(article, base_subject, base_body, query, metadata, references)
        try:
            raw_response = self.llm(prompt)
        except Exception:
            return self.fallback_composer.compose(
                article=article,
                base_subject=base_subject,
                base_body=base_body,
                query=query,
                metadata=metadata,
                references=references,
            )
        subject, body = self._parse_response(raw_response, base_subject, base_body)
        if self.ensure_references and references:
            reference_text = self.fallback_composer.format_references(references)
            if reference_text not in body:
                body = body.rstrip() + "\n\n" + reference_text
        return subject, body

    def _build_prompt(
        self,
        article: KnowledgeArticle,
        subject: str,
        body: str,
        query: str,
        metadata: Dict[str, str],
        references: Sequence[AdvisorReference],
    ) -> str:
        reference_lines = []
        for index, reference in enumerate(references, start=1):
            url_part = reference.url or "internal resource"
            snippet = reference.snippet or ""
            reference_lines.append(f"[{index}] {reference.title} ({url_part}) - {snippet}")
        reference_block = "\n".join(reference_lines) if reference_lines else "No reference documents matched."
        metadata_lines = "\n".join(f"- {key}: {value}" for key, value in metadata.items()) or "(no additional metadata provided)"
        prompt = textwrap.dedent(
            f"""
            You are an experienced academic advisor. Compose a {self.style} email reply using the guidance below.

            Student question:
            {query}

            Base template (use this as structured guidance, but improve tone and clarity):
            {body}

            Desired email subject: {subject}

            Additional metadata:
            {metadata_lines}

            Supporting references (cite using [number] notation in the body when applicable):
            {reference_block}

            Respond in JSON with keys "subject" and "body" only. Do not include markdown fences.
            """
        ).strip()
        return prompt

    def _parse_response(self, raw: str, fallback_subject: str, fallback_body: str) -> Tuple[str, str]:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return fallback_subject, fallback_body
        subject = str(payload.get("subject", fallback_subject)).strip() or fallback_subject
        body = str(payload.get("body", fallback_body)).strip() or fallback_body
        return subject, body


__all__ = ["EmailComposer", "TemplateEmailComposer", "LLMEmailComposer"]
