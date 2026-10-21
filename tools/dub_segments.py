# 从整集配音里切出候选参考片段，并生成一个能直接播放的标注页面。
#
# 流程位置：先把视频音轨抽成 wav（ffmpeg），再用 UVR5 分出人声，
# 然后本脚本把人声按"语音段"切开，过滤掉太短/太轻/静音的，
# 输出候选片段 + 一个 HTML 标注页（引用 wav + 角色输入框）。
#
# 为什么需要人工标注：谁在说话只有耳朵能判断，程序只看得到音高和时长。
# 标注页让你边听边填，填完导出 JSON，我再据此给每位角色生成配音。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\dub_segments.py <人声.wav> --out refs\dub\segs
import argparse
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

TOP_DB = 32      # 低于峰值这么多 dB 视为静音
MIN_SEG = 2.0    # 太短不适合做参考
MAX_SEG = 12.0   # 太长切一刀，避免超出模型 3~10 秒限制
PAD = 0.25       # 前后留一点，避免切掉起音


def detect_speech(y: np.ndarray, sr: int):
    """能量法找语音段，返回 [(start_sec, end_sec), ...]"""
    intervals = librosa.effects.split(y, top_db=TOP_DB, frame_length=2048, hop_length=512)
    segs = []
    for a, b in intervals:
        start = max(0.0, a / sr - PAD)
        end = min(len(y) / sr, b / sr + PAD)
        if end - start < MIN_SEG:
            continue
        while end - start > MAX_SEG:
            segs.append((start, start + MAX_SEG))
            start += MAX_SEG
        segs.append((start, end))
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] < 0.45:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def analyse(y: np.ndarray, sr: int, seg):
    """给一个语音段算特征，用于排序和初筛。"""
    a, b = int(seg[0] * sr), int(seg[1] * sr)
    clip = y[a:b]
    if len(clip) == 0:
        return None
    dur = len(clip) / sr
    rms = float(np.sqrt(np.mean(clip ** 2)))
    peak = float(np.abs(clip).max())
    f0, voiced, _ = librosa.pyin(clip, fmin=70, fmax=500, sr=sr, frame_length=1024, hop_length=160)
    f0v = f0[~np.isnan(f0)]
    vr = float(np.mean(voiced)) if len(voiced) else 0.0
    if len(f0v) < 5 or vr < 0.25:
        return None  # 有效语音太少，评估不了
    return {
        "start": round(seg[0], 2),
        "end": round(seg[1], 2),
        "dur": round(dur, 2),
        "rms": round(rms, 5),
        "peak": round(peak, 4),
        "voiced_ratio": round(vr, 3),
        "f0_mean": round(float(np.mean(f0v)), 1),
        "f0_cv": round(float(np.std(f0v) / np.mean(f0v)), 3),
    }


