# 专找"轻柔说话"的片段：柔柔这种轻声气声的角色很可能被常规阈值滤掉。
#
# 常规筛选用了 有声比>=0.25，轻声细语经常低于这个值。这里把门槛放到 0.15，
# 并按"音量低 + 基频较高 + 气声特征"排出最像柔柔的候选。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\find_soft_segments.py <人声.wav> --out refs\dub\soft
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

TOP_DB = 30.0
MIN_SEG = 2.5
MAX_SEG = 10.0
PAD = 0.3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("vocal_wav")
    ap.add_argument("--out", default="refs/dub/soft")
    ap.add_argument("--limit", type=int, default=24)
    ap.add_argument("--max-rms", type=float, default=0.0, help="只保留低于此音量的片段，0=自动")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    src = Path(args.vocal_wav)
    if not src.is_absolute():
        src = root / src
    out_dir = (root / args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    y, sr = librosa.load(str(src), sr=None, mono=True)
    print(f"{len(y) / sr:.0f} 秒 / {sr} Hz")

    intervals = librosa.effects.split(y, top_db=TOP_DB, frame_length=2048, hop_length=512)
    segs = []
    for a, b in intervals:
        s = max(0.0, a / sr - PAD)
        e = min(len(y) / sr, b / sr + PAD)
        if e - s < MIN_SEG:
            continue
        while e - s > MAX_SEG:
            segs.append((s, s + MAX_SEG))
            s += MAX_SEG
        segs.append((s, e))
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] < 0.5:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    print(f"能量法切出 {len(merged)} 段（TOP_DB={TOP_DB}，比常规更敏感）")

    rows = []
    for s in merged:
        a, b = int(s[0] * sr), int(s[1] * sr)
        clip = y[a:b]
        if len(clip) == 0:
            continue
        rms = float(np.sqrt(np.mean(clip ** 2)))
        f0, voiced, _ = librosa.pyin(clip, fmin=120, fmax=500, sr=sr,
                                     frame_length=1024, hop_length=160)
        f0v = f0[~np.isnan(f0)]
        vr = float(np.mean(voiced)) if len(voiced) else 0.0
        if len(f0v) < 5:
            continue
        # 气声程度：高频能量占比高 = 更"沙"/更轻
        S = np.abs(librosa.stft(clip, n_fft=1024)) ** 2
        freqs = librosa.fft_frequencies(sr=sr, n_fft=1024)
        high = float(S[freqs > 4000].sum() / max(S.sum(), 1e-9))
        rows.append({
            "start": round(s[0], 2), "end": round(s[1], 2),
            "dur": round(len(clip) / sr, 2), "rms": rms,
            "voiced_ratio": round(vr, 3),
            "f0_mean": round(float(np.mean(f0v)), 1),
            "f0_cv": round(float(np.std(f0v) / np.mean(f0v)), 3),
            "high_ratio": round(high, 3),
        })

    # 常规阈值会砍掉的那些：有声比低，或音量低
    soft = [r for r in rows if r["voiced_ratio"] < 0.45 or r["rms"] < 0.030]
    print(f"其中「轻声/气声」特征明显的有 {len(soft)} 段（常规筛选会丢掉大部分）")
    soft.sort(key=lambda r: r["rms"])
    soft = soft[: args.limit]

    for i, r in enumerate(soft, 1):
        a, b = int(r["start"] * sr), int(r["end"] * sr)
        name = f"soft{i:03d}.wav"
        sf.write(str(out_dir / name), y[a:b], sr)
        r["file"] = str((out_dir / name).relative_to(root)).replace("\\", "/")

    (out_dir / "soft_segments.json").write_text(
        json.dumps(soft, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"\n{'片段':<12}{'时长':>6}{'音量':>9}{'有声比':>8}{'音高':>7}{'起伏':>7}{'气声':>7}")
    for r in soft:
        print(f"{Path(r['file']).name:<12}{r['dur']:>5.2f}s{r['rms']:>9.4f}"
              f"{r['voiced_ratio']:>8.2f}{r['f0_mean']:>7.0f}{r['f0_cv']:>7.2f}{r['high_ratio']:>7.3f}")
    print(f"\n输出目录: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
