# 把切好的"单句"片段按角色合并成参考音频，并生成几句游戏台词试听。
#
# 这一步是把 17:00 那段柔柔/苹果嘉儿真正的对话用起来：
# 参考音频只由目标角色自己的句子组成，不混进另一个人的声音。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\make_fluttershy_reference.py
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

SENT_DIR = ROOT / "character_clips" / "sentences"
OUT = ROOT / "character_clips" / "refs_v2"
OUT.mkdir(parents=True, exist_ok=True)

TARGET_MAX = 9.5
GAP = 0.22

# 试听用的游戏台词（柔柔在游戏里的话）
DEMO = {
    "fluttershy": [
        "你、你今天要采花吗？我帮你吧……",
        "三朵就够了哦。多了，收花的人会不好意思的。",
        "（小声）她一定会喜欢的……",
    ],
    "applejack": [
        "嘿，你可算来了。",
        "时间不早啦，去小屋看看吧。",
    ],
}


def register_cuda_dlls():
    lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
    if lib.exists():
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
        os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")


def normalize(a, target_peak=0.85):
    a = np.asarray(a, dtype=np.float64)
    p = float(np.abs(a).max()) if a.size else 0.0
    return a * (target_peak / p) if p > 1e-6 else a


def build_ref(sp):
    """把该角色的句子按时间顺序拼成一条参考音频（不超过 9.5 秒）。"""
    items = json.loads((SENT_DIR / "sentences.json").read_text(encoding="utf-8-sig"))
    items = [i for i in items if i["speaker"] == sp]
    items.sort(key=lambda x: x["start"])
    parts, texts, total = [], [], 0.0
    for it in items:
        p = ROOT / it["file"]
        d, sr = sf.read(str(p), dtype="float32")
        if d.ndim > 1:
            d = d.mean(axis=1)
        dur = len(d) / sr
        if total + dur > TARGET_MAX and parts:
            break
        parts.append(normalize(d))
        texts.append(it["text"])
        total += dur + GAP
        parts.append(np.zeros(int(sr * GAP), dtype="float32"))
    merged = np.concatenate(parts[:-1])  # 去掉末尾那段静音
    dst = OUT / f"{sp}.wav"
    sf.write(str(dst), merged, sr)
    return dst, "，".join(texts), len(merged) / sr


def trim_silence(a: np.ndarray, sr: int, thresh_db: float = -45.0, keep: float = 0.15):
    """掐掉首尾长静音。

    偶尔模型会吐出一大段静音：例如 15 个字的台词生成了 13.3 秒音频，
    掐掉首尾后才回到正常长度。保留 keep 秒尾巴，避免收尾被切得太干。
    """
    if a.size == 0:
        return a
    win = max(1, int(sr * 0.02))
    n = len(a) // win * win
    frames = a[:n].reshape(-1, win)
    db = 20 * np.log10(np.maximum(np.abs(frames).max(axis=1), 1e-7))
    loud = np.where(db > thresh_db)[0]
    if len(loud) == 0:
        return a
    a0 = max(0, loud[0] * win - int(sr * 0.05))
    a1 = min(len(a), loud[-1] * win + int(sr * keep))
    return a[a0:a1]


def main() -> int:
    register_cuda_dlls()
    from GPT_SoVITS.inference_webui import (
        change_gpt_weights, change_sovits_weights, get_tts_wav,
    )
    import lameenc

    refs = {}
    for sp in ("fluttershy", "applejack"):
        path, text, dur = build_ref(sp)
        refs[sp] = (path, text)
        print(f"{sp}: 参考音频 {dur:.1f}s -> {path.name}")
        print(f"   参考文本: {text}")

    change_gpt_weights(gpt_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"))
    change_sovits_weights(
        sovits_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth")
    )

    made = []
    for sp, lines in DEMO.items():
        ref_path, ref_text = refs[sp]
        for i, line in enumerate(lines, 1):
            t0 = time.time()
            res = list(get_tts_wav(
                ref_wav_path=str(ref_path), prompt_text=ref_text, prompt_language="中文",
                text=line, text_language="中文", speed=1,
                use_cuda_graph=False, use_flash_attention=False,
            ))
            sr, audio = res[-1]
            raw = np.asarray(audio)
            if raw.dtype == np.int16:
                # 模型输出本来就是 int16（例如 ±16000），只需整体抬到接近满幅。
                # 注意 normalize() 返回的是 0~1 的浮点，**必须再乘 32767 才能转 int16**；
                # 直接 astype("<i2") 会把所有样本截断成 0（生成一堆静音）。
                arr = (normalize(raw.astype(np.float64), 29100.0)
                       .round().clip(-32768, 32767).astype("<i2"))
            else:
                # 浮点输出按 [-1,1] 约定处理，同样先规整峰值再落回 int16
                f = np.clip(raw.astype(np.float64), -1, 1) * 32767.0
                arr = (normalize(f, 29100.0)
                       .round().clip(-32768, 32767).astype("<i2"))
            before = len(arr) / sr
            arr = trim_silence(arr.astype(np.float64), sr)
            arr = arr.round().clip(-32768, 32767).astype("<i2")
            after = len(arr) / sr
            if before - after > 0.8:
                print(f"     （掐掉首尾静音 {before - after:.1f}s：{before:.1f}s -> {after:.1f}s）")
            name = f"{sp}_{i:02d}"
            sf.write(str(OUT / f"{name}.wav"), arr, sr)
            enc = lameenc.Encoder()
            enc.set_bit_rate(160)
            enc.set_in_sample_rate(int(sr))
            enc.set_channels(1)
            enc.set_quality(2)
            (OUT / f"{name}.mp3").write_bytes(
                bytes(enc.encode(np.ascontiguousarray(arr).tobytes())) + bytes(enc.flush()))
            made.append({"speaker": sp, "line": line, "dur": round(len(arr) / sr, 2), "file": name})
            print(f"  [{sp} {i}/{len(lines)}] {len(arr) / sr:.1f}s  {time.time() - t0:.1f}s  {line}")

    (OUT / "demo.json").write_text(json.dumps(
        {"references": {k: {"file": str(v[0]), "text": v[1]} for k, v in refs.items()},
         "made": made}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n试听文件 -> {OUT}")
    print("对比听：fluttershy.wav / applejack.wav 是参考音频（真人原声）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
