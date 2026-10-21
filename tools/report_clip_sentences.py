# 列出每段切片里"实际包含哪几句台词、各自几点几秒"。
#
# 为什么有用：几段时间里是两个人连续说话（例如 17:01-17:06 同时含柔柔和苹果嘉儿），
# 混在一起无法直接当参考音频。这里把句子级时间点列出来，方便精确重切或核对角色归属。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\report_clip_sentences.py
import json
import sys
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
OUT = ROOT / "character_clips_v2"
FULL = ROOT / "refs" / "dub" / "full_text.json"
FIX = {"苹果佳儿": "苹果嘉儿", "佳儿": "嘉儿", "紫月": "紫悦"}


def main() -> int:
    clips = json.loads((OUT / "clips.json").read_text(encoding="utf-8-sig"))
    rows = json.loads(FULL.read_text(encoding="utf-8-sig"))

    by = {}
    for c in clips:
        by.setdefault((c["speaker"], c["speaker_cn"]), []).append(c)

    for (sp, cn), items in sorted(by.items(), key=lambda kv: kv[0][1]):
        print(f"\n{'=' * 82}\n{cn}（{sp}）\n{'=' * 82}")
        for c in items:
            s, e = c["start"], c["end"]
            print(f"  {c['span']:>13}  {c['dur']:5.2f}s  "
                  f"{'可用' if c['dur'] >= 3 else '不足3秒'}")
            for t in rows:
                if t["end"] > s and t["start"] < e:
                    text = t["text"]
                    for k, v in FIX.items():
                        text = text.replace(k, v)
                    # 标出这句是否完整落在区间内（被切断的要提醒）
                    cut_a = "✂" if t["start"] < s else " "
                    cut_b = "✂" if t["end"] > e else " "
                    print(f"        {cut_a}{t['start']:7.1f}s ~ {t['end']:7.1f}s{cut_b}  {text}")
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
