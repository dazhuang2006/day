# 用 UVR5 的 HP2 模型把整集配音分出人声（去掉背景音乐与音效）。
#
# 为什么不走 tools/uvr5/webui.py：那个模块顶层就 import gradio（它是个 WebUI），
# 加载极慢甚至卡死。这里直接实例化底层的 AudioPre 类，只依赖 torch 与 vendored 的 lib_v5。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\separate_vocals.py <输入.wav> <输出目录>
import sys
import os
import time
from pathlib import Path

SOVITS = Path(r"D:\program\GPT-SoVITS-main")
sys.path.insert(0, str(SOVITS / "tools" / "uvr5"))
os.chdir(SOVITS)

import torch  # noqa: E402
from vr import AudioPre  # noqa: E402

MODEL = SOVITS / "tools" / "uvr5" / "uvr5_weights" / "HP2_all_vocals.pth"
WORKSPACE = Path(r"D:\python\xiangmu\youxi1")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    # 注意：上面已经 os.chdir 到了 GPT-SoVITS 目录，所以这里必须把参数解析成
    # **绝对路径**再往下传。否则相对路径会落到 GPT-SoVITS 那边去（踩过一次）。
    src = Path(sys.argv[1])
    out_root = Path(sys.argv[2])
    if not src.is_absolute():
        src = WORKSPACE / src
    if not out_root.is_absolute():
        out_root = WORKSPACE / out_root
    src = src.resolve()
    out_root = out_root.resolve()
    if not src.exists():
        print(f"找不到输入: {src}")
        return 1
    if not MODEL.exists():
        print(f"找不到模型: {MODEL}")
        return 1

    out_root.mkdir(parents=True, exist_ok=True)
    vocal_root = out_root / "vocals"
    ins_root = out_root / "instrumental"
    vocal_root.mkdir(exist_ok=True)
    ins_root.mkdir(exist_ok=True)

    # 输出目录必须在 cwd 下，否则 uv r5 内部会把它当成路径拼接出问题
    device = "cuda" if torch.cuda.is_available() else "cpu"
    is_half = device == "cuda"
    print(f"设备 {device}  半精度 {is_half}  模型 {MODEL.name}")
    print(f"输入 {src}  ({src.stat().st_size / 1048576:.1f} MB)")

    t0 = time.time()
    pre = AudioPre(agg=10, model_path=str(MODEL), device=device, is_half=is_half)
    print(f"模型加载 {time.time() - t0:.1f}s")

    t1 = time.time()
    # 注意参数顺序：ins_root 在前，vocal_root 在后
    pre._path_audio_(
        str(src),
        ins_root=str(ins_root),
        vocal_root=str(vocal_root),
        format="wav",
        is_hp3=False,
    )
    print(f"分离耗时 {time.time() - t1:.1f}s")

    for d in (vocal_root, ins_root):
        for f in sorted(d.iterdir()):
            print(f"  {d.name}/{f.name}  {f.stat().st_size / 1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
