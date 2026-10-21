# 参考音频筛选：从一堆音频里挑出适合做 GPT-SoVITS 参考的片段。
#
# 为什么需要：零样本克隆对参考音频很挑——混响、背景音乐、人声忽大忽小都会把音色带偏。
# 这个脚本只做客观指标测量（响度一致性、静音占比、削波、时长），替你排掉明显不行的，
# 但"像不像角色"只能靠你的耳朵。
#
# 用法：
#   python tools/ref_screen.py <目录或文件> [--json 报告路径]
#
# 依赖：numpy + soundfile（本机 D:\python\python.exe 已装）。
#       mp3/flac 等非 wav 格式会先用 GPT-SoVITS 自带的 ffmpeg 转成临时 wav 再分析。
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf

FFMPEG = Path(r"D:\program\GPT-SoVITS-main\ffmpeg.exe")
AUDIO_EXT = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac", ".wma"}

# 判定阈值
MIN_OK_DUR = 3.0      # 低于 3 秒：参考太短，音色不稳
MAX_OK_DUR = 15.0     # 高于 15 秒：不是不行，但容易把别的语气也学走
GOOD_DUR = (5.0, 10.0)  # 官方推荐区间
SILENCE_DB = -45.0    # 低于这个电平算静音
MAX_SILENCE_RATIO = 0.35   # 静音占比过高说明有长空白（或根本不是人声）


def load_audio(path: Path, tmp: Path):
    """统一读成 float32 单声道 + 采样率。非 wav 先经 ffmpeg 转 16k 单声道 wav。"""
    if path.suffix.lower() == ".wav":
        try:
            data, sr = sf.read(str(path), dtype="float32", always_2d=True)
            return data, sr
        except Exception:
            pass  # 有些 wav 编码奇怪，落到 ffmpeg

    if not FFMPEG.exists():
        raise RuntimeError(f"需要 ffmpeg 转码但找不到: {FFMPEG}")
    out = tmp / (path.stem + "_asr.wav")
    cmd = [str(FFMPEG), "-y", "-loglevel", "error", "-i", str(path),
           "-ac", "1", "-ar", "16000", str(out)]
    subprocess.run(cmd, check=True)
    data, sr = sf.read(str(out), dtype="float32", always_2d=True)
    return data, sr


def analyse(path: Path, tmp: Path) -> dict:
    rec = {"file": str(path), "ok": False, "reasons": []}
    try:
        data, sr = load_audio(path, tmp)
    except Exception as e:
        rec["reasons"].append(f"读不了: {type(e).__name__}")
        return rec

    mono = data.mean(axis=1) if data.ndim > 1 else data
    dur = len(mono) / sr
    peak = float(np.abs(mono).max()) if len(mono) else 0.0
    rms = float(np.sqrt(np.mean(mono ** 2))) if len(mono) else 0.0
    rec.update({
        "ok": True, "sr": sr, "channels": data.shape[1] if data.ndim > 1 else 1,
        "duration": round(dur, 2), "peak": round(peak, 4), "rms": round(rms, 5),
    })

    # 静音占比
    if len(mono):
        win = max(1, int(sr * 0.05))
        frames = mono[: len(mono) // win * win].reshape(-1, win)
        db = 20 * np.log10(np.maximum(np.abs(frames).max(axis=1), 1e-7))
        rec["silence_ratio"] = round(float((db < SILENCE_DB).mean()), 3)
    else:
        rec["silence_ratio"] = 1.0

    # 分段响度一致性：把非静音部分切成 4 段比 RMS，差异大 = 忽大忽小/混响重
    segs = [s for s in np.array_split(mono, 4) if len(s)]
    seg_rms = [float(np.sqrt(np.mean(s ** 2))) for s in segs]
    seg_rms = [r for r in seg_rms if r > 1e-5]
    rec["loudness_spread_db"] = (
        round(20 * np.log10(max(seg_rms) / min(seg_rms)), 1) if len(seg_rms) > 1 else 0.0
    )

    # 削波
    rec["clipped_ratio"] = round(float((np.abs(mono) >= 0.999).mean()), 5)

    # ---- 判定 ----
    r = rec["reasons"]
    if dur < MIN_OK_DUR:
        r.append(f"太短（{dur:.1f}s < {MIN_OK_DUR}s）")
    if rec["silence_ratio"] > MAX_SILENCE_RATIO:
        r.append(f"静音过多（{rec['silence_ratio']:.0%}）")
    if rec["clipped_ratio"] > 0.005:
        r.append(f"削波明显（{rec['clipped_ratio']:.2%}）")
    if rec["loudness_spread_db"] > 12:
        r.append(f"响度忽大忽小（{rec['loudness_spread_db']}dB，可能有混响或远处收音）")
    if peak < 0.05:
        r.append("音量过低")
    if rec["channels"] > 1:
        r.append("双声道（不算错，但建议确认两声道内容一致）")
    if not GOOD_DUR[0] <= dur <= GOOD_DUR[1]:
        r.append(f"不在推荐时长 {GOOD_DUR[0]:.0f}~{GOOD_DUR[1]:.0f}s 内")

    # 打分：越小越好。进入推荐区间的、干净的排前面
    score = 0.0
    score += max(0.0, MIN_OK_DUR - dur) * 10
    score += max(0.0, dur - MAX_OK_DUR) * 0.5
    score += rec["silence_ratio"] * 20
    score += max(0.0, rec["loudness_spread_db"] - 6) * 1.0
    score += rec["clipped_ratio"] * 500
    rec["score"] = round(score, 2)
    rec["verdict"] = "可用" if score < 3 else ("勉强" if score < 8 else "不建议")
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="目录或单个音频文件")
    ap.add_argument("--json", default="", help="把结果写成 json")
    args = ap.parse_args()

    t = Path(args.target)
    files = (
        sorted(p for p in t.rglob("*") if p.suffix.lower() in AUDIO_EXT)
        if t.is_dir()
        else [t]
    )
    if not files:
        print("没找到音频文件（支持:", " ".join(sorted(AUDIO_EXT)), "）")
        return 1

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        recs = [analyse(f, tmp) for f in files]

    recs.sort(key=lambda r: (r.get("score", 999), r["file"]))
    print(f"{'判定':<6}{'时长':>7}{'静音':>7}{'响度差':>8}{'削波':>8}{'声道':>5}  文件")
    print("-" * 92)
    for r in recs:
        if not r["ok"]:
            print(f"{'读失败':<6}{'-':>7}{'-':>7}{'-':>8}{'-':>8}{'-':>5}  {Path(r['file']).name}")
            continue
        print(
            f"{r['verdict']:<6}{r['duration']:>6.1f}s{r['silence_ratio']:>7.0%}"
            f"{r['loudness_spread_db']:>7.1f}dB{r['clipped_ratio']:>8.2%}{r['channels']:>5}"
            f"  {Path(r['file']).name}"
        )
        for reason in r["reasons"]:
            if reason.startswith("双声道"):
                continue
            print(f"{'':>6}  └ {reason}")

    usable = [r for r in recs if r.get("verdict") == "可用"]
    print("-" * 92)
    print(f"共 {len(recs)} 个文件，其中「可用」{len(usable)} 个")
    if usable:
        print("建议优先试听：")
        for r in usable[:5]:
            print(f"  {r['file']}  ({r['duration']}s)")
    print("注意：客观指标只能排掉明显不合格的；是否像角色、有没有背景音乐残留，必须你亲耳确认。")

    if args.json:
        Path(args.json).write_text(
            json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("报告已写入", args.json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
