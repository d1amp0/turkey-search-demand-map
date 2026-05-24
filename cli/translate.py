"""Turkish -> English org_type translation via Tencent Hy-MT2."""

from __future__ import annotations

import torch
from tqdm import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer

from cli.errors import die
from cli.hf import hf_token_kwargs

# Hy-MT2 models are instruction-following causal LMs, not seq2seq Marian models.
TRANSLATION_MODEL = "tencent/Hy-MT2-1.8B"
TRANSLATION_PROMPT = (
    "Translate the following Turkish place/category label into natural English. "
    "Translate Turkish words written with plain Latin letters and cognates too. "
    "If the label is already English, return it unchanged. "
    "Output only the translated result without any additional explanation:\n\n{text}"
)


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
    """Return mapping original org_type -> English."""
    tokenizer, model = load_translator(device, model_name)
    result: dict[str, str] = {}

    for start in tqdm(
        range(0, len(org_types), batch_size),
        desc=f"Translate ({model_name})",
        unit="batch",
    ):
        batch = org_types[start : start + batch_size]
        translated = [
            text.strip()
            for text in translate_batch(batch, tokenizer, model, device)
        ]

        if len(translated) != len(batch) or any(not text for text in translated):
            die("Translation batch returned an empty or incomplete result.")

        for original, english in zip(batch, translated):
            result[original] = english

    return result
