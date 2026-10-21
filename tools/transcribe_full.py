# 转写整集人声，带时间戳，用来定位某个角色出现在第几秒。
#
# 为什么需要：候选片段只覆盖了部分语音，且按音高起伏排序，
# 想知道"柔柔有没有出场、在第几秒"，必须看全文。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\transcribe_full.py <人声.wav> --out refs/dub/full_text.json
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def register_cuda_dlls():
    """CTranslate2 需要 torch 自带的 cublas，见 transcribe.py 里的说明。"""
    lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
    if lib.exists():
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(str(lib))
        os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--out", default="refs/dub/full_text.json")
    ap.add_argument("--model", default="small")
    args = ap.parse_args()

    src = Path(args.wav)
    if not src.is_absolute():
        src = ROOT / src
    if not src.exists():
        print(f"找不到: {src}")
        return 1

    register_cuda_dlls()
    from faster_whisper import WhisperModel

    print(f"加载 whisper {args.model} …")
    try:
        model = WhisperModel(args.model, device="cuda", compute_type="float16")
    except Exception as e:
        print(f"GPU 失败（{type(e).__name__}），回退 CPU")
        model = WhisperModel(args.model, device="cpu", compute_type="int8")

    print(f"开始转写 {src.name}（{src.stat().st_size / 1048576:.0f} MB）…")
    segments, info = model.transcribe(
        str(src), language="zh", beam_size=5, vad_filter=True,
        condition_on_previous_text=False,
    )
    rows = []
    for s in segments:
        rows.append({"start": round(s.start, 2), "end": round(s.end, 2),
                     "dur": round(s.end - s.start, 2), "text": s.text.strip()})
        if len(rows) % 50 == 0:
            print(f"  已转写 {len(rows)} 句 … 当前 {s.end:.0f}s")

    dst = ROOT / args.out
    dst.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"共 {len(rows)} 句 -> {dst}")

    print("\n角色名出现位置：")
    for cn in ["柔柔", "小蝶", "苹果嘉儿", "苹果佳儿", "苹果家", "紫悦", "云宝", "珍奇", "碧琪", "斯派克"]:
        hits = [r for r in rows if cn in r["text"]]
        if hits:
            print(f"  {cn}: {len(hits)} 处")
            for h in hits[:4]:
                print(f"     {h['start']:.0f}s~{h['end']:.0f}s  {h['text'][:40]}")
        else:
            print(f"  {cn}: 未出现")
    return 0


if __name__ == "__main__":
    sys.exit(main())
