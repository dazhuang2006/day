# 试听把关：用本集配音里最像苹果嘉儿的两段做参考，生成几句游戏真实台词。
#
# 目的：在投入"再找几集原声"之前，先让用户听听克隆效果到底够不够。
# 参考文本用 whisper 转写后人工可核对。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\audition.py
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

OUT = ROOT / "refs" / "audition"
OUT.mkdir(parents=True, exist_ok=True)

# 从用户标注里挑的：音高最低、最像苹果嘉儿本音的两段
REFS = [
    ROOT / "refs" / "dub" / "segs" / "seg003.wav",
    ROOT / "refs" / "dub" / "segs" / "seg021.wav",
]

# 游戏里苹果嘉儿的真实台词（取自 voice_manifest.json）
TEST_LINES = [
    "嘿，你可算来了。",
    "材料是我一样一样挑的，五样，一样都不能少。",
    "时间不早啦，去小屋看看吧。",
    "包得真好看。珍奇那双手，啥都包得漂亮。",
    "甜点也完成了。",
]


def register_cuda_dlls():
    lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
    if lib.exists():
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
        os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")


def transcribe_refs(refs):
    register_cuda_dlls()
    from faster_whisper import WhisperModel

    # 用 medium：small 会把"最值得信赖"转成"最值得性来"这类同音错字，
    # 而 ref_text 错一个字就会拖累克隆质量（参考文本要和音频逐字对应）。
    print("转写参考音频（ref_text 必须逐字对应，用 medium 提高准确度）…")
    try:
        model = WhisperModel("medium", device="cuda", compute_type="float16")
    except Exception as e:
        print(f"medium 加载失败（{type(e).__name__}），回退 small")
        model = WhisperModel("small", device="cuda", compute_type="float16")
    out = []
    for p in refs:
        segs, _ = model.transcribe(str(p), language="zh", beam_size=5, vad_filter=False)
        text = "".join(s.text for s in segs).strip()
        out.append((p, text))
        print(f"  {p.name}: {text}")
    return out, model


def normalize(audio, target_peak=0.89):
    """把音频归一化到目标峰值。

    踩过的坑：GPT-SoVITS 生成出来的电平比参考音频低 6~8 倍
    （参考 RMS 0.038，生成只有 0.005），直接试听会以为"没声音"。
    统一抬到接近满幅，既好比较也不会削波。
    """
    a = np.asarray(audio, dtype=np.float64)
    peak = float(np.abs(a).max()) if a.size else 0.0
    if peak > 1e-6:
        a = a * (target_peak / peak)
    return a


def main() -> int:
    # 模型硬要求参考音频在 3~10 秒之间。seg021 只有 2.62s，会被直接拒绝，
    # 所以这里先过滤掉，避免跑到一半才报错。
    usable = []
    for p in REFS:
        if not p.exists():
            print(f"缺参考音频: {p}")
            continue
        dur = sf.info(str(p)).duration
        if dur < 3.0 or dur > 10.0:
            print(f"跳过 {p.name}：时长 {dur:.2f}s 不在模型要求的 3~10s 内")
            continue
        usable.append(p)
    if not usable:
        print("没有可用的参考音频（需要 3~10 秒）")
        return 1
    print(f"可用参考音频 {len(usable)} 条: " + ", ".join(p.name for p in usable))

    refs, whisper = transcribe_refs(usable)

    from GPT_SoVITS.inference_webui import (
        change_gpt_weights, change_sovits_weights, get_tts_wav,
    )

    change_gpt_weights(gpt_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"))
    change_sovits_weights(
        sovits_path=str(SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth")
    )

    import lameenc

    made = []
    for ri, (ref_path, ref_text) in enumerate(refs):
        for li, line in enumerate(TEST_LINES):
            t0 = time.time()
            res = list(get_tts_wav(
                ref_wav_path=str(ref_path), prompt_text=ref_text, prompt_language="中文",
                text=line, text_language="中文", speed=1,
                use_cuda_graph=False, use_flash_attention=False,
            ))
            sr, audio = res[-1]
            arr = np.asarray(audio)
            if arr.dtype != np.int16:
                arr = (np.clip(arr.astype(np.float64), -1, 1) * 32767)
            arr = normalize(arr.astype(np.float64)).round().clip(-32768, 32767).astype("<i2")
            # 同时留 wav（便于分析）和 mp3（便于试听）
            name = f"ref{ri + 1}_{li + 1:02d}"
            sf.write(str(OUT / f"{name}.wav"), arr, sr)
            enc = lameenc.Encoder()
            enc.set_bit_rate(160)
            enc.set_in_sample_rate(int(sr))
            enc.set_channels(1)
            enc.set_quality(2)
            (OUT / f"{name}.mp3").write_bytes(
                bytes(enc.encode(np.ascontiguousarray(arr).tobytes())) + bytes(enc.flush())
            )
            made.append({"name": name, "ref": ref_path.name, "line": line,
                         "dur": round(len(arr) / sr, 2)})
            print(f"[参考{ri + 1} 第{li + 1}句] {len(arr) / sr:.1f}s  {time.time() - t0:.1f}s  {line}")

    (OUT / "audition.json").write_text(
        json.dumps({"refs": [{"file": str(p), "text": t} for p, t in refs], "made": made},
                   ensure_ascii=False, indent=1), encoding="utf-8")

    # 参考音频本身也复制一份，方便对比"原声 vs 克隆"
    for i, (p, _t) in enumerate(refs, 1):
        sf.write(str(OUT / f"reference{i}_original.wav"), sf.read(str(p))[0], sf.read(str(p))[1])

    print(f"\n共生成 {len(made)} 条 -> {OUT}")
    print("建议对比听：reference1_original.wav 是原声，ref1_*.mp3 是用它克隆出来的")
    return 0


if __name__ == "__main__":
    sys.exit(main())
