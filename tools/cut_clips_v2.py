# 按修正后的时间点切角色片段（只切片段，不做任何声音生成）。
#
# 修正内容：用户给的分钟数里 17 被我误读成 7（例如"17分48秒"切成了 7:48），
# 导致紫悦/珍奇/柔柔有 5 段切错位置。这里按修正后的时间重切。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\cut_clips_v2.py
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
FFMPEG = Path(r"D:\program\GPT-SoVITS-main\ffmpeg.exe")
SRC = ROOT / "refs" / "dub" / "vocals" / "ep04_vocals.wav"
OUT = ROOT / "character_clips_v2"
FULL_TEXT = ROOT / "refs" / "dub" / "full_text.json"

CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}

# 修正后的时间点（分:秒-分:秒）
# 紫悦第 4 段经用户确认是 7:14-7:20（我一度按 17:14-17:20 改错了，已回退）
CLIPS = {
    "twilight":   ["2:23-2:26", "4:34-4:35", "4:54-5:03", "7:14-7:20"],
    "rarity":     ["2:30-2:32", "4:25-4:26", "4:32-4:33", "17:48-17:52"],
    "pinkie":     ["4:04-4:07", "4:10-4:11", "4:18-4:21", "4:37-4:38",
                   "5:17-5:20", "5:24-5:30"],
    "rainbow":    ["4:35-4:37", "4:39-4:42", "5:05-5:14"],
    "fluttershy": ["5:39-5:53", "17:01-17:06", "17:08-17:13", "17:16-17:21",
                   "17:48-17:52"],
}

# ASR 的同音错字，报告时纠回来
FIX = {"苹果佳儿": "苹果嘉儿", "佳儿": "嘉儿", "紫月": "紫悦"}


def parse(span: str):
    a, b = span.split("-")
    def sec(x):
        p = x.strip().split(":")
        return int(p[0]) * 60 + float(p[1]) if len(p) == 2 else float(x)
    return sec(a), sec(b)


def main() -> int:
    rows = json.loads(FULL_TEXT.read_text(encoding="utf-8-sig"))
    index = []

    for sp, spans in CLIPS.items():
        d = OUT / f"{sp}_{CN[sp]}"
        d.mkdir(parents=True, exist_ok=True)
        print(f"\n{'=' * 80}\n{CN[sp]}（{sp}）\n{'=' * 80}")
        for i, span in enumerate(spans, 1):
            start, end = parse(span)
            dur = end - start
            name = f"{sp}_{i:02d}_{span.replace(':', 'm')}.wav"
            dst = d / name
            subprocess.run([
                str(FFMPEG), "-y", "-loglevel", "error",
                "-ss", f"{start}", "-to", f"{end}", "-i", str(SRC),
                "-af", f"afade=t=in:st=0:d=0.02,afade=t=out:st={max(0.0, dur - 0.02):.2f}:d=0.02",
                "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(dst),
            ], check=False)

            if not dst.exists():
                print(f"  {span:>14}  切失败")
                continue
            x, sr = sf.read(str(dst), dtype="int16")
            f = x.astype(np.float64) / 32768.0
            peak = float(np.abs(f).max())
            rms = float(np.sqrt((f ** 2).mean()))

            texts = []
            for t in rows:
                if t["end"] > start and t["start"] < end:
                    s = t["text"]
                    for k, v in FIX.items():
                        s = s.replace(k, v)
                    texts.append(s)

            flag = ""
            if dur < 3.0:
                flag = "  ← 不足 3 秒"
            elif peak < 0.02:
                flag = "  ← 近乎无声"
            print(f"  {span:>14}  {dur:5.2f}s  peak={peak:.3f} rms={rms:.4f}{flag}")
            for t in texts:
                print(f"        「{t}」")

            index.append({
                "speaker": sp, "speaker_cn": CN[sp], "span": span,
                "start": start, "end": end, "dur": round(dur, 2),
                "peak": round(peak, 4), "rms": round(rms, 5),
                "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
                "texts": texts,
            })

    (OUT / "clips.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{'=' * 80}\n汇总\n{'=' * 80}")
    for sp in CLIPS:
        items = [r for r in index if r["speaker"] == sp]
        ok = [r for r in items if r["dur"] >= 3.0 and r["peak"] >= 0.02]
        print(f"  {CN[sp]:<8} {len(items)} 段，可用(≥3秒) {len(ok)} 段，"
              f"可用合计 {sum(r['dur'] for r in ok):.1f}s")
    print(f"\n输出: {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
