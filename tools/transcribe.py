# 用 faster-whisper 转写参考片段，得到逐字文本（ref_text）。
#
# 为什么需要：GPT-SoVITS 要求 ref_text 与参考音频逐个字对应，手工听写几十段太累。
# ASR 先出一版，再人工核对——注意它只是"草稿"，同音字/断句仍会错，必须核对。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\transcribe.py <目录或文件> --out out.json
#   ... tools\transcribe.py refs/dub/segs --limit 5           # 先试几条看准确度
import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 中文配音用 small 足够；要更准可换 medium/large-v3（更慢、更大）
DEFAULT_MODEL = "small"


def register_cuda_dlls():
    """把 torch 自带的 CUDA 运行库加进 DLL 搜索路径。

    踩过的坑：faster-whisper 底层是 CTranslate2，它会加载 cublas64_12.dll，
    而这份 DLL 由 torch 提供（site-packages/torch/lib），并不在系统 PATH 上，
    于是报 "Library cublas64_12.dll is not found"。torch 自己 import 时会处理这件事，
    但 CTranslate2 不会，所以必须手动注册。
    """
    import os
    import sys

    lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
    if not lib.exists():
        print(f"警告：找不到 torch/lib（{lib}），GPU 推理可能失败")
        return
    if hasattr(os, "add_dll_directory"):
        os.add_dll_directory(str(lib))
    os.environ["PATH"] = str(lib) + os.pathsep + os.environ.get("PATH", "")
    print(f"已注册 CUDA 库目录: {lib}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="音频文件或目录")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--out", default="refs/dub/segs/transcripts.json")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--language", default="zh")
    args = ap.parse_args()

    t = Path(args.target)
    if not t.is_absolute():
        t = ROOT / t
    if t.is_dir():
        # 只取切出来的片段。标注页为了能回听上下文，会在同目录放一份整集人声，
        # rglob("*.wav") 会把它也抓进来——整集 1300 秒，转写一次要 40 秒且毫无意义。
        files = sorted(t.glob("seg*.wav"))
        if not files:
            files = sorted(t.rglob("*.wav"))
    else:
        files = [t]
    if args.limit:
        files = files[: args.limit]
    if not files:
        print("没找到音频")
        return 1
    print(f"待转写 {len(files)} 条")

    register_cuda_dlls()
    from faster_whisper import WhisperModel

    print(f"加载 whisper {args.model} …（首次会下载模型）")
    t0 = time.time()
    try:
        model = WhisperModel(args.model, device="cuda", compute_type="float16")
    except Exception as e:
        # CUDA 库不齐时退回 CPU，慢但能用，不让整件事卡死
        print(f"GPU 加载失败（{type(e).__name__}: {e}），回退 CPU int8")
        model = WhisperModel(args.model, device="cpu", compute_type="int8")
    print(f"模型就绪 {time.time() - t0:.1f}s")

    out = []
    for i, p in enumerate(files, 1):
        t1 = time.time()
        segments, info = model.transcribe(
            str(p), language=args.language, beam_size=5,
            vad_filter=False, condition_on_previous_text=False,
        )
        text = "".join(s.text for s in segments).strip()
        rec = {
            "file": str(p),
            "text": text,
            "duration": round(info.duration, 2),
            "lang_prob": round(info.language_probability, 3),
            "seconds": round(time.time() - t1, 2),
        }
        out.append(rec)
        print(f"[{i}/{len(files)}] {p.name}  {rec['duration']}s  {rec['seconds']}s  {text}")

    dst = Path(args.out)
    if not dst.is_absolute():
        dst = ROOT / dst
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n转写结果 -> {dst}")
    print("提醒：ASR 只是草稿，ref_text 必须与音频逐字一致，请务必核对后再用于生成。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
