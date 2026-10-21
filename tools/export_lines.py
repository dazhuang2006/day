# 导出角色台词表：按角色分组，含台词 id、文本、字数，方便配音/校对使用。
#
# 数据来源：voice_manifest.json（由 tools/extract-lines.mjs 从游戏源码提取）。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\export_lines.py
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}


def main() -> int:
    m = json.loads((ROOT / "voice_manifest.json").read_text(encoding="utf-8-sig"))
    lines = m["lines"]
    by = defaultdict(list)
    for l in lines:
        by[l["speaker"]].append(l)

    print(f"共 {len(lines)} 条角色台词，涉及 {len(by)} 位角色\n")
    order = sorted(by, key=lambda k: -len(by[k]))
    for sp in order:
        items = by[sp]
        total = sum(len(i["text"]) for i in items)
        print("=" * 78)
        print(f"{CN.get(sp, sp)}（{sp}）  {len(items)} 条  合计 {total} 字  "
              f"平均 {total / len(items):.1f} 字/条")
        print("=" * 78)
        for i, it in enumerate(items, 1):
            print(f"{i:3d}. [{it['id']}] {len(it['text']):2d}字  {it['text']}")
        print()

    # 同时输出一份 Markdown 表格，方便直接看
    md = ["# 《星莓的一天》角色台词表", "",
          f"共 **{len(lines)}** 条角色台词。id 由「角色 + 文本哈希」生成，"
          "台词不改则 id 不变，配音文件名就用它。", ""]
    md.append("| 角色 | 条数 | 合计字数 |")
    md.append("|---|---|---|")
    for sp in order:
        md.append(f"| {CN.get(sp, sp)} | {len(by[sp])} | {sum(len(i['text']) for i in by[sp])} |")
    md.append("")
    for sp in order:
        md.append(f"## {CN.get(sp, sp)}（{sp}）— {len(by[sp])} 条")
        md.append("")
        md.append("| # | 台词 id | 文本 |")
        md.append("|---|---|---|")
        for i, it in enumerate(by[sp], 1):
            md.append(f"| {i} | `{it['id']}` | {it['text']} |")
        md.append("")
    (ROOT / "角色台词表.md").write_text("\n".join(md), encoding="utf-8")
    print("Markdown 表格已写入 角色台词表.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
