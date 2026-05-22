"""Turkish -> English org_type translation via Tencent Hy-MT2."""

from __future__ import annotations

import torch
from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer

from cli.errors import die
from cli.hf import hf_token_kwargs

# Hy-MT2 models are instruction-following causal LMs, not seq2seq Marian models.
TRANSLATION_MODEL = "tencent/Hy-MT2-1.8B"
TURKISH_CHARS = frozenset("ğüşıöçĞÜŞİÖÇ")
TRANSLATION_PROMPT = (
    "Translate the following text from Turkish into English. "
    "Note that you should only output the translated result without any additional explanation:\n\n{text}"
)


def looks_turkish(text: str) -> bool:
    return any(char in TURKISH_CHARS for char in text)


def load_translator(
    device: str,
    model_name: str = TRANSLATION_MODEL,
) -> tuple[AutoTokenizer, AutoModelForCausalLM]:
    token_kwargs = hf_token_kwargs()
    tokenizer = AutoTokenizer.from_pretrained(
        model_name,
        trust_remote_code=True,
        **token_kwargs,
    )
    tokenizer.padding_side = "left"
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model_kwargs = {"trust_remote_code": True, **token_kwargs}
    if device == "cuda":
        model_kwargs["torch_dtype"] = torch.bfloat16
    model = AutoModelForCausalLM.from_pretrained(model_name, **model_kwargs).to(device)
    model.eval()
    return tokenizer, model


def translate_batch(
    texts: list[str],
    tokenizer: AutoTokenizer,
    model: AutoModelForCausalLM,
    device: str,
    max_length: int = 128,
) -> list[str]:
    prompts = [TRANSLATION_PROMPT.format(text=text) for text in texts]
    messages = [[{"role": "user", "content": prompt}] for prompt in prompts]
    encoded = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=max_length,
        return_dict=True,
    ).to(device)
    prompt_length = encoded["input_ids"].shape[-1]
    with torch.no_grad():
        generated = model.generate(
            **encoded,
            max_new_tokens=max_length,
            do_sample=False,
            repetition_penalty=1.05,
        )
    decoded = generated[:, prompt_length:]
    return tokenizer.batch_decode(decoded, skip_special_tokens=True)


def translate_org_types(
    org_types: list[str],
    *,
    batch_size: int,
    device: str,
    model_name: str = TRANSLATION_MODEL,
) -> dict[str, str]:
    """Return mapping original org_type -> English (pass-through if not Turkish)."""
    tokenizer, model = load_translator(device, model_name)
    result: dict[str, str] = {}

    for start in tqdm(
        range(0, len(org_types), batch_size),
        desc=f"Translate ({model_name})",
        unit="batch",
    ):
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
