# 把用户录好的台词语音与游戏台词清单对齐，生成接入所需的映射与覆盖报告。
#
# 关键点：
#   1. 文件名只有台词文本（带日期前缀），**没有角色信息**，所以角色要靠所在文件夹判断；
#   2. 同一句台词可能被多个角色说（如"秘密。"星莓和苹果嘉儿都有），
#      因此匹配必须限定在"该角色自己的台词"范围内，不能全局匹配；
#   3. 星莓没有文件夹 —— 需要报出来，不能默默当成"没有配音"。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\import_recorded_voice.py [--dry-run]
import argparse
import hashlib
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
REC = ROOT / "applejack_voice"
OUT = ROOT / "assets" / "audio" / "voice"

CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}
CN2KEY = {v: k for k, v in CN.items()}

# 文件名里可能出现的噪音
DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}-")
DUP_SUFFIX = re.compile(r"\s*\(\d+\)$")
LEAD_UNDERSCORE = re.compile(r"^[_\-–—\s]+")
PAREN = re.compile(r"^[（(][^）)]*[）)]\s*")


def norm(s: str) -> str:
    """归一化：去掉引号差异、空格与不可见字符，便于稳健匹配。"""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("“", "").replace("”", "").replace('"', "")
    s = re.sub(r"[\s\u200b\u3000]", "", s)
    return s


# 括号动作提示可能在句首、也可能在句中：
#   例 "（把脸埋进抱枕里，小声）我、我现在可以喊了吗？"
#   例 "（从门缝探进头来，气声）她到街口了！我数过，就她一个！"
# 配音时括号内容不会念出来，所以匹配前要整段去掉，而不是只去句首。
ANY_PAREN = re.compile(r"[（(][^）)]*[）)]")


def strip_parens(s: str) -> str:
    """去掉所有括号内容（配音不会念），再去掉残留标点与空白后归一化。"""
    s = ANY_PAREN.sub("", s)
    s = re.sub(r"^[，。、…—\-\s]+", "", s)
    return norm(s)


def text_from_filename(p: Path) -> str:
    n = p.stem
    n = DATE_PREFIX.sub("", n)
    n = DUP_SUFFIX.sub("", n)
    n = LEAD_UNDERSCORE.sub("", n)
    return n.strip()


