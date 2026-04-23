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


def create_openai_llm(
    api_key: str | None = None,
    model: str = "gpt-4o",
    max_tokens: int = 1024,
) -> Callable[[str], str]:
    """Create an OpenAI-based LLM function for email composition.

    Args:
        api_key: OpenAI API key. If None, reads from OPENAI_API_KEY env var.
        model: OpenAI model to use.
        max_tokens: Maximum tokens in the response.

    Returns:
        A callable that takes a prompt string and returns the model's response.
    """
    if api_key is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY not provided and not found in environment variables"
            )

    client = openai.OpenAI(api_key=api_key)

    def llm_fn(prompt: str) -> str:
        """Call OpenAI with the given prompt and return the response."""
        try:
            response = client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
            return response.choices[0].message.content
        except openai.APIError as e:
            logger.error(f"OpenAI API error: {e}")
            raise

    return llm_fn



__all__ = ["create_openai_llm"]
