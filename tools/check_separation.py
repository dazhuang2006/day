# 评估 UVR5 分离质量：人声里还剩多少伴奏/低频残留。
#
# 意义：GPT-SoVITS 会把参考音频里的一切都学走，包括残留的背景音乐。
# 所以生成配音之前必须确认人声轨是干净的。
import sys
from pathlib import Path

import librosa
import numpy as np

ROOT = Path(r"D:\python\xiangmu\youxi1")
MIX = ROOT / "refs" / "dub" / "ep04_full.wav"
VOC = ROOT / "refs" / "dub" / "vocals" / "ep04_vocals.wav"


def rms(x):
    return float(np.sqrt(np.mean(x ** 2)))


def low_ratio(x, sr):
    """200Hz 以下能量占比：伴奏的鼓点与贝斯主要集中在这里。"""
    S = np.abs(librosa.stft(x, n_fft=2048)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    return float(S[freqs < 200].sum() / S.sum())


def flatness(x):
    return float(np.mean(librosa.feature.spectral_flatness(y=x)))


def main() -> int:
    dur = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
    mix, sr = librosa.load(str(MIX), sr=22050, mono=True, duration=dur)
    voc, _ = librosa.load(str(VOC), sr=22050, mono=True, duration=dur)
    print(f"分析前 {dur:.0f} 秒 @ {sr} Hz")
    print(f"RMS      混音 {rms(mix):.5f}  ->  人声 {rms(voc):.5f}   (比值 {rms(voc) / rms(mix):.3f})")
    print(f"频谱平坦度 混音 {flatness(mix):.5f}  ->  人声 {flatness(voc):.5f}")
    print(f"低频(<200Hz)占比 混音 {low_ratio(mix, sr):.3f}  ->  人声 {low_ratio(voc, sr):.3f}")

    # 逐段比较：如果某段混音很响而人声很轻，说明那一段主要是音乐（正常）
    win = sr
    n = min(len(mix), len(voc)) // win
    ratios = []
    for i in range(n):
        a, b = i * win, (i + 1) * win
        if rms(mix[a:b]) > 1e-4:
            ratios.append(rms(voc[a:b]) / rms(mix[a:b]))
    ratios = np.array(ratios)
    print(f"逐秒能量比: 中位 {np.median(ratios):.3f}  最低 {ratios.min():.3f}  最高 {ratios.max():.3f}")
    print("解读：比值明显低于 1 说明伴奏被去掉了；接近 1 的段落是纯人声段。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