def line_id(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告，不复制文件")
    ap.add_argument("--src", default=str(REC))
    args = ap.parse_args()

    src_dir = Path(args.src)
    if not src_dir.exists():
        print(f"找不到录好的目录: {src_dir}")
        return 1

    man = json.loads((ROOT / "voice_manifest.json").read_text(encoding="utf-8-sig"))
    # 角色 -> 文本(归一化) -> 台词；同时准备"去括号版"，因为配音不会念括号里的提示
    by_speaker = {}
    by_speaker_noparen = {}
    for l in man["lines"]:
        by_speaker.setdefault(l["speaker"], {})[norm(l["text"])] = l
        by_speaker_noparen.setdefault(l["speaker"], {})[strip_parens(l["text"])] = l
    # 归一化文本 -> 可能说这句的角色（用于识别"放错文件夹"）
    by_norm = {}
    for l in man["lines"]:
        by_norm.setdefault(norm(l["text"]), set()).add(l["speaker"])
        by_norm.setdefault(strip_parens(l["text"]), set()).add(l["speaker"])

    folders = [p for p in src_dir.iterdir() if p.is_dir()]
    print(f"录好的角色文件夹 {len(folders)} 个: " + "、".join(p.name for p in folders))
    missing_char = [cn for cn in CN.values() if cn not in {p.name for p in folders}]
    if missing_char:
        print(f"⚠ 没有文件夹的角色: " + "、".join(missing_char))

    matched = []       # (角色, 台词, 源文件)
    unmatched = []     # 文件名对不上任何台词的
    misplaced = []     # 能对上，但角色不符（放错文件夹）
    seen_texts = {}

    for folder in folders:
        sp = CN2KEY.get(folder.name)
        if sp is None:
            print(f"⚠ 文件夹名不是已知角色，跳过: {folder.name}")
            continue
        for p in sorted(folder.glob("*.mp3")):
            t = text_from_filename(p)
            key = norm(t)
            # 先在该角色自己的台词里找
            hit = by_speaker.get(sp, {}).get(key)
            partial = False
            if hit is None:
                # 去掉括号动作提示后再试（提示可能在句中，配音不会念）
                hit = by_speaker_noparen.get(sp, {}).get(strip_parens(t))
            if hit is None:
                # 再退一步：文件名常被截断（"…她还没来。放" 少了"心"），
                # 允许"文件名是台词的前缀"，但要求足够长以免误配。
                cands = [
                    (k, l) for k, l in by_speaker_noparen.get(sp, {}).items()
                    if len(key) >= 5 and k.startswith(key) and len(key) / len(k) >= 0.5
                ]
                if len(cands) == 1:
                    hit = cands[0][1]
                    partial = True
                elif len(cands) > 1:
                    # 多条都能前缀匹配，取最接近的那条
                    cands.sort(key=lambda kl: len(kl[0]))
                    hit = cands[0][1]
                    partial = True
            if hit is None:
                owners = by_norm.get(key) or by_norm.get(norm(PAREN.sub("", t)))
                if owners:
                    misplaced.append((sp, t, p, owners))
                else:
                    unmatched.append((sp, t, p))
                continue
            if hit["id"] in seen_texts:
                continue  # 同一条台词只取一个文件
            seen_texts[hit["id"]] = True
            matched.append((sp, hit, p, partial))

    print(f"\n=== 匹配结果 ===")
    n_partial = sum(1 for m in matched if m[3])
    print(f"  成功匹配 {len(matched)} 条（其中 {n_partial} 条靠文件名前缀匹配）")
    print(f"  文件名对不上台词 {len(unmatched)} 条")
    print(f"  角色不符（可能放错文件夹） {len(misplaced)} 条")

    if misplaced:
        print("\n--- 角色不符的文件 ---")
        for sp, t, p, owners in misplaced[:15]:
            print(f"  [{p.parent.name}] {t[:34]}  → 清单里属于: "
                  f"{'、'.join(CN[o] for o in owners)}")

    if unmatched:
        print("\n--- 对不上台词的文件 ---")
        for sp, t, p in unmatched[:15]:
            print(f"  [{p.parent.name}] {t[:44]}")

    print("\n=== 各角色覆盖 ===")
    total_missing = 0
    for sp in sorted(by_speaker, key=lambda k: -len(by_speaker[k])):
        have = {l["id"] for s, l, _p, _pa in matched if s == sp}
        all_ids = {l["id"] for l in by_speaker[sp].values()}
        miss = all_ids - have
        total_missing += len(miss)
        print(f"  {CN[sp]:<8} {len(have):>2}/{len(all_ids):<2} 已配  缺 {len(miss)}")
    print(f"\n  合计已配 {len(matched)} / {len(man['lines'])} 条，缺 {total_missing} 条")

    if args.dry_run:
        print("\n（--dry-run，未复制任何文件）")
        return 0

    # --- 落地：复制成 角色/角色_哈希.mp3，并更新索引 ---
    print("\n=== 写入资源目录 ===")
    OUT.mkdir(parents=True, exist_ok=True)
    for sp, l, p, _pa in matched:
        d = OUT / sp
        d.mkdir(parents=True, exist_ok=True)
        dst = d / f"{sp}_{line_id(l['text'])}.mp3"
        shutil.copy2(p, dst)
    index = {}
    for sp in by_speaker:
        d = OUT / sp
        if d.exists():
            index[sp] = sorted(x.stem for x in d.glob("*.mp3"))
    (OUT / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  已复制 {len(matched)} 个文件")
    for sp, ids in sorted(index.items()):
        print(f"    {CN.get(sp, sp):<8} {len(ids)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
