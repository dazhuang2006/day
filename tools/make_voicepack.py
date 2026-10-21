# 为一位角色生成完整语音包（游戏里该角色全部台词），交付给用户自行处理。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\make_voicepack.py applejack
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
SOVITS = Path(r"D:\program\GPT-SoVITS-main")
sys.path.insert(0, str(SOVITS))
os.chdir(SOVITS)

# 目前唯一可用的本集参考音频（3~10 秒限制内）
REFS = {
    "applejack": (ROOT / "refs" / "dub" / "segs" / "seg003.wav",
                  "是最值得信赖的小马可你只是一匹小马而已你一匹小马要对付几百颗品牌"),
}


def register_cuda_dlls():
    lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
    if lib.exists():
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
        os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")


def normalize(audio, target_peak=0.89):
    a = np.asarray(audio, dtype=np.float64)
    peak = float(np.abs(a).max()) if a.size else 0.0
    if peak > 1e-6:
        a = a * (target_peak / peak)
    return a


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("speaker")
    args = ap.parse_args()
    sp = args.speaker
    if sp not in REFS:
        print(f"还没有 {sp} 的参考音频")
        return 1
    ref_path, ref_text = REFS[sp]
    if not ref_path.exists():
        print(f"参考音频不存在: {ref_path}")
        return 1

    manifest = json.loads((ROOT / "voice_manifest.json").read_text(encoding="utf-8-sig"))
    lines = [l for l in manifest["lines"] if l["speaker"] == sp]
    out_dir = ROOT / "refs" / "voicepack" / sp
    out_dir.mkdir(parents=True, exist_ok=True)

    register_cuda_dlls()
    from GPT_SoVITS.inference_webui import (
        change_gpt_weights, change_sovits_weights, get_tts_wav,
    )
    import lameenc

    change_gpt_weights(gpt_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"))
    change_sovits_weights(
        sovits_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth")
    )

    print(f"角色 {sp}：{len(lines)} 条台词")
    print(f"参考音频 {ref_path.name}  文本「{ref_text}」")

    index = []
    for i, l in enumerate(lines, 1):
        text = l["text"]
        if text.startswith("（"):
            text = text.split("）", 1)[-1] if "）" in text else text
        t0 = time.time()
        res = list(get_tts_wav(
            ref_wav_path=str(ref_path), prompt_text=ref_text, prompt_language="中文",
            text=text, text_language="中文", speed=1,
            use_cuda_graph=False, use_flash_attention=False,
        ))
        sr, audio = res[-1]
        arr = np.asarray(audio)
        if arr.dtype != np.int16:
            arr = np.clip(arr.astype(np.float64), -1, 1) * 32767
        arr = normalize(arr.astype(np.float64)).round().clip(-32768, 32767).astype("<i2")

        sf.write(str(out_dir / f"{l['id']}.wav"), arr, sr)
        enc = lameenc.Encoder()
        enc.set_bit_rate(160)
        enc.set_in_sample_rate(int(sr))
        enc.set_channels(1)
        enc.set_quality(2)
        (out_dir / f"{l['id']}.mp3").write_bytes(
            bytes(enc.encode(np.ascontiguousarray(arr).tobytes())) + bytes(enc.flush())
        )
        index.append({"id": l["id"], "text": text, "dur": round(len(arr) / sr, 2)})
        print(f"[{i}/{len(lines)}] {len(arr) / sr:.1f}s  {time.time() - t0:.1f}s  {text}")

    (out_dir / "index.json").write_text(
        json.dumps({"speaker": sp, "reference": {"file": str(ref_path), "text": ref_text},
                    "lines": index}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n共 {len(index)} 条 -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
