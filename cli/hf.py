"""Hugging Face authentication helpers."""

from __future__ import annotations

import os

from dotenv import load_dotenv


load_dotenv()


def get_hf_token() -> str | None:
    """Return a configured Hugging Face token, if present."""
    return (
        os.getenv("HF_TOKEN")
        or os.getenv("HUGGING_FACE_HUB_TOKEN")
        or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    )


def hf_token_kwargs() -> dict[str, str]:
    token = get_hf_token()
    return {"token": token} if token else {}
