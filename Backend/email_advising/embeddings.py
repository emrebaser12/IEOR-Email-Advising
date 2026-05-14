"""Sentence embedding utilities for semantic similarity scoring."""
from __future__ import annotations

from typing import List, Sequence

import numpy as np


class SentenceEmbedder:
    """Wraps OpenAI's text-embedding-3-small to embed utterances and queries.

    Embeddings are L2-normalized so cosine similarity reduces to a dot product.
    The OpenAI client is initialized lazily on first use.

    Usage::

        embedder = SentenceEmbedder()
        corpus_embs = embedder.encode(utterances)        # (N, D) float32
        query_emb   = embedder.encode([query])[0]        # (D,) float32
        sims        = embedder.similarities(query_emb, corpus_embs)  # (N,) float32
    """

    _BATCH_SIZE = 100  # stay well within OpenAI's 2048-input limit

    def __init__(self, model_name: str = "text-embedding-3-small") -> None:
        self.model_name = model_name
        self._client = None

    def _get_client(self):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI()
        return self._client

    def encode(self, sentences: Sequence[str]) -> np.ndarray:
        """Return L2-normalized embeddings, shape (len(sentences), D)."""
        client = self._get_client()
        sentences = list(sentences)
        all_embeddings: List[List[float]] = []
        for i in range(0, len(sentences), self._BATCH_SIZE):
            batch = sentences[i : i + self._BATCH_SIZE]
            response = client.embeddings.create(model=self.model_name, input=batch)
            batch_embeddings = [
                item.embedding
                for item in sorted(response.data, key=lambda x: x.index)
            ]
            all_embeddings.extend(batch_embeddings)
        arr = np.array(all_embeddings, dtype=np.float32)
        norms = np.linalg.norm(arr, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        return arr / norms

    def similarities(
        self, query_embedding: np.ndarray, corpus_embeddings: np.ndarray
    ) -> np.ndarray:
        """Cosine similarities between one query and every corpus embedding."""
        return (corpus_embeddings @ query_embedding).astype(np.float64)


__all__ = ["SentenceEmbedder"]
