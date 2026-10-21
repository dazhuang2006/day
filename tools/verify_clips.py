# 用声学特征检查"同一角色的片段是否彼此相似"。
#
# 为什么要查：角色分配是听辨给出的，万一把别的角色标成同一个人，
# 拼接出来的参考音频就是两个声音混在一起，克隆结果会四不像。
# 这里对每段算特征（基频、频谱质心、带宽、过零率），做标准化后聚类，
# 看同一角色的片段是否落在同一簇。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\verify_clips.py
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
OUT = ROOT / "character_clips"


def feats(path: Path):
    y, sr = librosa.load(str(path), sr=22050, mono=True)
    if len(y) < sr // 4:
        return None
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=500, sr=sr,
                                 frame_length=1024, hop_length=160)
    f0v = f0[~np.isnan(f0)]
    if len(f0v) < 5:
        return None
    cent = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
    bw = librosa.feature.spectral_bandwidth(y=y, sr=sr)[0]
    zcr = librosa.feature.zero_crossing_rate(y)[0]
    return {
        "f0_mean": float(np.mean(f0v)),
        "f0_std": float(np.std(f0v)),
        "centroid": float(np.mean(cent)),
        "bandwidth": float(np.mean(bw)),
        "zcr": float(np.mean(zcr)),
    }


def main() -> int:
    clips = json.loads((OUT / "clips.json").read_text(encoding="utf-8-sig"))
    rows = []
    for c in clips:
        f = feats(ROOT / c["file"])
        if f is None:
            continue
        rows.append({**c, **f})

    if len(rows) < 3:
        print("可用片段太少，无法分析")
        return 1

    keys = ["f0_mean", "f0_std", "centroid", "bandwidth", "zcr"]
    X = np.array([[r[k] for k in keys] for r in rows])
    Xs = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-9)

    print(f"{'片段':<22}{'角色':<10}{'时长':>6}{'F0均值':>8}{'F0起伏':>8}{'质心':>8}{'带宽':>8}{'过零':>7}")
    print("-" * 86)
    for r in rows:
        print(f"{r['span']:<22}{r['speaker_cn']:<10}{r['dur']:>5.1f}s{r['f0_mean']:>8.0f}"
              f"{r['f0_std']:>8.1f}{r['centroid']:>8.0f}{r['bandwidth']:>8.0f}{r['zcr']:>7.3f}")

    # 聚类：同一角色的片段应当聚在一起
    from sklearn.cluster import AgglomerativeClustering
    for k in (3, 4, 5):
        model = AgglomerativeClustering(n_clusters=k).fit(Xs)
        groups = {}
        for r, lab in zip(rows, model.labels_):
            groups.setdefault(lab, []).append(r)
        # 每个簇里包含哪些角色
        desc = []
        for lab, items in sorted(groups.items()):
            chars = sorted({i["speaker_cn"] for i in items})
            desc.append(f"簇{lab}({len(items)}段: {'/'.join(chars)})")
        print(f"\n聚成 {k} 簇: " + "  ".join(desc))

    # 角色内部一致性：同一角色各片段的特征两两距离
    print("\n角色内部一致性（平均两两距离，越小越像同一个人）：")
    for sp in sorted({r["speaker"] for r in rows}):
        idx = [i for i, r in enumerate(rows) if r["speaker"] == sp]
        if len(idx) < 2:
            print(f"  {rows[idx[0]]['speaker_cn']:<8} 只有 1 段，无法比较")
            continue
        d = []
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                d.append(float(np.linalg.norm(Xs[idx[a]] - Xs[idx[b]])))
        print(f"  {rows[idx[0]]['speaker_cn']:<8} {len(idx)} 段，平均距离 {np.mean(d):.2f}")
    # 跨角色的平均距离作为参照
    allp = []
    for a in range(len(rows)):
        for b in range(a + 1, len(rows)):
            if rows[a]["speaker"] != rows[b]["speaker"]:
                allp.append(float(np.linalg.norm(Xs[a] - Xs[b])))
    if allp:
        print(f"  （跨角色平均距离 {np.mean(allp):.2f}，作为参照）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
