# 从开放语料 AISHELL-3（Apache-2.0）取少量样本，作为配音的参考音频。
#
# 为什么用 AISHELL-3：44.1kHz / 16bit / 安静室内 / 高保真麦克风录音，
# 比众包语料干净得多，很适合做 GPT-SoVITS 的零样本参考。
# 授权是 Apache-2.0，可自由使用与再分发（这是它比动画音轨强的地方）。
#
# 转写来自仓库的 train/content.txt，格式是「汉字 拼音」交替，这里只保留汉字，
# 保证 ref_text 与音频逐字一致——手工写这段文本几乎必然出错。
#
# 用法：
#   python tools/fetch_refs.py --speakers SSB0016,SSB0534 --per-speaker 3 --out refs/download
#   python tools/fetch_refs.py --from-info --gender female --age B,C --limit 4 --out refs/download
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://huggingface.co/datasets/shenyunhang/AISHELL-3"
API = f"https://huggingface.co/api/datasets/shenyunhang/AISHELL-3/tree/main"
CACHE = ROOT / "refs" / ".cache"

# 「广州 guang3 女 nv3」-> 取汉字 + 紧跟的拼音
PAIR = re.compile(r"([\u4e00-\u9fff])\s+([a-zü]+[1-5])")


def http_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "starberry-voice/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def http_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "starberry-voice/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def http_file(url: str, dst: Path):
    req = urllib.request.Request(url, headers={"User-Agent": "starberry-voice/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dst, "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)


def load_speaker_info():
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "spk-info.txt"
    if not p.exists():
        p.write_text(http_text(f"{REPO}/resolve/main/spk-info.txt"), encoding="utf-8")
    rows = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 4:
            rows[parts[0].strip()] = {
                "age": parts[1].strip(),
                "gender": parts[2].strip(),
                "accent": parts[3].strip(),
            }
    return rows


def load_transcripts():
    """train/content.txt -> { 文件名: 纯汉字文本 }"""
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / "content.txt"
    if not p.exists():
        print("下载转写表 content.txt …")
        p.write_text(http_text(f"{REPO}/resolve/main/train/content.txt"), encoding="utf-8")
    out = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        if "\t" not in line:
            continue
        name, rest = line.split("\t", 1)
        chars = "".join(m.group(1) for m in PAIR.finditer(rest))
        if chars:
            out[name.strip()] = chars
    return out


def list_speaker_files(spk: str):
    """列出该说话人的 wav。按体积降序——体积大 = 时长长，优先取来做参考。"""
    enc = f"train%2Fwav%2F{spk}"
    items = http_json(f"{API}/{enc}?recursive=false")
    files = [i for i in items if i.get("type") == "file" and i["path"].endswith(".wav")]
    files.sort(key=lambda i: i.get("size", 0), reverse=True)
    return [i["path"] for i in files]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--speakers", default="", help="逗号分隔的说话人 id，如 SSB0016,SSB0534")
    ap.add_argument("--from-info", action="store_true", help="按 spk-info 的条件自动挑说话人")
    ap.add_argument("--gender", default="female")
    ap.add_argument("--age", default="B,C", help="年龄段，逗号分隔：A/B/C/D")
    ap.add_argument("--accent", default="", help="口音筛选：north/south，留空不限")
    ap.add_argument("--limit", type=int, default=4, help="自动挑选时最多几个说话人")
    ap.add_argument("--per-speaker", type=int, default=3, help="每位说话人下几条")
    ap.add_argument("--out", default="refs/download", help="输出目录")
    ap.add_argument("--select-expressive", action="store_true",
                    help="按语调（F0 起伏）挑句子，拼成参考音频")
    ap.add_argument("--per-piece-min", type=float, default=4.0,
                    help="参与挑选的单句最短时长（太短 F0 统计不稳）")
    ap.add_argument("--pieces", type=int, default=3, help="每条参考音频拼几句")
    ap.add_argument("--min-seconds", type=float, default=6.0, help="拼接目标下限")
    ap.add_argument("--max-seconds", type=float, default=9.5, help="拼接目标上限")
    ap.add_argument("--gap", type=float, default=0.3, help="拼接时句间静音（秒）")
    args = ap.parse_args()

    if args.select_expressive:
        return select_expressive(
            (ROOT / args.out).resolve(),
            args.per_piece_min, args.pieces, args.min_seconds, args.max_seconds, args.gap
        )

    info = load_speaker_info()
    if args.speakers:
        speakers = [s.strip() for s in args.speakers.split(",") if s.strip()]
    else:
        ages = {a.strip() for a in args.age.split(",") if a.strip()}
        speakers = [
            k for k, v in info.items()
            if v["gender"] == args.gender
            and (not ages or v["age"] in ages)
            and (not args.accent or v["accent"] == args.accent)
        ]
        # 均匀取样：别全落在同一个年龄段/口音上
        speakers = speakers[: args.limit]

    print(f"目标说话人 {len(speakers)} 位: {' '.join(speakers)}")
    transcripts = load_transcripts()
    print(f"转写表载入 {len(transcripts)} 条")

    out_dir = (ROOT / args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    records = []

    for spk in speakers:
        meta = info.get(spk, {})
        try:
            files = list_speaker_files(spk)
        except Exception as e:
            print(f"  跳过 {spk}：列目录失败 {type(e).__name__}")
            continue

        picked = 0
        for path in files:
            if picked >= args.per_speaker:
                break
            name = Path(path).stem + ".wav"
            text = transcripts.get(name)
            if not text:
                continue  # 没有转写的不用，宁可少也不要文本对不上

            dst = out_dir / f"{spk}__{Path(path).stem}.wav"
            if dst.exists():
                picked += 1
                continue
            try:
                http_file(f"{REPO}/resolve/main/{path}", dst)
            except Exception as e:
                print(f"  下载失败 {path}: {type(e).__name__}")
                continue

            rec = {
                "speaker_id": spk,
                "age": meta.get("age", ""),
                "gender": meta.get("gender", ""),
                "accent": meta.get("accent", ""),
                "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
                "text": text,
                "source": "AISHELL-3 (Apache-2.0)",
                "hf_path": path,
            }
            records.append(rec)
            picked += 1
            print(f"  {spk} {meta.get('age','?')} {meta.get('accent','?')} -> {dst.name}  {text}")

    manifest = out_dir / "candidates.json"
    manifest.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"共取到 {len(records)} 条，清单写入 {manifest}")
    print("下一步：用 --select-expressive 挑语调起伏最大的句子拼成参考音频。")
    return 0


def select_expressive(out_dir: Path, per_piece_min: float, pieces: int,
                      target_min: float, target_max: float, gap: float) -> int:
    """按"语调起伏"挑句子，拼成一条参考音频。

    为什么按 F0 起伏挑：GPT-SoVITS 的语调是从参考音频学来的。首版用了一条
    新闻播报腔的参考，生成的台词 F0 起伏被压到 0.07~0.10（参考本身是 0.10~0.16），
    听感就是"没有语调、一板一眼"。所以这里直接挑本身起伏大的句子。
    """
    import numpy as np
    import soundfile as sf

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from prosody_stats import stats as prosody

    man = out_dir / "candidates.json"
    records = json.loads(man.read_text(encoding="utf-8-sig"))

    by_spk = {}
    for r in records:
        p = ROOT / r["file"]
        if not p.exists():
            continue
        info = sf.info(str(p))
        if info.duration < per_piece_min:
            continue  # 太短的句子 F0 统计不稳，也拼不出连贯的语调
        st = prosody(p)
        if "error" in st:
            continue
        by_spk.setdefault(r["speaker_id"], []).append((st["f0_cv"], p, r))

    made, index = 0, []
    for spk, items in sorted(by_spk.items()):
        items.sort(key=lambda x: x[0], reverse=True)
        chosen, texts, total = [], [], 0.0
        for cv, p, r in items:
            d = sf.info(str(p)).duration
            # 加上这句会超出上限就收尾。注意这里必须 break 而不是 continue：
            # 列表按起伏降序，后面的句子只会更长，continue 会让循环一直空转，
            # 累计时长永远停在第一句（之前就是这个 bug 导致只拼出 5.6 秒）。
            if chosen and total + d > target_max:
                break
            chosen.append((p, d, cv, r))
            texts.append(r["text"])
            total += d + gap
            # 句数只是软上限：宁可多拼一句凑够时长，也不要卡在 5 秒以下
            if len(chosen) >= pieces and total >= target_min:
                break

        actual = total - gap
        if not chosen or actual < target_min:
            print(f"  {spk}: 只能凑到 {actual:.1f}s，跳过")
            continue

        parts = []
        for i, (p, _d, _cv, _r) in enumerate(chosen):
            d, sr = sf.read(str(p), dtype="float32")
            if d.ndim > 1:
                d = d.mean(axis=1)
            parts.append(d)
            if i != len(chosen) - 1:
                parts.append(np.zeros(int(sr * gap), dtype="float32"))
        merged = np.concatenate(parts)

        dst = out_dir / f"REF_{spk}.wav"
        sf.write(str(dst), merged, sr)

        meta = chosen[0][3]
        index.append({
            "speaker_id": spk,
            "age": meta.get("age", ""),
            "gender": meta.get("gender", ""),
            "accent": meta.get("accent", ""),
            "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
            "text": "，".join(texts),
            "duration": round(len(merged) / sr, 2),
            "piece_f0_cv": [round(c, 3) for _p, _d, c, _r in chosen],
            "source": "AISHELL-3 (Apache-2.0)，挑 F0 起伏最大的 %d 句拼接" % len(chosen),
            "parts": [str(p.relative_to(ROOT)).replace("\\", "/") for p, _d, _c, _r in chosen],
        })
        print(f"  {spk}: {len(chosen)} 句 -> {len(merged) / sr:.1f}s  "
              f"起伏 {index[-1]['piece_f0_cv']}  {dst.name}")
        made += 1

    (out_dir / "expressive.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"生成 {made} 条高起伏参考音频，清单写入 {out_dir / 'expressive.json'}")
    for r in index:
        print(f"  {r['speaker_id']} {r['duration']}s  {r['text'][:50]}")
    return 0
    """把同一说话人的多条短句拼成一条够长的参考音频。

    AISHELL-3 的单句普遍只有 2~3 秒，达不到零样本参考理想的 5~10 秒。
    但同一说话人的所有句子都录在同一个安静环境、同一支麦克风下，
    按顺序拼接后听起来是连贯的，且文本可以精确拼接（不靠猜）。
    """
    import numpy as np
    import soundfile as sf

    man = out_dir / "candidates.json"
    if not man.exists():
        print("找不到 candidates.json，先跑一次下载")
        return 1
    records = json.loads(man.read_text(encoding="utf-8-sig"))

    by_spk = {}
    for r in records:
        by_spk.setdefault(r["speaker_id"], []).append(r)

    made = 0
    index = []
    for spk, items in by_spk.items():
        picked, texts, total = [], [], 0.0
        for r in items:
            p = ROOT / r["file"]
            if not p.exists():
                continue
            dur = sf.info(str(p)).duration
            if total + dur > max_seconds and picked:
                break
            picked.append(p)
            texts.append(r["text"])
            total += dur + gap
            if total >= min_seconds:
                break
        if total - gap < min_seconds or not picked:
            print(f"  {spk}: 只有 {total - gap:.1f}s，凑不到 {min_seconds:.0f}s，跳过")
            continue

        parts = []
        for i, p in enumerate(picked):
            d, sr = sf.read(str(p), dtype="float32")
            if d.ndim > 1:
                d = d.mean(axis=1)
            parts.append(d)
            if i != len(picked) - 1:
                parts.append(np.zeros(int(sr * gap), dtype="float32"))
        merged = np.concatenate(parts)
        dur = len(merged) / sr

        dst = out_dir / f"{spk}__joined.wav"
        sf.write(str(dst), merged, sr)

        meta = next((r for r in items if True), {})
        index.append({
            "speaker_id": spk,
            "age": meta.get("age", ""),
            "gender": meta.get("gender", ""),
            "accent": meta.get("accent", ""),
            "file": str(dst.relative_to(ROOT)).replace("\\", "/"),
            "text": "，".join(texts),
            "duration": round(dur, 2),
            "source": "AISHELL-3 (Apache-2.0)，由 %d 条同说话人句子拼接" % len(picked),
            "parts": [str(p.relative_to(ROOT)).replace("\\", "/") for p in picked],
        })
        print(f"  {spk}: 拼接 {len(picked)} 条 -> {dur:.1f}s  {dst.name}")
        made += 1

    (out_dir / "joined.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"生成 {made} 条拼接参考音频，清单写入 {out_dir / 'joined.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
