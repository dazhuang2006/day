# 生成"还差哪些台词"的逐条清单，方便补齐录音。
#
# 依据：tools/import_recorded_voice.py 的匹配结果（按文件夹归属角色 + 文本/前缀匹配）。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\voice_checklist.py
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
REC = ROOT / "applejack_voice"

CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}
CN2KEY = {v: k for k, v in CN.items()}

ANY_PAREN = re.compile(r"[（(][^）)]*[）)]")


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).replace("“", "").replace("”", "")
    return re.sub(r"[\s\u200b\u3000]", "", s)


def strip_parens(s: str) -> str:
    s = ANY_PAREN.sub("", s)
    s = re.sub(r"^[，。、…—\-\s]+", "", s)
    return norm(s)


def fname_text(p: Path) -> str:
    n = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", p.stem)
    n = re.sub(r"\s*\(\d+\)$", "", n)
    return re.sub(r"^[_\-–—\s]+", "", n).strip()


def main() -> int:
    man = json.loads((ROOT / "voice_manifest.json").read_text(encoding="utf-8-sig"))
    lines = man["lines"]

    have_by_sp = {}
    for folder in [p for p in REC.iterdir() if p.is_dir()]:
        sp = CN2KEY.get(folder.name)
        if not sp:
            continue
        for p in folder.glob("*.mp3"):
            have_by_sp.setdefault(sp, []).append(fname_text(p))

    def covered(sp, text):
        cands = have_by_sp.get(sp, [])
        full, nop = norm(text), strip_parens(text)
        for f in cands:
            fn, fnp = norm(f), strip_parens(f)
            if fn == full or fnp == nop:
                return True
            # 文件名被截断：允许它是台词的前缀
            if len(fnp) >= 5 and nop.startswith(fnp) and len(fnp) / max(len(nop), 1) >= 0.5:
                return True
        return False

    md = ["# 台词语音进度清单", "",
          "按角色列出游戏里每一条台词，`[x]` 已录、`[ ]` 待录。", ""]
    summary = []
    for sp in sorted({l["speaker"] for l in lines},
                     key=lambda k: -len([x for x in lines if x["speaker"] == k])):
        items = [l for l in lines if l["speaker"] == sp]
        done = [l for l in items if covered(sp, l["text"])]
        todo = [l for l in items if not covered(sp, l["text"])]
        summary.append((sp, len(done), len(items)))
        md.append(f"## {CN[sp]}（{len(done)}/{len(items)}）")
        md.append("")
        for l in items:
            mark = "x" if covered(sp, l["text"]) else " "
            md.append(f"- [{mark}] {l['text']}")
        md.append("")

    (ROOT / "台词语音进度.md").write_text("\n".join(md), encoding="utf-8")

    print(f"{'角色':<10}{'已录':>5}{'总计':>6}{'待录':>6}")
    print("-" * 32)
    total_done = total_all = 0
    for sp, d, t in summary:
        total_done += d
        total_all += t
        print(f"{CN[sp]:<10}{d:>5}{t:>6}{t - d:>6}")
    print("-" * 32)
    print(f"{'合计':<10}{total_done:>5}{total_all:>6}{total_all - total_done:>6}")
    print("\n逐条清单 -> 台词语音进度.md")

    # 待录最多的角色先提醒
    worst = sorted(summary, key=lambda x: x[1] / max(x[2], 1))[:3]
    print("优先要补的角色:", "、".join(f"{CN[s]}（{d}/{t}）" for s, d, t in worst))
    return 0


if __name__ == "__main__":
    sys.exit(main())
