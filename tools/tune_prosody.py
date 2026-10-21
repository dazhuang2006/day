# 一次性对比实验：找出台词配音里"最不像人机"的参数组合。
#
# 背景：首版用了 top_k=15 / top_p=1 / temperature=1（偏离模型默认 0.6/0.6，
# 等于把采样放宽），加上参考音频是新闻播报腔，生成结果 F0 起伏被压平 30~40%，
# 听感就是"没有语调"。
#
# 这里对同一批台词、同一个参考音频，跑多组配置，产出到各自子目录，
# 再用 tools/prosody_stats.py 比较 F0 起伏，挑出最好的。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\tune_prosody.py
#
# 只需要听最终选出的一组，不必逐组试听。
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

OUT_BASE = ROOT / "refs" / ".tune"
OUT_BASE.mkdir(parents=True, exist_ok=True)

# 实验用的台词：覆盖陈述句、疑问句、感叹句、带省略号的语气句
LINES = [
    ("陈述", "我们回小屋吧。"),
    ("疑问", "紫悦，我准备得怎么样？"),
    ("感叹", "甜点在这里！我一路小跑过来的，一点都没歪！"),
    ("语气", "唔……还差一点时间。"),
    ("长句", "认识她这么久……其实有好多话，一直没有认真说过。"),
]

# 要对比的配置。name -> get_tts_wav 的关键参数
CONFIGS = {
    "A_chosen_last_time": dict(top_k=15, top_p=1.0, temperature=1.0),
    "B_model_default": dict(top_k=20, top_p=0.6, temperature=0.6),
    "C_low_temp_wide_p": dict(top_k=20, top_p=0.9, temperature=0.5),
    "D_very_low_temp": dict(top_k=10, top_p=0.85, temperature=0.3),
    "E_high_temp": dict(top_k=30, top_p=0.95, temperature=1.2),
}


def load_ref():
    refs = json.loads((ROOT / "voice_refs.json").read_text(encoding="utf-8-sig"))
    spk = refs["speakers"]["starberry"]
    raw = Path(spk["ref_audio"])
    path = raw if raw.is_absolute() else ROOT / raw
    return path, spk["ref_text"]


def main() -> int:
    import torch  # noqa: F401
    from GPT_SoVITS.inference_webui import (
        change_gpt_weights,
        change_sovits_weights,
        get_tts_wav,
    )

    ref_path, ref_text = load_ref()
    print(f"参考音频: {ref_path}  ({ref_path.stat().st_size / 1024:.0f} KB)")
    print(f"参考文本: {ref_text}")

    change_gpt_weights(gpt_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"))
    change_sovits_weights(
        sovits_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth")
    )

    summary = {}
    for name, params in CONFIGS.items():
        d = OUT_BASE / name
        d.mkdir(parents=True, exist_ok=True)
        t0 = time.time()
        for i, (kind, text) in enumerate(LINES):
            try:
                res = list(
                    get_tts_wav(
                        ref_wav_path=str(ref_path),
                        prompt_text=ref_text,
                        prompt_language="中文",
                        text=text,
                        text_language="中文",
                        speed=1,
                        use_cuda_graph=False,
                        use_flash_attention=False,
                        **params,
                    )
                )
                sr, audio = res[-1]
                arr = np.asarray(audio)
                if arr.dtype != np.int16:
                    arr = (np.clip(arr.astype(np.float64), -1, 1) * 32767).astype(np.int16)
                sf.write(str(d / f"{i}_{kind}.wav"), arr, sr)
            except Exception as e:
                print(f"  {name}/{kind} 失败: {type(e).__name__}: {e}")
        summary[name] = round(time.time() - t0, 1)
        print(f"{name:<22} 完成 5 条  {summary[name]}s  -> {d}")

    print()
    print("下一步比较语调起伏：")
    print(f'  C:\\Users\\23201\\.conda\\envs\\GPTSoVits\\python.exe tools\\prosody_stats.py "{OUT_BASE}"')
    return 0


if __name__ == "__main__":
    sys.exit(main())
