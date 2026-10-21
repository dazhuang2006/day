# 每个角色的切片各自合成为一个视频文件。
#
# 做法（两步，比一条超长 filter_complex 可靠）：
#   1. 逐段用 -ss/-to 从源视频抽取"画面+声音"，统一重编码；
#   2. 同一角色的中间文件用 concat demuxer 拼起来。
# 拼接要求各段编码参数完全一致，所以第 1 步必须重编码，不能直接 copy
# （源是 h264 且关键帧位置不齐，copy 会导致拼接处花屏）。
#
# 关于编码器：GPT-SoVITS 自带的 ffmpeg **没有编译 libx264**（报 Unknown encoder），
# 只带硬件编码器。本机 RTX 4060 实测 h264_nvenc 可用，且远快于软件编码。
#
# 用法：
#   python tools\build_clip_video.py            # 每个角色一个视频
#   python tools\build_clip_video.py --crf 20   # 画质更好、文件更大
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
FFMPEG = Path(r"D:\program\GPT-SoVITS-main\ffmpeg.exe")
SRC = Path(r"D:\move\1_小马宝莉_友谊的魔法_第一季_中文配音_04_1080P_高码率_AVC.mp4")
CLIPS = ROOT / "character_clips_v2" / "clips.json"
WORK = ROOT / "character_clips_v2" / "video_parts"
OUTDIR = ROOT / "character_clips_v2" / "videos"


def run(cmd, desc=""):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(f"  失败 {desc}: {r.stderr.decode('utf-8', 'ignore')[-300:]}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--crf", type=int, default=23, help="画质，越小越好越大文件")
    args = ap.parse_args()

    if not SRC.exists():
        print(f"源视频不存在: {SRC}")
        return 1
    clips = json.loads(CLIPS.read_text(encoding="utf-8-sig"))
    WORK.mkdir(parents=True, exist_ok=True)
    OUTDIR.mkdir(parents=True, exist_ok=True)

    # 按角色分组，组内按原片时间排序
    groups = {}
    for c in clips:
        groups.setdefault((c["speaker"], c["speaker_cn"]), []).append(c)
    for items in groups.values():
        items.sort(key=lambda x: x["start"])

    # 先清掉上一次的中间产物，避免把旧片段混进来
    for f in WORK.glob("*.mp4"):
        f.unlink()

    made = []
    for (sp, cn), items in sorted(groups.items(), key=lambda kv: kv[0][1]):
        total = sum(c["dur"] for c in items)
        print(f"\n=== {cn}：{len(items)} 段，共 {total:.1f} 秒 ===")
        parts = []
        for i, c in enumerate(items, 1):
            name = f"{sp}_{i:02d}_{c['span'].replace(':', 'm')}.mp4"
            dst = WORK / name
            t0 = time.time()
            ok = run([
                str(FFMPEG), "-y", "-loglevel", "error",
                "-ss", str(c["start"]), "-to", str(c["end"]), "-i", str(SRC),
                "-c:v", "h264_nvenc", "-preset", "medium", "-pix_fmt", "yuv420p",
                "-rc", "vbr", "-cq", str(args.crf), "-b:v", "0",
                "-r", "25", "-vsync", "cfr",
                "-g", "50", "-keyint_min", "25", "-sc_threshold", "0",
                "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
                "-avoid_negative_ts", "make_zero", "-fflags", "+genpts",
                str(dst),
            ], name)
            if not ok:
                continue
            print(f"  [{i}/{len(items)}] {c['span']:>13} {c['dur']:5.2f}s  "
                  f"{dst.stat().st_size / 1048576:5.2f} MB  {time.time() - t0:.1f}s")
            parts.append(dst)

        if not parts:
            print(f"  {cn}: 没有可用片段，跳过")
            continue

        lst = WORK / f"concat_{sp}.txt"
        lst.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
        out = OUTDIR / f"{cn}.mp4"
        # 拼接后统一重编码，而不是 -c copy：
        # copy 时各段的时基不一致，实测会让 25fps 的输出变成 50fps（帧被重复）。
        # 重编码一遍能保证帧率和时基干净一致，代价很小（GPU 编码）。
        ok = run([
            str(FFMPEG), "-y", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c:v", "h264_nvenc", "-preset", "medium", "-pix_fmt", "yuv420p",
            "-rc", "vbr", "-cq", str(args.crf), "-b:v", "0",
            "-r", "25", "-vsync", "cfr",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            "-movflags", "+faststart", str(out),
        ], f"concat {cn}")
        if ok:
            print(f"  -> {out.name}  {out.stat().st_size / 1048576:.1f} MB")
            made.append({"speaker": sp, "speaker_cn": cn, "file": str(out),
                         "segments": len(parts), "duration": round(total, 2)})

    (OUTDIR / "videos.json").write_text(
        json.dumps(made, ensure_ascii=False, indent=1), encoding="utf-8")

    print(f"\n{'=' * 60}\n共生成 {len(made)} 个视频 -> {OUTDIR}\n{'=' * 60}")
    for m in made:
        print(f"  {m['speaker_cn']:<8} {m['segments']} 段  {m['duration']:6.1f}s  "
              f"{(Path(m['file']).stat().st_size / 1048576):5.1f} MB  {Path(m['file']).name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
