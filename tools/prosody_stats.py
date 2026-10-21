# 量测一段语音的"语调丰富度"。
#
# 为什么能量化：听感上"人机、没语调"的直接来源是基频（F0）太平——
# 真人说话 F0 会持续起伏，合成得差的时候 F0 几乎是直线。
# 所以用 F0 的标准差、五到九十五分位跨度、以及有声段比例来客观比较不同参数的效果。
#
# 用法：python tools/prosody_stats.py <文件或目录>
import sys
from pathlib import Path

import librosa
import numpy as np


def stats(path: Path) -> dict:
    y, sr = librosa.load(str(path), sr=16000, mono=True)
    if len(y) == 0:
        return {"file": str(path), "error": "空文件"}
    # pyin 比 yin 稳，但慢一些；参考音频都很短，可以接受
    f0, voiced, _ = librosa.pyin(
        y, fmin=70, fmax=500, sr=sr, frame_length=1024, hop_length=160
    )
    f0v = f0[~np.isnan(f0)]
    vr = float(np.mean(voiced)) if len(voiced) else 0.0
    # 有声段太少时 F0 统计毫无意义（曾出现过有声比 0.03、F0 起伏 0.343 的假阳性，
    # 那种数字看着"很有语调"，其实只是没检测到语音的几个点）
    if len(f0v) < 5 or vr < 0.2:
        return {"file": str(path), "error": f"有效语音太少(有声比 {vr:.2f})，无法评估"}
    return {
        "file": str(path),
        "dur": round(len(y) / sr, 2),
        "voiced_ratio": round(float(np.mean(voiced)), 3),
        "f0_mean": round(float(np.mean(f0v)), 1),
        "f0_std": round(float(np.std(f0v)), 1),
        # 相对起伏：F0 标准差 / 均值。越大 = 语调越有起伏
        "f0_cv": round(float(np.std(f0v) / np.mean(f0v)), 3),
        "f0_p5": round(float(np.percentile(f0v, 5)), 1),
        "f0_p95": round(float(np.percentile(f0v, 95)), 1),
        "f0_range_semitones": round(
            12 * float(np.log2(np.percentile(f0v, 95) / max(np.percentile(f0v, 5), 1))), 2
        ),
    }


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    files = (
        sorted(p for p in target.rglob("*.wav")) + sorted(p for p in target.rglob("*.mp3"))
        if target.is_dir()
        else [target]
    )
    if not files:
        print("没找到音频")
        return 1

    rows = [stats(f) for f in files]
    rows = [r for r in rows if "error" not in r]
    rows.sort(key=lambda r: r["f0_cv"], reverse=True)

    print(f"{'文件':<44}{'时长':>6}{'F0均值':>8}{'F0起伏':>8}{'F0跨度':>8}{'半音跨度':>9}{'有声比':>7}")
    print("-" * 96)
    for r in rows:
        print(
            f"{Path(r['file']).name:<44}{r['dur']:>5.1f}s{r['f0_mean']:>8.1f}"
            f"{r['f0_cv']:>8.3f}{r['f0_p5']:>5.0f}-{r['f0_p95']:<4.0f}"
            f"{r['f0_range_semitones']:>7.1f}{r['voiced_ratio']:>8.2f}"
        )
    if rows:
        best = rows[0]
        print("-" * 96)
        print(f"起伏最大的：{Path(best['file']).name}  F0 起伏 {best['f0_cv']}  半音跨度 {best['f0_range_semitones']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
