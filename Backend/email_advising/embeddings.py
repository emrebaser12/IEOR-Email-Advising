"""Sentence embedding utilities for semantic similarity scoring."""
from __future__ import annotations

from typing import List, Sequence

import numpy as np


class SentenceEmbedder:
    """Wraps a sentence-transformers model to embed utterances and queries.

    Embeddings are L2-normalized so cosine similarity reduces to a dot product.
    The model is loaded lazily on first use to avoid slowing down imports.

    Usage::

        embedder = SentenceEmbedder()                    # default: all-MiniLM-L6-v2
        corpus_embs = embedder.encode(utterances)        # (N, D) float32
        query_emb   = embedder.encode([query])[0]        # (D,) float32
        sims        = embedder.similarities(query_emb, corpus_embs)  # (N,) float32
    """

    def __init__(self, model_name: str = "multi-qa-MiniLM-L6-cos-v1") -> None:
        self.model_name = model_name
        self._model = None  # lazy-load

    def _load(self) -> None:
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # type: ignore
            self._model = SentenceTransformer(self.model_name)

    def encode(self, sentences: Sequence[str]) -> np.ndarray:
        """Return L2-normalized embeddings, shape (len(sentences), D)."""
        self._load()
        return self._model.encode(  # type: ignore[union-attr]
            list(sentences),
            normalize_embeddings=True,
            show_progress_bar=False,
        )

    def similarities(self, query_embedding: np.ndarray, corpus_embeddings: np.ndarray) -> np.ndarray:
        """Cosine similarities between one query and every corpus embedding.

        Both inputs must be L2-normalized (as produced by ``encode``).
        Returns a 1-D array of shape (len(corpus_embeddings),) with values in [-1, 1].
        """
        return (corpus_embeddings @ query_embedding).astype(np.float64)


__all__ = ["SentenceEmbedder"]