def write_html(records, out_html: Path, audio_path: Path):
    """生成标注页：每行一个独立的小片段音频 + 角色输入框 + 导出按钮。

    踩过的坑：最初让整个页面共用一个 <audio> 去加载**整集人声**（200MB+）再 seek 到
    片段位置。浏览器在 file:// 下处理这种巨型 wav 会直接播放失败，表现就是"点了没声音"。
    改成每行直接引用自己的小 wav（几十 KB），既快又稳。
    """
    payload = json.dumps(records, ensure_ascii=False)
    html = """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>配音片段标注</title>
<style>
 body{font-family:"Microsoft YaHei",sans-serif;background:#faf7fb;color:#3a2f45;margin:0;padding:22px}
 h1{font-size:19px;margin:0 0 6px} .hint{color:#7a6b86;font-size:13px;line-height:1.7}
 kbd{background:#f0e8f6;border:1px solid #d9c9e6;border-radius:4px;padding:0 5px;font-size:12px}
 .legend{margin:10px 0 6px;font-size:13px}
 .legend b{color:#c9458f}
 .row{background:#fff;border:1px solid #eadff2;border-radius:10px;padding:8px 12px;margin-bottom:6px;
      display:flex;align-items:center;gap:9px;flex-wrap:wrap}
 .idx{width:34px;color:#a58fb8;font-size:13px;flex:none}
 .meta{font-size:12px;color:#7a6b86;width:150px;flex:none}
 audio{height:30px;width:260px}
 select{border:1px solid #d9c9e6;border-radius:6px;padding:4px 6px;font-size:13px;background:#fff}
 .st-starberry{background:#fdeef6;border-color:#f2b8d8}
 .st-twilight{background:#f1ecfb;border-color:#c9b6ea}
 .st-fluttershy{background:#fff0f8;border-color:#f7c8e4}
 .st-applejack{background:#fdf3e7;border-color:#eec89b}
 .st-rainbow{background:#eef6fe;border-color:#a9cfef}
 .st-rarity{background:#f6f0fb;border-color:#d3bde9}
 .st-pinkie{background:#fdeef4;border-color:#f5aecd}
 .st-other{background:#f4f4f4;border-color:#ccc}
 .st-skip{background:#f7f3ee;border-color:#ddd0c2}
 .bar{position:sticky;top:0;background:#faf7fb;padding:8px 0 10px;z-index:5;border-bottom:1px solid #eee}
 button{border:0;border-radius:6px;padding:7px 12px;background:#c9458f;color:#fff;font-size:13px;cursor:pointer}
 button.sec{background:#8a7a99}
 #out{width:100%;height:130px;font-family:Consolas,monospace;font-size:12px;margin-top:8px}
</style></head><body>
<h1>标注：每个片段是谁在说话</h1>
<div class="hint">
 每行自带播放器，点 ▶ 就能听。听完用下拉框选人，或者直接按数字键
 <kbd>1</kbd>~<kbd>7</kbd> / <kbd>8</kbd> / <kbd>9</kbd>（选完自动跳到下一条，可以一路听一路按）。<br>
 选完点「导出标注 JSON」，把文本框内容发我。中途关掉不会丢，浏览器本地有存。
</div>
<div class="legend">
 <b>1</b> 星莓 &nbsp; <b>2</b> 紫悦 &nbsp; <b>3</b> 柔柔 &nbsp; <b>4</b> 苹果嘉儿 &nbsp;
 <b>5</b> 云宝 &nbsp; <b>6</b> 珍奇 &nbsp; <b>7</b> 碧琪 &nbsp;&nbsp;|&nbsp;&nbsp;
 <b>8</b> 非主角（不要） &nbsp; <b>9</b> 唱歌/听不清 &nbsp; <b>0</b> 清除
</div>
<div class="bar">
 已标注 <b id="cnt">0</b> / __COUNT__
 <button onclick="exportJson()">导出标注 JSON</button>
 <button class="sec" onclick="clearAll()">清空</button>
</div>
<div id="list" style="margin-top:10px"></div>
<textarea id="out" placeholder="点「导出标注 JSON」，结果会出现在这里，复制发我"></textarea>
<script>
// 显示名 -> 内部代号。内部代号只用于 assets/audio/voice 下的子目录名。
const ROLES = [
  { cn: '星莓',     key: 'starberry',  digit: '1' },
  { cn: '紫悦',     key: 'twilight',   digit: '2' },
  { cn: '柔柔',     key: 'fluttershy', digit: '3' },
  { cn: '苹果嘉儿', key: 'applejack',  digit: '4' },
  { cn: '云宝',     key: 'rainbow',    digit: '5' },
  { cn: '珍奇',     key: 'rarity',     digit: '6' },
  { cn: '碧琪',     key: 'pinkie',     digit: '7' },
  { cn: '非主角（不要）', key: 'other', digit: '8' },
  { cn: '唱歌/听不清',   key: 'skip',  digit: '9' }
];
const RECS = __PAYLOAD__;
const saved = JSON.parse(localStorage.getItem('dubLabels') || '{}');
const list = document.getElementById('list');
const selects = [];

RECS.forEach((r, i) => {
  const row = document.createElement('div');
  row.className = 'row';
  const name = r.file.split('/').pop();
  const opts = ['<option value="">— 未选 —</option>']
    .concat(ROLES.map(x => '<option value="' + x.key + '"' +
      (saved[i] === x.key ? ' selected' : '') + '>' + x.cn + '</option>'))
    .join('');
  row.innerHTML = '<span class="idx">' + (i + 1) + '</span>' +
    '<audio controls preload="none" src="' + name + '"></audio>' +
    '<span class="meta">' + name + ' · ' + r.dur + 's' +
    '<br>音高 ' + r.f0_mean + 'Hz · 起伏 ' + r.f0_cv + '</span>' +
    '<select data-i="' + i + '">' + opts + '</select>';
  list.appendChild(row);
  const sel = row.querySelector('select');
  selects.push(sel);
  sel.addEventListener('change', () => {
    paint(row, sel.value);
    save();
    refresh();
  });
});

function paint(row, key) {
  row.className = 'row' + (key ? ' st-' + key : '');
}
function save() {
  const labels = {};
  selects.forEach((s, i) => { if (s.value) labels[i] = s.value; });
  localStorage.setItem('dubLabels', JSON.stringify(labels));
}
function setAt(i, key) {
  if (i < 0 || i >= selects.length) return;
  selects[i].value = key;
  paint(selects[i].closest('.row'), key);
  save();
  refresh();
}
function refresh() {
  document.getElementById('cnt').textContent = selects.filter(s => s.value).length;
}
// 键盘：数字键选人并自动跳下一条
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'TEXTAREA') return;
  const idx = selects.indexOf(document.activeElement);
  if (e.key === '0') { if (idx >= 0) { setAt(idx, ''); e.preventDefault(); } return; }
  const role = ROLES.find(x => x.digit === e.key);
  if (role) {
    const target = idx >= 0 ? idx : 0;
    setAt(target, role.key);
    const next = selects[target + 1];
    if (next) next.focus();
    e.preventDefault();
  }
});
function exportJson() {
  save();
  const merged = RECS.map((r, i) => Object.assign({}, r, { speaker: selects[i].value || null }));
  document.getElementById('out').value = JSON.stringify(merged.filter(x => x.speaker), null, 1);
}
function clearAll() {
  if (!confirm('清空所有标注？')) return;
  localStorage.removeItem('dubLabels');
  selects.forEach(s => { s.value = ''; paint(s.closest('.row'), ''); });
  refresh();
}
selects.forEach(s => paint(s.closest('.row'), s.value));
refresh();
</script></body></html>"""
    html = html.replace("__PAYLOAD__", payload).replace("__COUNT__", str(len(records)))
    out_html.write_text(html, encoding="utf-8")


