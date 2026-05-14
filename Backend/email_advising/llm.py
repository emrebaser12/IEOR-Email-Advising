"""LLM integration for email composition using OpenAI."""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
import openai

# Load .env file if it exists
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

logger = logging.getLogger(__name__)


IEOR_SYSTEM_PROMPT = """You are an academic advisor at Columbia University's IEOR (Industrial Engineering and Operations Research) department. Write professional, concise email replies on behalf of the advisor.

Guidelines:
- Be helpful, accurate, and friendly — conversational but professional
- Keep replies concise and informative; avoid unnecessary filler
- Do not repeat the student's question back to them
- Never make promises about exceptions, waivers, or approvals — direct those to the appropriate person
- Do not speculate on policy — if unsure, say "please check with the registrar or DUS"
- Never share or reference another student's information
- Do not generate any markdown links, URLs, or empty bracket references like [] or [text]() in the body — links are handled separately
- Always close with exactly this sign-off, preceded by a blank line:

Best regards,
IEOR Advising Team"""


def create_openai_llm(
    api_key: str | None = None,
    model: str = "gpt-4o",
    max_tokens: int = 1024,
    system_prompt: str | None = None,
    temperature: float = 0.1,
) -> Callable[[str], str]:
    if api_key is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY not provided and not found in environment variables"
            )

    client = openai.OpenAI(api_key=api_key)
    resolved_system_prompt = system_prompt or IEOR_SYSTEM_PROMPT

    def llm_fn(prompt: str) -> str:
        try:
            response = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                messages=[
                    {"role": "system", "content": resolved_system_prompt},
                    {"role": "user", "content": prompt},
                ],
            )
            return response.choices[0].message.content
        except openai.APIError as e:
            logger.error(f"OpenAI API error: {e}")
            raise

    return llm_fn



__all__ = ["create_openai_llm"]
