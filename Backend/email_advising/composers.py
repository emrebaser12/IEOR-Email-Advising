"""Email composition helpers, including LLM-backed workflows."""
from __future__ import annotations

import json
import logging
import textwrap
from typing import Callable, Dict, Sequence, Tuple

from .models import AdvisorReference, KnowledgeArticle

logger = logging.getLogger(__name__)


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
        links = [r for r in references if r.url]
        if links:
            body = body + "\n\n" + self._format_links(links)
        return base_subject, body

    @staticmethod
    def _format_links(references: Sequence[AdvisorReference]) -> str:
        lines = ["Useful resources:"]
        for ref in references:
            lines.append(f"• {ref.title}: {ref.url}")
        return "\n".join(lines)


class LLMGenerativeComposer(EmailComposer):
    """Generate emails from scratch using an LLM, without relying on templates."""

    def __init__(
        self,
        llm: Callable[[str], str],
        style: str = "professional",
        fallback_composer: TemplateEmailComposer | None = None,
    ) -> None:
        self.llm = llm
        self.style = style
        self.fallback_composer = fallback_composer or TemplateEmailComposer()

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
        prompt = self._build_prompt(article, query, metadata, references)
        try:
            raw_response = self.llm(prompt)
        except Exception as e:
            logger.error("LLM call failed, falling back to template: %s", e)
            return self.fallback_composer.compose(
                article=article,
                base_subject=base_subject,
                base_body=base_body,
                query=query,
                metadata=metadata,
                references=references,
            )
        subject, body = self._parse_response(raw_response, base_subject, base_body)
        links = [r for r in references if r.url]
        if links:
            body = body.rstrip() + "\n\n" + TemplateEmailComposer._format_links(links)
        return subject, body

    def _build_prompt(
        self,
        article: KnowledgeArticle,
        query: str,
        metadata: Dict[str, str],
        references: Sequence[AdvisorReference],
    ) -> str:
        metadata = dict(metadata)
        conversation_history = metadata.pop("_conversation_history", None)

        reference_lines = []
        for index, reference in enumerate(references, start=1):
            url_part = reference.url or "internal resource"
            snippet = reference.snippet or ""
            reference_lines.append(f"[{index}] {reference.title} ({url_part}) - {snippet}")
        reference_block = "\n".join(reference_lines) if reference_lines else "No reference documents matched."

        metadata_lines = "\n".join(f"- {key}: {value}" for key, value in metadata.items()) or "(no additional metadata provided)"

        kb_context = f"""
Knowledge Base Article:
- Category: {", ".join(article.categories)}
- Topic: {article.subject}
- Examples the student might ask: {", ".join(article.utterances)}
- Key details to mention:
{article.response_template}
"""

        history_section = ""
        if conversation_history:
            history_section = f"""
Previous conversation (for context only — do NOT reply to this, use it to avoid repeating information already given):
{conversation_history}

"""

        prompt = textwrap.dedent(
            f"""
            You are an experienced academic advisor. A student has sent a message, and you have relevant knowledge base information to craft a response.
            {history_section}
            Student's latest message (reply to this):
            {query}

            Relevant Knowledge Base Article:
            {kb_context}

            Student Information:
            {metadata_lines}

            Supporting References (cite these using [number] notation in your response):
            {reference_block}

            Write a {self.style} email response addressing only the student's latest message above. Be helpful, warm, and specific. Include relevant details from the knowledge base article. Do not include a references or links section — links will be shown separately in the UI.

            Always end the body with exactly this sign-off on its own lines, preceded by a blank line:

            Best regards,
            Academic Advising Team

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
        metadata = dict(metadata)
        conversation_history = metadata.pop("_conversation_history", None)

        metadata_lines = "\n".join(f"- {key}: {value}" for key, value in metadata.items()) or "(no additional metadata provided)"

        history_section = ""
        if conversation_history:
            history_section = f"""
Previous conversation (for context only — do NOT reply to this, use it to avoid repeating information already given):
{conversation_history}

"""

        prompt = textwrap.dedent(
            f"""
            You are an experienced academic advisor. Compose a {self.style} email reply using the guidance below.
            {history_section}
            Student's latest message (reply to this):
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


__all__ = ["EmailComposer", "TemplateEmailComposer", "LLMGenerativeComposer", "LLMEmailComposer"]
