# 把切好的角色片段合并成"每位角色一条"参考音频（模型限制 3~10 秒）。
#
# 输入：character_clips/clips.json（由 cut_character_clips.py 生成）
# 输出：character_clips/references/<角色>.wav + references.json（含参考文本草稿）
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\merge_references.py
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
OUT = ROOT / "character_clips"
REF_DIR = OUT / "references"

TARGET_MAX = 9.5   # 模型上限 10s，留点余量
GAP = 0.25         # 句间静音


def normalize(a, target_peak=0.85):
    a = np.asarray(a, dtype=np.float64)
    peak = float(np.abs(a).max()) if a.size else 0.0
    return a * (target_peak / peak) if peak > 1e-6 else a


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="只处理某个角色（内部代号，逗号分隔）")
    ap.add_argument("--max", type=float, default=TARGET_MAX)
    args = ap.parse_args()

    clips = json.loads((OUT / "clips.json").read_text(encoding="utf-8-sig"))
    if args.only:
        want = {s.strip() for s in args.only.split(",") if s.strip()}
        clips = [c for c in clips if c["speaker"] in want]

    by = {}
    for c in clips:
        if not c["usable_as_reference"]:
            continue
        by.setdefault(c["speaker"], []).append(c)

    REF_DIR.mkdir(parents=True, exist_ok=True)
    index = []
    for sp, items in sorted(by.items()):
        # 单个可用片段就直接用；多个则按时间顺序拼到接近上限。
        # 注意不能只挑"最大的那一段"——那会白白浪费同角色其余片段
        # （之前就是这样，柔柔 3 段可用却只用了 1 段）。
        items.sort(key=lambda x: x["start"])
        combos = []
        for c in items:
            d = sf.info(str(ROOT / c["file"])).duration
            if 3.0 <= d <= args.max:
                combos.append([(c, d)])
        picked, total = [], 0.0
        for c in items:
            d = sf.info(str(ROOT / c["file"])).duration
            if picked and total + d > args.max:
                break
            picked.append((c, d))
            total += d + GAP
        if picked:
            combos.append(picked)
        # 去重：单段组合如果和拼接结果一样就没必要重复输出
        uniq, seen = [], set()
        for combo in combos:
            key = tuple(c["span"] for c, _ in combo)
            if key in seen:
                continue
            seen.add(key)
            uniq.append(combo)

        for vi, combo in enumerate(uniq, 1):
            parts, texts = [], []
            for i, (c, d) in enumerate(combo):
                y, sr = sf.read(str(ROOT / c["file"]), dtype="float32")
                if y.ndim > 1:
                    y = y.mean(axis=1)
                parts.append(normalize(y))
                texts.extend(c.get("texts") or [])
                if i != len(combo) - 1:
                    parts.append(np.zeros(int(sr * GAP), dtype="float32"))
            merged = np.concatenate(parts)
            dur = len(merged) / sr
            if dur < 3.0:
                continue

            suffix = "" if len(uniq) == 1 else f"_v{vi}"
            dst = REF_DIR / f"{sp}{suffix}.wav"
            sf.write(str(dst), merged, sr)
            ref_text = "，".join(t.strip() for t in texts if t.strip())
            index.append({
                "speaker": sp, "speaker_cn": combo[0][0]["speaker_cn"],
                "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
                "duration": round(dur, 2),
                "from_spans": [c["span"] for c, _ in combo],
                "ref_text_draft": ref_text,
                "note": "ref_text_draft 来自 ASR，必须人工核对后才能用于生成",
            })
            print(f"  {combo[0][0]['speaker_cn']:<8} {len(combo)} 段 -> {dur:.1f}s  "
                  f"[{' '.join(c['span'] for c, _ in combo)}]  {dst.name}")

    (OUT / "references.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n共生成 {len(index)} 条参考音频 -> {REF_DIR}")
    print("\n参考文本草稿（ASR，务必核对同音字）：")
    for r in index:
        print(f"  {r['speaker_cn']}: {r['ref_text_draft'][:70]}")
    short = [r for r in index if r["duration"] < 3.0]
    if short:
        print("\n注意：以下角色拼接后仍不足 3 秒，模型会拒绝：")
        for r in short:
            print(f"  {r['speaker_cn']} 仅 {r['duration']}s —— 需要再补片段")
    return 0


if __name__ == "__main__":
    sys.exit(main())
