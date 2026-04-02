from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

import nltk
import numpy as np
from scipy.spatial.distance import jensenshannon
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_distances

BASE_DIR = Path(__file__).resolve().parent.parent
NLTK_DATA_DIR = BASE_DIR / ".nltk_data"
SENTENCE_BREAK_RE = re.compile(r"(?<=[.!?])\s+")
TEXT_CLEAN_RE = re.compile(r"[^A-Za-z0-9'.,;:!?\-\s]")
PRESIDENT_NAMES = {
    "Bush": "George H. W. Bush",
    "Carter": "Jimmy Carter",
    "Clinton": "Bill Clinton",
    "Eisenhower": "Dwight D. Eisenhower",
    "Ford": "Gerald Ford",
    "GWBush": "George W. Bush",
    "Johnson": "Lyndon B. Johnson",
    "Kennedy": "John F. Kennedy",
    "Nixon": "Richard Nixon",
    "Obama": "Barack Obama",
    "Reagan": "Ronald Reagan",
    "Roosevelt": "Franklin D. Roosevelt",
    "Truman": "Harry S. Truman",
}


def _round(value: float, digits: int = 4) -> float:
    return round(float(value), digits)


def _ensure_corpus() -> None:
    NLTK_DATA_DIR.mkdir(exist_ok=True)
    if str(NLTK_DATA_DIR) not in nltk.data.path:
        nltk.data.path.insert(0, str(NLTK_DATA_DIR))
    nltk.download("state_union", download_dir=str(NLTK_DATA_DIR), quiet=True)


def _normalize_president(slug: str) -> str:
    key = slug.replace(".txt", "")
    return PRESIDENT_NAMES.get(key, key)


def _clean_text(text: str) -> str:
    compact = re.sub(r"\s+", " ", text.replace("\n", " ")).strip()
    compact = TEXT_CLEAN_RE.sub("", compact)
    return compact


def _split_into_segments(text: str, window_size: int = 4) -> list[str]:
    sentences = []
    for sentence in SENTENCE_BREAK_RE.split(text):
        cleaned = _clean_text(sentence)
        if len(cleaned.split()) >= 8:
            sentences.append(cleaned)

    segments = []
    for start in range(0, len(sentences), window_size):
        chunk = " ".join(sentences[start : start + window_size]).strip()
        if 30 <= len(chunk.split()) <= 140:
            segments.append(chunk)
    return segments


def _load_segments() -> tuple[list[dict], list[str]]:
    _ensure_corpus()
    from nltk.corpus import state_union

    fileids = sorted(state_union.fileids())
    segments: list[dict] = []

    for speech_index, file_id in enumerate(fileids):
        year_text, president_text = file_id.replace(".txt", "").split("-", maxsplit=1)
        year = int(year_text)
        president = _normalize_president(president_text)
        speech_text = state_union.raw(file_id)
        speech_segments = _split_into_segments(speech_text)

        for segment_index, segment in enumerate(speech_segments):
            segments.append(
                {
                    "id": f"{year}-{segment_index}",
                    "speech_id": speech_index,
                    "year": year,
                    "president": president,
                    "text": segment,
                }
            )

    return segments, fileids


def _build_cluster_labels(tfidf_matrix, labels: np.ndarray, vectorizer: TfidfVectorizer) -> list[dict]:
    terms = np.array(vectorizer.get_feature_names_out())
    summaries = []
    label_values = sorted({int(label) for label in labels.tolist()})

    for cluster_id in label_values:
        indices = np.where(labels == cluster_id)[0]
        mean_weights = np.asarray(tfidf_matrix[indices].mean(axis=0)).ravel()
        top_indices = mean_weights.argsort()[-6:][::-1]
        top_terms = [str(terms[index]) for index in top_indices if mean_weights[index] > 0][:5]
        summaries.append(
            {
                "cluster_id": cluster_id,
                "label": " / ".join(top_terms[:2]) if top_terms else f"Cluster {cluster_id}",
                "keywords": top_terms,
                "size": int(len(indices)),
            }
        )

    return summaries


def _top_terms_for_indices(tfidf_matrix, indices: list[int], vectorizer: TfidfVectorizer, limit: int = 4) -> list[str]:
    if not indices:
        return []

    terms = np.array(vectorizer.get_feature_names_out())
    mean_weights = np.asarray(tfidf_matrix[indices].mean(axis=0)).ravel()
    order = mean_weights.argsort()[-limit:][::-1]
    return [str(terms[index]) for index in order if mean_weights[index] > 0][:limit]


def _cluster_changes(previous: np.ndarray, current: np.ndarray, cluster_summaries: list[dict]) -> list[dict]:
    delta = current - previous
    top_indices = np.argsort(np.abs(delta))[-2:][::-1]
    by_cluster_id = {item["cluster_id"]: item for item in cluster_summaries}
    changes = []

    for index in top_indices.tolist():
        summary = by_cluster_id[index]
        changes.append(
            {
                "cluster_id": int(index),
                "label": summary["label"],
                "delta": _round(delta[index], 3),
            }
        )

    return changes


