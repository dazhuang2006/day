# 按用户指定的时间点，从剧集里切出每位角色的参考片段。
#
# 时间点由用户听辨后提供（哪一段是谁在说话，只有耳朵能判断）。
# 这里负责：解析时间段 -> 从源视频抽音频 -> 按角色归档 -> 质检 -> 输出清单。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\cut_character_clips.py
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
FFMPEG = Path(r"D:\program\GPT-SoVITS-main\ffmpeg.exe")
SRC_VIDEO = Path(r"D:\move\1_小马宝莉_友谊的魔法_第一季_中文配音_04_1080P_高码率_AVC.mp4")
# 分离后的人声轨：做克隆参考时更干净（已去掉背景音乐）
SRC_VOCAL = ROOT / "refs" / "dub" / "vocals" / "ep04_vocals.wav"
OUT = ROOT / "character_clips"

CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}

# 用户给的时间点（分:秒）。保持原始顺序，便于回溯核对。
CLIPS = {
    "twilight": ["2:23-2:26", "4:34-4:35", "4:54-5:03", "7:14-7:20"],
    "rarity":   ["2:30-2:32", "4:25-4:26", "4:32-4:33", "7:48-7:52"],
    "pinkie":   ["4:04-4:07", "4:10-4:11", "4:18-4:21", "4:37-4:38", "5:17-5:20", "5:24-5:30"],
    "rainbow":  ["4:35-4:37", "4:39-4:42", "5:05-5:14"],
    "fluttershy": ["5:39-5:53", "7:01-7:06", "7:08-7:13", "7:16-7:21"],
}


def parse(span: str):
    """'2:23-2:26' -> (143.0, 146.0)"""
    a, b = span.split("-")
    def sec(x):
        parts = x.strip().split(":")
        return int(parts[0]) * 60 + float(parts[1]) if len(parts) == 2 else float(x)
    return sec(a), sec(b)


def transcribe_all():
    """整集转写（带时间戳），用来报告每段切到了什么内容。"""
    p = ROOT / "refs" / "dub" / "full_text.json"
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8-sig"))


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    rows = transcribe_all()
    index = []

    for sp, spans in CLIPS.items():
        d = OUT / f"{sp}_{CN[sp]}"
        d.mkdir(parents=True, exist_ok=True)
        print(f"\n=== {CN[sp]}（{sp}）===")
        for i, span in enumerate(spans, 1):
            start, end = parse(span)
            dur = end - start
            name = f"{sp}_{i:02d}_{span.replace(':', 'm').replace('-', '-')}s.wav"
            dst = d / name
            # 从人声轨切：已去掉伴奏，更适合做克隆参考
            cmd = [
                str(FFMPEG), "-y", "-loglevel", "error",
                "-ss", f"{start}", "-to", f"{end}", "-i", str(SRC_VOCAL),
                "-af", "afade=t=in:st=0:d=0.02,afade=t=out:st=%.2f:d=0.02" % max(0.0, dur - 0.02),
                "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(dst),
            ]
            r = subprocess.run(cmd, capture_output=True)
            if r.returncode != 0:
                print(f"  切失败 {span}: {r.stderr.decode('utf-8', 'ignore')[:120]}")
                continue

            x, sr = sf.read(str(dst), dtype="int16")
            f = x.astype(np.float64) / 32768.0
            peak = float(np.abs(f).max()) if f.size else 0.0
            rms = float(np.sqrt((f ** 2).mean())) if f.size else 0.0

            # 这段切到了哪些台词
            texts = [t["text"] for t in rows if t["end"] > start and t["start"] < end]
            flag = ""
            if dur < 3.0:
                flag = "  ← 短于 3 秒，模型不接受做参考"
            elif peak < 0.02:
                flag = "  ← 几乎无声，可能切空了"
            print(f"  {span:>12}  {dur:5.2f}s  peak={peak:.3f} rms={rms:.4f}{flag}")
            for t in texts:
                print(f"       ↳ {t[:44]}")

            index.append({
                "speaker": sp, "speaker_cn": CN[sp], "span": span,
                "start": start, "end": end, "dur": round(dur, 2),
                "peak": round(peak, 4), "rms": round(rms, 5),
                "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
                "texts": texts,
                "usable_as_reference": bool(3.0 <= dur <= 10.0 and peak >= 0.02),
            })

    (OUT / "clips.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n" + "=" * 70)
    print("汇总：")
    for sp in CLIPS:
        items = [r for r in index if r["speaker"] == sp]
        ok = [r for r in items if r["usable_as_reference"]]
        total = sum(r["dur"] for r in ok)
        print(f"  {CN[sp]:<8} {len(items)} 段，其中可用 {len(ok)} 段，合计 {total:.1f}s")
    print(f"\n输出目录: {OUT}")
    print("提示：模型要求参考音频 3~10 秒；短于 3 秒的需要和相邻片段拼起来。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
