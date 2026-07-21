"""
Shared heuristics for matching uploaded module images to interactive video slides.

This keeps the pipeline lightweight while still preferring semantically relevant
images over the first image in the database list.
"""
from __future__ import annotations

import difflib
import re
from typing import Any, Dict, Iterable, List, Optional


STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how",
    "in", "is", "it", "of", "on", "or", "our", "the", "this", "that", "to",
    "was", "we", "what", "when", "where", "which", "with", "you", "your",
    "about", "into", "over", "under", "through", "using", "use", "used",
}

def normalize_text(text: str) -> str:
    text = (text or "").lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def tokenize(text: str) -> List[str]:
    tokens = []
    for token in normalize_text(text).split():
        if len(token) < 3:
            continue
        if token in STOPWORDS:
            continue
        tokens.append(token)
    return tokens


def build_slide_query(
    title: str = "",
    bullets: Optional[Iterable[str]] = None,
    key_takeaway: str = "",
    slide_text: str = "",
    prompt: str = "",
) -> str:
    parts: List[str] = [title or "", key_takeaway or "", slide_text or "", prompt or ""]
    if bullets:
        parts.extend([b for b in bullets if b])
    return normalize_text(" ".join(parts))


def resolve_image_url(candidate: Any) -> str:
    if isinstance(candidate, str):
        return candidate
    if not isinstance(candidate, dict):
        return ""

    for key in ("url", "image_url", "public_url", "signed_url"):
        value = candidate.get(key)
        if value:
            return str(value)

    return ""


def candidate_text(candidate: Any) -> str:
    if not isinstance(candidate, dict):
        return ""

    parts = [
        candidate.get("caption", ""),
        candidate.get("surrounding_text", ""),
        candidate.get("ocr_text", ""),
        candidate.get("alt_text", ""),
        candidate.get("title", ""),
        candidate.get("description", ""),
    ]
    return normalize_text(" ".join(str(part) for part in parts if part))


def score_candidate(query: str, candidate: Any) -> float:
    query = normalize_text(query)
    if not query:
        return 0.0

    candidate_url = resolve_image_url(candidate)
    candidate_body = candidate_text(candidate)

    if not candidate_body:
        # If the image has no semantic metadata, keep a very small score so we
        # can still use it as a last-resort fallback.
        return 0.05 if candidate_url else 0.0

    query_tokens = tokenize(query)
    candidate_tokens = tokenize(candidate_body)
    if not query_tokens or not candidate_tokens:
        return 0.05 if candidate_url else 0.0

    query_token_set = set(query_tokens)
    candidate_token_set = set(candidate_tokens)
    overlap = len(query_token_set & candidate_token_set) / max(1, len(query_token_set))
    coverage = len(query_token_set & candidate_token_set) / max(1, len(candidate_token_set))
    seq_ratio = difflib.SequenceMatcher(None, query, candidate_body).ratio()

    phrase_bonus = 0.0
    for phrase in _important_phrases(query):
        if phrase and phrase in candidate_body:
            phrase_bonus += 0.15

    score = (0.40 * overlap) + (0.18 * coverage) + (0.28 * seq_ratio) + phrase_bonus
    return round(min(score, 1.0), 4)


def rank_candidates(query: str, candidates: Iterable[Any]) -> List[Dict[str, Any]]:
    ranked: List[Dict[str, Any]] = []
    for candidate in candidates:
        ranked.append(
            {
                "candidate": candidate,
                "url": resolve_image_url(candidate),
                "match_score": score_candidate(query, candidate),
                "match_text": candidate_text(candidate),
            }
        )

    ranked.sort(key=lambda item: item["match_score"], reverse=True)
    return ranked


def select_best_candidate(
    query: str,
    candidates: Iterable[Any],
    threshold: float = 0.28,
) -> Optional[Dict[str, Any]]:
    ranked = rank_candidates(query, candidates)
    if not ranked:
        return None

    best = ranked[0]
    if best["match_score"] < threshold:
        return None
    return best


def _important_phrases(query: str) -> List[str]:
    tokens = [token for token in tokenize(query) if token not in {"slide", "lesson", "video", "image"}]
    if not tokens:
        return []

    phrases: List[str] = []
    if len(tokens) >= 2:
        phrases.extend([
            " ".join(tokens[:2]),
            " ".join(tokens[-2:]),
        ])
    phrases.append(" ".join(tokens[: min(4, len(tokens))]))
    # Deduplicate while preserving order.
    deduped: List[str] = []
    seen = set()
    for phrase in phrases:
        if phrase and phrase not in seen:
            seen.add(phrase)
            deduped.append(phrase)
    return deduped