def report(seg_dir: Path) -> int:
    """把候选片段与转写文本合成一张对照表，方便人工核对与标注。"""
    segs = json.loads((seg_dir / "segments.json").read_text(encoding="utf-8-sig"))
    tr_path = seg_dir / "transcripts.json"
    trans = {}
    if tr_path.exists():
        trans = {
            Path(r["file"]).name: r
            for r in json.loads(tr_path.read_text(encoding="utf-8-sig"))
        }
    merged = []
    print(f"{'片段':<11}{'时长':>6}{'F0':>7}{'起伏':>7}  转写草稿")
    print("-" * 96)
    for s in segs:
        name = Path(s["file"]).name
        t = trans.get(name, {})
        text = t.get("text", "")
        merged.append({**s, "text": text})
        print(f"{name:<11}{s['dur']:>5.2f}s{s['f0_mean']:>7.0f}{s['f0_cv']:>7.2f}  {text[:52]}")
    out = seg_dir / "segments_with_text.json"
    out.write_text(json.dumps(merged, ensure_ascii=False, indent=1), encoding="utf-8")
    print("-" * 96)
    print(f"共 {len(merged)} 条；合并结果 -> {out}")
    print("提醒：转写只是草稿（同音字、断句会错），ref_text 必须与音频逐字一致。")
    return 0


