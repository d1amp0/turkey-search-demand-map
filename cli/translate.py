"""Turkish → English org_type translation via Hugging Face MarianMT."""

from __future__ import annotations

from tqdm import tqdm
from transformers import MarianMTModel, MarianTokenizer

from cli.errors import die

# Example / placeholder model — not state-of-the-art for TR→EN; swap for production use.
TRANSLATION_MODEL = "Helsinki-NLP/opus-mt-tr-en"
TURKISH_CHARS = frozenset("ğüşıöçĞÜŞİÖÇ")


def looks_turkish(text: str) -> bool:
    return any(char in TURKISH_CHARS for char in text)


def load_translator(device: str) -> tuple[MarianTokenizer, MarianMTModel]:
    tokenizer = MarianTokenizer.from_pretrained(TRANSLATION_MODEL)
    model = MarianMTModel.from_pretrained(TRANSLATION_MODEL).to(device)
    model.eval()
    return tokenizer, model


def translate_batch(
    texts: list[str],
    tokenizer: MarianTokenizer,
    model: MarianMTModel,
    device: str,
    max_length: int = 128,
) -> list[str]:
    encoded = tokenizer(
        texts,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=max_length,
    ).to(device)
    generated = model.generate(**encoded, max_length=max_length)
    return tokenizer.batch_decode(generated, skip_special_tokens=True)


def translate_org_types(
    org_types: list[str],
    *,
    batch_size: int,
    device: str,
) -> dict[str, str]:
    """Return mapping original org_type → English (pass-through if not Turkish)."""
    tokenizer, model = load_translator(device)
    result: dict[str, str] = {}

    for start in tqdm(range(0, len(org_types), batch_size), desc="Translate (HF)", unit="batch"):
        batch = org_types[start : start + batch_size]
        to_translate: list[str] = []
        to_translate_idx: list[int] = []
        batch_out: list[str | None] = [None] * len(batch)

        for i, text in enumerate(batch):
            if looks_turkish(text):
                to_translate.append(text)
                to_translate_idx.append(i)
            else:
                batch_out[i] = text

        if to_translate:
            mt_out = translate_batch(to_translate, tokenizer, model, device)
            for i, en in zip(to_translate_idx, mt_out):
                batch_out[i] = en.strip()

        if any(item is None for item in batch_out):
            die("Translation batch left some strings untranslated.")

        for original, english in zip(batch, batch_out):
            result[original] = english  # type: ignore[index]

    return result
