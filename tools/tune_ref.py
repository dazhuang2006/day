# 直接对比：给定几条参考音频（文件+逐字文本），看生成结果的语调起伏。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\tune_ref.py <ref1.wav> <ref2.wav> ...
# 文本从各自的 candidates.json 里按文件名查找，保证逐字精确。
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SOVITS = Path(r"D:\program\GPT-SoVITS-main")
sys.path.insert(0, str(SOVITS))
os.chdir(SOVITS)

OUT = ROOT / "refs" / ".tune_ref"
OUT.mkdir(parents=True, exist_ok=True)

LINES = ["我们回小屋吧。", "紫悦，我准备得怎么样？", "甜点在这里！我一路小跑过来的，一点都没歪！"]


def find_transcript(wav: Path):
    """在附近的 candidates.json 里按文件名找逐字文本。"""
    for cand in wav.parent.glob("candidates.json"):
        recs = json.loads(cand.read_text(encoding="utf-8-sig"))
        for r in recs:
            if Path(r["file"]).name == wav.name:
                return r["text"], r
    return "", {}


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print("用法: tune_ref.py <参考音频.wav> [更多...]")
        return 1

    from GPT_SoVITS.inference_webui import (
        change_gpt_weights,
        change_sovits_weights,
        get_tts_wav,
    )

    refs = []
    for a in args:
        p = Path(a)
        if not p.is_absolute():
            p = (ROOT / a).resolve()
        if not p.exists():
            print(f"找不到 {p}")
            continue
        text, meta = find_transcript(p)
        if not text:
            print(f"{p.name}: 查不到逐字文本，跳过（ref_text 必须精确）")
            continue
        refs.append((p, text, f"{meta.get('age','')}/{meta.get('accent','')}"))
    if not refs:
        return 1

    change_gpt_weights(gpt_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"))
    change_sovits_weights(
        sovits_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth")
    )

    for p, text, tag in refs:
        d = OUT / p.stem
        d.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        for i, line in enumerate(LINES):
            res = list(
                get_tts_wav(
                    ref_wav_path=str(p), prompt_text=text, prompt_language="中文",
                    text=line, text_language="中文", speed=1,
                    use_cuda_graph=False, use_flash_attention=False,
                )
            )
            sr, audio = res[-1]
            arr = np.asarray(audio)
            if arr.dtype != np.int16:
                arr = (np.clip(arr.astype(np.float64), -1, 1) * 32767).astype(np.int16)
            sf.write(str(d / f"{i}.wav"), arr, sr)
        print(f"{p.stem:<28}{tag:<12}{time.time() - t0:.1f}s")

    print(f"\n结果: {OUT}")
    print("比较：")
    print(f'  C:\\Users\\23201\\.conda\\envs\\GPTSoVits\\python.exe tools\\prosody_stats.py "{OUT}"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