def emit_references(labels_path: Path, seg_dir: Path, out_dir: Path,
                    min_dur: float, max_dur: float) -> int:
    """按标注结果，为每位角色合成一条参考音频。

    输入是标注页导出的 JSON（含 speaker 字段）。每条候选都已经是干净人声，
    所以这里只做：挑时长合适的、按语调起伏排序、取最好的几句拼起来。
    """
    import numpy as np
    import soundfile as sf

    recs = json.loads(labels_path.read_text(encoding="utf-8-sig"))
    # 只有这七位才用来做参考音频。标注页里的「非主角（不要）」「唱歌/听不清」
    # 分别导出为 other / skip，这里统一排除——它们不是要配音的角色。
    VALID = {"starberry", "twilight", "fluttershy", "applejack", "rainbow", "rarity", "pinkie"}
    by_spk = {}
    ignored = {}
    for r in recs:
        sp = (r.get("speaker") or "").strip()
        if not sp:
            continue
        if sp not in VALID:
            ignored[sp] = ignored.get(sp, 0) + 1
            continue
        p = seg_dir / Path(r["file"]).name
        if not p.exists():
            continue
        dur = sf.info(str(p)).duration
        if dur < min_dur or dur > max_dur:
            continue
        by_spk.setdefault(sp, []).append((r.get("f0_cv", 0), p, r))

    if ignored:
        print("已排除的标注:", ", ".join(f"{k} {v} 条" for k, v in sorted(ignored.items())))

    out_dir.mkdir(parents=True, exist_ok=True)
    index = []
    for sp, items in sorted(by_spk.items()):
        items.sort(key=lambda x: x[0], reverse=True)
        chosen, total = [], 0.0
        for cv, p, r in items:
            d = sf.info(str(p)).duration
            if chosen and total + d > 9.5:
                break
            chosen.append(p)
            total += d + 0.25
            if total >= 6.0:
                break
        if not chosen:
            print(f"  {sp}: 没有合适时长的片段（需要 {min_dur}~{max_dur}s），跳过")
            continue

        parts = []
        for i, p in enumerate(chosen):
            y, sr = sf.read(str(p), dtype="float32")
            if y.ndim > 1:
                y = y.mean(axis=1)
            parts.append(y)
            if i != len(chosen) - 1:
                parts.append(np.zeros(int(sr * 0.25), dtype="float32"))
        merged = np.concatenate(parts)

        dst = out_dir / f"{sp}.wav"
        sf.write(str(dst), merged, sr)
        index.append({
            "speaker": sp,
            "file": str(dst),
            "duration": round(len(merged) / sr, 2),
            "from_segments": [p.name for p in chosen],
            "source": "本集中文配音，经 UVR5 人声分离",
        })
        print(f"  {sp}: {len(chosen)} 段 -> {len(merged) / sr:.1f}s  {dst.name}")

    (out_dir / "references.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\n生成 {len(index)} 位角色的参考音频 -> {out_dir}")
    missing = [s for s in ("starberry", "twilight", "fluttershy", "applejack",
                           "rainbow", "rarity", "pinkie") if s not in by_spk]
    if missing:
        print("还没标注到的角色:", " ".join(missing))
    print("注意：参考音频的逐字文本需要你提供（听写），模型要求 ref_text 与音频逐个字对应。")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("vocal_wav", nargs="?", default="", help="分离后的人声 wav（整集）")
    ap.add_argument("--out", default="refs/dub/segs", help="输出目录")
    ap.add_argument("--min-f0", type=float, default=120.0,
                    help="低于此基频视为非目标人声（男声/音效）")
    ap.add_argument("--limit", type=int, default=80, help="最多产出多少个候选")
    ap.add_argument("--emit", metavar="标注JSON",
                    help="按标注结果生成各角色的参考音频（跳过切片段步骤）")
    ap.add_argument("--report", action="store_true",
                    help="把候选片段与转写文本合成对照表，方便核对")
    ap.add_argument("--regen-page", action="store_true",
                    help="只用已有 segments.json 重新生成标注页（不重新分析音频）")
    ap.add_argument("--min-dur", type=float, default=2.5, help="合成参考时接受的片段最短时长")
    ap.add_argument("--max-dur", type=float, default=8.0, help="合成参考时接受的片段最长时长")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    out_dir = (root / args.out).resolve()

    if args.report:
        return report(out_dir)

    if args.regen_page:
        segs = json.loads((out_dir / "segments.json").read_text(encoding="utf-8-sig"))
        write_html(segs, out_dir / "label.html", out_dir / "ep04_vocals.wav")
        print(f"已重新生成标注页: {out_dir / 'label.html'}（{len(segs)} 个片段）")
        return 0

    if args.emit:
        labels = Path(args.emit)
        if not labels.is_absolute():
            labels = root / labels
        if not labels.exists():
            print(f"找不到标注文件: {labels}")
            return 1
        return emit_references(labels, out_dir, (root / "refs" / "dub" / "refs").resolve(),
                               args.min_dur, args.max_dur)

    src = Path(args.vocal_wav)
    if not args.vocal_wav:
        print("需要给出人声 wav 路径（或用 --emit 走标注流程）")
        return 1
    if not src.is_absolute():
        src = root / src
    if not src.exists():
        print(f"找不到人声文件: {src}")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"读取 {src.name} …")
    y, sr = librosa.load(str(src), sr=None, mono=True)
    print(f"{len(y) / sr:.1f} 秒 / {sr} Hz")

    segs = detect_speech(y, sr)
    print(f"检测到 {len(segs)} 个语音段，开始分析 …")

    recs = []
    for seg in segs:
        info = analyse(y, sr, seg)
        if not info:
            continue
        if info["f0_mean"] < args.min_f0:
            continue  # 基频太低，多半是男声或音效
        recs.append(info)

    # 起伏大的排前面：语调越丰富越适合当参考
    recs.sort(key=lambda r: r["f0_cv"], reverse=True)
    recs = recs[: args.limit]

    print(f"通过初筛 {len(recs)} 段，写出音频片段 …")
    for i, r in enumerate(recs):
        a, b = int(r["start"] * sr), int(r["end"] * sr)
        name = f"seg{i + 1:03d}.wav"
        sf.write(str(out_dir / name), y[a:b], sr)
        r["file"] = str((out_dir / name).relative_to(root)).replace("\\", "/")

    (out_dir / "segments.json").write_text(
        json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    # 标注页引用整集人声（放在同目录），方便随时回听上下文
    whole = out_dir / src.name
    if not whole.exists():
        sf.write(str(whole), y, sr)
    write_html(recs, out_dir / "label.html", whole)

    print(f"\n候选片段 {len(recs)} 个 -> {out_dir}")
    print(f"标注页: {out_dir / 'label.html'}（浏览器直接打开）")
    print("标完点「导出标注 JSON」，把文本框内容发我。")
    for r in recs[:5]:
        print(f"  例: {Path(r['file']).name}  {r['start']}s~{r['end']}s  {r['dur']}s  "
              f"F0 {r['f0_mean']}Hz 起伏 {r['f0_cv']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