@lru_cache(maxsize=1)
def get_analysis_bundle() -> dict:
    segments, fileids = _load_segments()
    texts = [item["text"] for item in segments]

    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=2, max_df=0.75)
    tfidf_matrix = vectorizer.fit_transform(texts)

    max_components = min(40, tfidf_matrix.shape[0] - 1, tfidf_matrix.shape[1] - 1)
    component_count = max(2, max_components)
    reducer = TruncatedSVD(n_components=component_count, n_iter=12, random_state=42)
    reduced = reducer.fit_transform(tfidf_matrix)

    n_clusters = max(4, min(8, round(math.sqrt(len(segments) / 28))))
    clusterer = KMeans(n_clusters=n_clusters, n_init=10, random_state=42)
    labels = clusterer.fit_predict(reduced)

    cluster_summaries = _build_cluster_labels(tfidf_matrix, labels, vectorizer)
    cluster_lookup = {item["cluster_id"]: item for item in cluster_summaries}

    years = sorted({item["year"] for item in segments})
    year_indices: dict[int, list[int]] = defaultdict(list)
    year_cluster_counts: dict[int, Counter] = defaultdict(Counter)

    for index, segment in enumerate(segments):
        cluster_id = int(labels[index])
        segment["cluster_id"] = cluster_id
        segment["cluster_label"] = cluster_lookup[cluster_id]["label"]
        segment["x"] = _round(reduced[index][0])
        segment["y"] = _round(reduced[index][1] if reduced.shape[1] > 1 else 0.0)
        year = int(segment["year"])
        year_indices[year].append(index)
        year_cluster_counts[year][cluster_id] += 1

    yearly_rows = []
    yearly_distributions = []
    centroids = []

    for year in years:
        indices = year_indices[year]
        counts = [int(year_cluster_counts[year][cluster_id]) for cluster_id in range(n_clusters)]
        total = sum(counts)
        shares = np.array([count / total for count in counts], dtype=float)
        yearly_distributions.append(shares)
        centroids.append(reduced[indices].mean(axis=0))
        yearly_rows.append(
            {
                "year": year,
                "president": segments[indices[0]]["president"],
                "segment_count": int(total),
                "top_terms": _top_terms_for_indices(tfidf_matrix, indices, vectorizer),
                "cluster_counts": counts,
                "cluster_shares": [_round(share, 4) for share in shares.tolist()],
            }
        )

    drift_events = []
    drift_scores = []

    for index in range(1, len(yearly_rows)):
        previous_distribution = yearly_distributions[index - 1]
        current_distribution = yearly_distributions[index]
        drift_score = _round(jensenshannon(previous_distribution, current_distribution))
        semantic_shift = _round(cosine_distances([centroids[index - 1]], [centroids[index]])[0][0])
        yearly_rows[index]["drift_score"] = drift_score
        yearly_rows[index]["semantic_shift"] = semantic_shift
        drift_scores.append(drift_score)

        drift_events.append(
            {
                "from_year": yearly_rows[index - 1]["year"],
                "to_year": yearly_rows[index]["year"],
                "drift_score": drift_score,
                "semantic_shift": semantic_shift,
                "emerging_terms": yearly_rows[index]["top_terms"][:3],
                "leading_changes": _cluster_changes(previous_distribution, current_distribution, cluster_summaries),
            }
        )

    if yearly_rows:
        yearly_rows[0]["drift_score"] = None
        yearly_rows[0]["semantic_shift"] = None

    drift_events.sort(key=lambda item: item["drift_score"], reverse=True)
    top_event = drift_events[0] if drift_events else None

    cluster_peaks = {}
    for cluster_id in range(n_clusters):
        peak_row = max(yearly_rows, key=lambda row: row["cluster_shares"][cluster_id])
        cluster_peaks[cluster_id] = {
            "peak_year": peak_row["year"],
            "peak_share": peak_row["cluster_shares"][cluster_id],
        }

    for summary in cluster_summaries:
        peak = cluster_peaks[summary["cluster_id"]]
        summary["peak_year"] = peak["peak_year"]
        summary["peak_share"] = peak["peak_share"]

    presidents = sorted({item["president"] for item in segments})
    dashboard = {
        "dataset": {
            "name": "NLTK State of the Union Corpus",
            "description": "Current demonstration dataset: State of the Union addresses segmented into multi-sentence windows for concept drift analysis.",
            "source": "https://www.nltk.org/book/ch02.html",
            "speech_count": len(fileids),
            "segment_count": len(segments),
            "year_range": [years[0], years[-1]],
            "president_count": len(presidents),
        },
        "overview": {
            "avg_drift": _round(np.mean(drift_scores)) if drift_scores else 0.0,
            "max_drift": top_event["drift_score"] if top_event else 0.0,
            "max_drift_year": top_event["to_year"] if top_event else None,
            "cluster_count": n_clusters,
        },
        "clusters": cluster_summaries,
        "timeline": yearly_rows,
        "top_drift_events": drift_events[:6],
        "landscape": [
            {
                "id": item["id"],
                "year": item["year"],
                "president": item["president"],
                "cluster_id": item["cluster_id"],
                "cluster_label": item["cluster_label"],
                "x": item["x"],
                "y": item["y"],
                "excerpt": item["text"][:220],
            }
            for item in segments
        ],
    }

    return {"dashboard": dashboard, "segments": segments}


def get_dashboard_data() -> dict:
    return get_analysis_bundle()["dashboard"]


def get_segment_samples(year: int | None = None, cluster: int | None = None, limit: int = 12) -> list[dict]:
    segments = get_analysis_bundle()["segments"]
    filtered = []

    for item in segments:
        if year is not None and item["year"] != year:
            continue
        if cluster is not None and item["cluster_id"] != cluster:
            continue
        filtered.append(
            {
                "id": item["id"],
                "year": item["year"],
                "president": item["president"],
                "cluster_id": item["cluster_id"],
                "cluster_label": item["cluster_label"],
                "text": item["text"],
            }
        )

    filtered.sort(key=lambda item: (item["year"], item["cluster_id"], item["id"]))
    return filtered[:limit]