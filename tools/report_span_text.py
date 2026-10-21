# 把用户指定的时间段与整集转写对齐，列出每段「实际说了什么」。
#
# 为什么要做：角色分配是听辨给出的，但转写能提供客观参照。
# 如果某段被标成 A，内容却是 B 的台词，就说明标错了——先发现，比生成完再返工划算。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\report_span_text.py
import json
import sys
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
OUT = ROOT / "character_clips"
# 把 ASR 的常见同音错字纠回来，避免拿错字去生成
FIX = {"苹果佳儿": "苹果嘉儿", "佳儿": "嘉儿", "紫月": "紫悦"}


def parse(span: str):
    a, b = span.split("-")
    def sec(x):
        p = x.strip().split(":")
        return int(p[0]) * 60 + float(p[1]) if len(p) == 2 else float(x)
    return sec(a), sec(b)


def main() -> int:
    clips = json.loads((OUT / "clips.json").read_text(encoding="utf-8-sig"))
    rows = json.loads((ROOT / "refs" / "dub" / "full_text.json").read_text(encoding="utf-8-sig"))

    by = {}
    for c in clips:
        by.setdefault((c["speaker"], c["speaker_cn"]), []).append(c)

    for (sp, cn), items in sorted(by.items(), key=lambda kv: kv[0][1]):
        print(f"\n{'=' * 84}\n{cn}（{sp}）\n{'=' * 84}")
        for c in items:
            s, e = c["start"], c["end"]
            texts = [t["text"] for t in rows if t["end"] > s and t["start"] < e]
            fixed = []
            for t in texts:
                for k, v in FIX.items():
                    t = t.replace(k, v)
                fixed.append(t)
            usable = "可用" if c["usable_as_reference"] else "过短"
            print(f"  {c['span']:>12}  {c['dur']:5.2f}s  {usable}")
            if fixed:
                for t in fixed:
                    print(f"        「{t}」")
            else:
                print("        （这段时间内没有识别到台词）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
