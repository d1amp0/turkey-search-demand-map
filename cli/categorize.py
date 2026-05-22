"""Coarse category labels via BGE embeddings (cosine nearest category)."""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.spatial import distance
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

from cli.errors import require_df_columns
from cli.translate import translate_org_types

# Same taxonomy as ds/ml/result.ipynb and frontend/src/i18n.ts
CATEGORY_LIST: list[str] = [
    "Agriculture",
    "Automotive, motorcycles and vehicles",
    "Beauty, personal care and wellness",
    "Construction, renovation and interior",
    "Culture, arts and entertainment",
    "Education and training",
    "Finance and professional services",
    "Food and beverages",
    "Government and municipal services",
    "Healthcare and medical services",
    "IT, telecommunications and electronics",
    "Landmarks, addresses and geography",
    "Manufacturing, industry and equipment",
    "Nature, parks and outdoor places",
    "Other and unspecified",
    "Real estate and business properties",
    "Religion and community organizations",
    "Retail and trade",
    "Sports and active recreation",
    "Tourism, lodging and travel",
    "Transportation and logistics",
    "Utilities, security and maintenance services",
]

EMBEDDING_MODEL = "BAAI/bge-large-en-v1.5"
DEFAULT_OTHER = "Other and unspecified"


def assign_categories(
    translated_texts: list[str],
    embedder: SentenceTransformer,
) -> dict[str, str]:
    org_embeddings = embedder.encode(translated_texts, show_progress_bar=True)
    cat_embeddings = embedder.encode(CATEGORY_LIST, show_progress_bar=False)

    en_to_category: dict[str, str] = {}
    for i, en_text in enumerate(translated_texts):
        eb = org_embeddings[i]
        best_ind = 0
        best_dist = 2.0
        for j, cat_emb in enumerate(cat_embeddings):
            current_dist = distance.cosine(eb, cat_emb)
            if current_dist < best_dist:
                best_dist = current_dist
                best_ind = j
        en_to_category[en_text] = CATEGORY_LIST[best_ind]

    return en_to_category


def categorize_dataframe(
    df: pd.DataFrame,
    org_type_column: str = "org_type",
    *,
    translate_batch_size: int = 32,
    device: str = "cpu",
) -> pd.DataFrame:
    """Add org_type_en and category columns."""
    require_df_columns(df, (org_type_column,), "Categorization")

    unique_types = df[org_type_column].dropna().unique().tolist()
    tqdm.write(f"Unique org_type values: {len(unique_types)}")

    tr_to_en = translate_org_types(
        unique_types,
        batch_size=translate_batch_size,
        device=device,
    )

    tqdm.write(f"Loading embedder {EMBEDDING_MODEL}…")
    embedder = SentenceTransformer(EMBEDDING_MODEL)
    en_texts = [tr_to_en[t] for t in unique_types]
    en_to_category = assign_categories(en_texts, embedder)

    def map_translation(raw: object) -> object:
        if pd.isna(raw):
            return np.nan
        return tr_to_en.get(raw, raw)

    def map_category(raw: object) -> object:
        if pd.isna(raw):
            return DEFAULT_OTHER
        en = tr_to_en.get(raw)
        if en is None:
            return DEFAULT_OTHER
        return en_to_category.get(en, DEFAULT_OTHER)

    out = df.copy()
    out["org_type_en"] = out[org_type_column].map(map_translation)
    out["category"] = out[org_type_column].map(map_category)
    return out
