# 诊断：为什么有些角色（如轻声细语的柔柔）没有候选片段。
#
# 怀疑：候选是按"F0 起伏"降序取前 N 条，而轻柔的说话方式起伏小、音量大不起来，
# 于是被系统性筛掉。这里逐级统计每一刀砍掉了多少段。
import sys
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(r"D:\python\xiangmu\youxi1")
VOC = ROOT / "refs" / "dub" / "vocals" / "ep04_vocals.wav"

sys.path.insert(0, str(ROOT / "tools"))
from dub_segments import MIN_SEG, PAD, TOP_DB  # noqa: E402


def speech_intervals(y, sr):
    intervals = librosa.effects.split(y, top_db=TOP_DB, frame_length=2048, hop_length=512)
    segs = []
    for a, b in intervals:
        start = max(0.0, a / sr - PAD)
        end = min(len(y) / sr, b / sr + PAD)
        if end - start < MIN_SEG:
            continue
        while end - start > 12.0:
            segs.append((start, start + 12.0))
            start += 12.0
        segs.append((start, end))
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] < 0.45:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def main() -> int:
    print(f"参数: TOP_DB={TOP_DB} MIN_SEG={MIN_SEG} PAD={PAD}")
    y, sr = librosa.load(str(VOC), sr=None, mono=True)
    print(f"音频 {len(y) / sr:.0f} 秒 / {sr} Hz")

    segs = speech_intervals(y, sr)
    print(f"1) 能量法切出 {len(segs)} 段（>= {MIN_SEG}s）")

    rows = []
    for s in segs:
        a, b = int(s[0] * sr), int(s[1] * sr)
        clip = y[a:b]
        if len(clip) == 0:
            continue
        rms = float(np.sqrt(np.mean(clip ** 2)))
        f0, voiced, _ = librosa.pyin(clip, fmin=70, fmax=500, sr=sr,
                                     frame_length=1024, hop_length=160)
        f0v = f0[~np.isnan(f0)]
        vr = float(np.mean(voiced)) if len(voiced) else 0.0
        rows.append({
            "start": s[0], "dur": len(clip) / sr, "rms": rms,
            "f0": float(np.mean(f0v)) if len(f0v) >= 5 else 0.0,
            "n_f0": len(f0v), "vr": vr,
            "cv": float(np.std(f0v) / np.mean(f0v)) if len(f0v) >= 5 else 0.0,
        })

    n = len(rows)
    print(f"2) 能评估的 {n} 段")
    no_f0 = [r for r in rows if r["n_f0"] < 5]
    low_vr = [r for r in rows if r["n_f0"] >= 5 and r["vr"] < 0.25]
    print(f"   - 有效 F0 不足 5 帧: {len(no_f0)} 段")
    print(f"   - 有声比 < 0.25（气声/轻声会被这条砍掉）: {len(low_vr)} 段")
    for r in low_vr[:8]:
        print(f"       {r['start']:7.1f}s {r['dur']:5.2f}s rms={r['rms']:.4f} 有声比={r['vr']:.2f}")

    ok = [r for r in rows if r["n_f0"] >= 5 and r["vr"] >= 0.25]
    print(f"3) 通过有声比筛选 {len(ok)} 段")
    low_f0 = [r for r in ok if r["f0"] < 120]
    print(f"   - F0 < 120Hz（男声/音效）: {len(low_f0)} 段")
    ok2 = [r for r in ok if r["f0"] >= 120]
    print(f"4) 最终候选池 {len(ok2)} 段")

    if ok2:
        cvs = sorted(r["cv"] for r in ok2)
        print(f"   起伏分布: 最低 {cvs[0]:.3f} 中位 {cvs[len(cvs)//2]:.3f} 最高 {cvs[-1]:.3f}")
        print(f"   取前 60 条的起伏门槛 ≈ {cvs[max(0, len(cvs) - 60)]:.3f}")
        print(f"   → 有 {max(0, len(cvs) - 60)} 段因为起伏不够被挤出榜单")

        # 轻柔片段：音量最低的那些
        quiet = sorted(ok2, key=lambda r: r["rms"])[:12]
        print("\n   音量最低的 12 段（轻柔角色最可能在这里）:")
        for r in quiet:
            print(f"     {r['start']:7.1f}s {r['dur']:5.2f}s rms={r['rms']:.4f} "
                  f"F0={r['f0']:5.0f} 起伏={r['cv']:.3f} 有声比={r['vr']:.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
