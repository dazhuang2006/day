# 临时探针：查清为什么拼不出够长的参考音频
import json
import sys
from pathlib import Path

import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
sys.path.insert(0, str(ROOT / "tools"))
from prosody_stats import stats as prosody

out_dir = ROOT / "refs" / "download"
records = json.loads((out_dir / "candidates.json").read_text(encoding="utf-8-sig"))
print("候选总数:", len(records))

by_spk = {}
for r in records:
    p = ROOT / r["file"]
    if not p.exists():
        print("缺文件", p)
        continue
    st = prosody(p)
    info = sf.info(str(p))
    by_spk.setdefault(r["speaker_id"], []).append((st.get("f0_cv", -1), info.duration, p.name, r["text"]))

for spk, items in sorted(by_spk.items()):
    items.sort(key=lambda x: x[0], reverse=True)
    print(f"\n=== {spk} 共 {len(items)} 条 ===")
    total = 0.0
    for i, (cv, dur, name, text) in enumerate(items):
        ok = dur >= 2.5
        if ok:
            total += dur + 0.3
        print(f"  {i:2d} cv={cv:6.3f} dur={dur:5.2f} {'应用' if ok else ' 跳 '} 累计={total:5.2f}  {text[:26]}")
        if i > 20:
            print("  ...")
            break
