#!/usr/bin/env python3
"""Optional, reproducible multilingual embedding retrieval for publication candidates.

Requires: pip install sentence-transformers
The working application does not depend on this optional step; TF-IDF remains the
documented baseline when local inference is unavailable.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
MODEL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
REVISION = "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
BATCH_SIZE = 64
TOP_K = 3
MIN_COSINE = 0.35


def main() -> None:
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as exc:
        raise SystemExit("sentence-transformers is not installed; TF-IDF remains active. Install it explicitly to run this optional adapter.") from exc

    pubs = json.loads((ROOT / "data" / "publications.json").read_text("utf-8"))
    texts = ["\n".join(x for x in [p["title"], p.get("abstract") or "", " · ".join(p.get("keywords", []))] if x) for p in pubs]
    cache = ROOT / ".cache" / f"embeddings-{REVISION[:12]}.npy"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.exists():
        vectors = np.load(cache)
    else:
        model = SentenceTransformer(MODEL, revision=REVISION)
        vectors = model.encode(texts, batch_size=BATCH_SIZE, normalize_embeddings=True, show_progress_bar=True)
        np.save(cache, vectors.astype(np.float32))

    law = [i for i, p in enumerate(pubs) if p["facultyMemberships"] == ["law"]]
    economics = [i for i, p in enumerate(pubs) if p["facultyMemberships"] == ["economics"]]
    pairs = []
    for start in range(0, len(law), 256):
        scores = vectors[law[start:start + 256]].astype(np.float64) @ vectors[economics].astype(np.float64).T
        for row, li in enumerate(law[start:start + 256]):
            take = np.argsort(-scores[row])[:TOP_K]
            for j in take:
                score = float(scores[row, j])
                if score >= MIN_COSINE:
                    pairs.append({"publicationA": pubs[li]["id"], "publicationB": pubs[economics[int(j)]]["id"],
                                  "cosine": round(score, 4)})
    output = {
        "model": MODEL, "revision": REVISION, "license": "Apache-2.0", "dimensions": 384,
        "maxSequenceLength": 128, "preprocessing": "title + edoc abstract + edoc keywords; normalized model embeddings",
        "textCoverage": {"publications": len(pubs), "withAbstract": sum(bool(p.get("abstract")) for p in pubs)},
        "parameters": {"batchSize": BATCH_SIZE, "topKAcrossFaculty": TOP_K, "minimumCosine": MIN_COSINE},
        "warning": "Cosine is a retrieval score, not a probability of useful collaboration.",
        "pairs": sorted(pairs, key=lambda x: (-x["cosine"], x["publicationA"], x["publicationB"])),
    }
    (ROOT / "data" / "semantic-neighbors.json").write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), "utf-8")
    print(f"wrote {len(pairs)} sparse cross-faculty neighbours from {len(pubs)} publications")


if __name__ == "__main__":
    main()
