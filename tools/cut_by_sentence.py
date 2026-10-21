# 按"单句"切角色片段（而不是整段时间）。
#
# 教训：一段 5~14 秒的时间里往往有两个人交替说话（例如 17:00~17:21 是柔柔和
# 苹果嘉儿在对话）。按整段切会把两个人的声音混进同一条参考音频，
# 克隆出来就是四不像。所以这里按整句时间点切，只取属于目标角色的句子。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\cut_by_sentence.py
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(r"D:\python\xiangmu\youxi1")
FFMPEG = Path(r"D:\program\GPT-SoVITS-main\ffmpeg.exe")
SRC = ROOT / "refs" / "dub" / "vocals" / "ep04_vocals.wav"
OUT = ROOT / "character_clips" / "sentences"

# 按整集转写的单句时间点归给角色。
# 时间点来自转写（客观），角色归属来自用户听辨（唯一可靠来源）。
ASSIGN = {
    "fluttershy": [
        (1020.9, 1023.4, "苹果嘉儿，谢谢你能帮我们完成"),
        (1023.4, 1025.8, "每年一次的小兔子托口普茶"),
        (1028.1, 1031.0, "最近生了很多新的小兔子宝宝"),
        (1031.0, 1033.8, "所以我的工作是请点所有新家庭"),
        (1036.1, 1037.4, "好的，不过要注意"),
        (1037.4, 1040.1, "我们要集合的是小兔子不是牛"),
        (1040.1, 1042.7, "他们很胆小，你要温柔一点点"),
    ],
    "applejack": [
        (1026.5, 1028.1, "干嘛要普茶"),
        (1033.8, 1036.1, "好的，那我们赶快开始吧"),
        (1042.7, 1046.1, "帮忙赶动物这种事，我用不着你来教"),
    ],
}

PAD = 0.12  # 前后各留一点，避免切掉起音/尾音


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    index = []
    for sp, items in ASSIGN.items():
        d = OUT / sp
        d.mkdir(parents=True, exist_ok=True)
        print(f"\n=== {sp} ===")
        for i, (a, b, text) in enumerate(items, 1):
            s = max(0.0, a - PAD)
            e = b + PAD
            name = f"{sp}_{i:02d}_{int(a)}s.wav"
            dst = d / name
            subprocess.run([
                str(FFMPEG), "-y", "-loglevel", "error",
                "-ss", f"{s:.3f}", "-to", f"{e:.3f}", "-i", str(SRC),
                "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "1", str(dst),
            ], check=False)
            if not dst.exists():
                print(f"  切失败 {a}-{b}")
                continue
            x, sr = sf.read(str(dst), dtype="int16")
            f = x.astype(np.float64) / 32768.0
            dur = len(x) / sr
            print(f"  {a:7.1f}s ({dur:4.1f}s)  peak={abs(f).max():.3f}  {text}")
            index.append({"speaker": sp, "start": a, "end": b, "dur": round(dur, 2),
                          "text": text,
                          "file": str(dst.relative_to(ROOT)).replace("\\", "/")})

    (OUT / "sentences.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n汇总：")
    for sp in ASSIGN:
        items = [r for r in index if r["speaker"] == sp]
        print(f"  {sp:<12} {len(items)} 句，合计 {sum(r['dur'] for r in items):.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
