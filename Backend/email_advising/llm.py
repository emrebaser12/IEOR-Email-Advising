"""LLM integration for email composition using Claude."""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
import anthropic

# Load .env file if it exists
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

logger = logging.getLogger(__name__)


def create_claude_llm(
    api_key: str | None = None,
    model: str = "claude-opus-4-1",
    max_tokens: int = 1024,
) -> Callable[[str], str]:
    """Create a Claude-based LLM function for email composition.
    
    Args:
        api_key: Anthropic API key. If None, reads from ANTHROPIC_API_KEY env var.
        model: Claude model to use.
        max_tokens: Maximum tokens in the response.
    
    Returns:
        A callable that takes a prompt string and returns Claude's response.
    """
    if api_key is None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY not provided and not found in environment variables"
            )
    
    client = anthropic.Anthropic(api_key=api_key)
    
    def llm_fn(prompt: str) -> str:
        """Call Claude with the given prompt and return the response."""
        try:
            message = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {
                        "role": "user",
                        "content": prompt,
                    }
                ],
            )
            return message.content[0].text
        except anthropic.APIError as e:
            logger.error(f"Claude API error: {e}")
            raise
    
    return llm_fn


__all__ = ["create_claude_llm"]
