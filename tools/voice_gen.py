# 用 GPT-SoVITS 为游戏台词批量生成配音。
#
# 前置：
#   1. 跑过 tools/extract-lines.mjs，存在 voice_manifest.json
#   2. 填好 voice_refs.json，参考音频放进 refs/
#
# 用法（必须用 GPTSoVits 环境的解释器）：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\voice_gen.py --limit 3
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\voice_gen.py
#
# 产物：assets/audio/voice/<角色>/<台词id>.mp3
#       assets/audio/voice/index.json（游戏启动时读它，只加载真实存在的文件）
#
# 已生成的文件默认跳过（可加 --force 重跑），所以中断后可以直接再跑。
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent          # 游戏项目根目录
SOVITS = Path(r"D:\program\GPT-SoVITS-main")           # GPT-SoVITS 项目
sys.path.insert(0, str(SOVITS))
os.chdir(SOVITS)

OUT_DIR = ROOT / "assets" / "audio" / "voice"
MANIFEST = ROOT / "voice_manifest.json"
REFS = ROOT / "voice_refs.json"

GPT_PATH = SOVITS / "GPT_SoVITS" / "pretrained_models" / "s1v3.ckpt"
SOVITS_PATH = SOVITS / "GPT_SoVITS" / "pretrained_models" / "v2Pro" / "s2Gv2ProPlus.pth"


def load_modules():
    global change_gpt_weights, change_sovits_weights, get_tts_wav
    import torch  # noqa: F401

    from GPT_SoVITS.inference_webui import (
        change_gpt_weights,
        change_sovits_weights,
        get_tts_wav,
    )


def to_pcm16(audio) -> "np.ndarray":
    """把 get_tts_wav 的输出统一成连续的 int16 数组。

    注意：get_tts_wav 返回的**已经是 int16**（例如 -8463~8263）。
    早期版本又乘了一次 32767，整数回绕导致爆音削波——所以这里必须按 dtype 分支，
    不能无条件当浮点处理。
    """
    import numpy as np

    arr = np.asarray(audio)
    if arr.dtype == np.int16:
        return np.ascontiguousarray(arr)
    if np.issubdtype(arr.dtype, np.integer):
        # 其他位宽的整数：按比例放到 int16
        info = np.iinfo(arr.dtype)
        scale = 32767.0 / max(abs(info.min), info.max)
        return (arr.astype(np.float64) * scale).round().clip(-32768, 32767).astype("<i2")
    # 浮点：约定范围是 [-1, 1]
    return (np.clip(arr.astype(np.float64), -1.0, 1.0) * 32767.0).round().astype("<i2")


PAREN = re.compile(r"^[（(][^）)]*[）)]\s*")


def clean_text(text: str) -> str:
    """把台词整理成适合朗读的形式。

    游戏里的台词带着演出提示，比如「（气声）碧琪！」，括号里的内容不能念出来。
    破折号全角省略号这类符号读起来也怪，换成语调停顿更自然的标点。
    """
    t = PAREN.sub("", text.strip())
    t = t.replace("——", "，").replace("……", "…")
    t = re.sub(r"[「」『』]", "", t)
    t = re.sub(r"\s+", "", t)
    return t.strip()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只生成前 N 条（试听用）")
    ap.add_argument("--speaker", default="", help="只生成某个角色")
    ap.add_argument("--force", action="store_true", help="已存在的文件也重新生成")
    ap.add_argument(
        "--out-dir",
        default="",
        help="改写到别的目录（验证整条流水线时很有用，不影响 assets 下的正式资源）",
    )
    args = ap.parse_args()

    out_dir = Path(args.out_dir).resolve() if args.out_dir else OUT_DIR

    # utf-8-sig：用户在记事本 / PowerShell 里存过就会带 BOM，直接 utf-8 读会报错
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    refs = json.loads(REFS.read_text(encoding="utf-8-sig"))

    speakers = refs.get("speakers", {})
    ready = {k: v for k, v in speakers.items() if v.get("ref_audio") and v.get("ref_text")}
    if not ready:
        print("voice_refs.json 里还没有任何填好的参考音频，先填 ref_audio 与 ref_text。")
        return 1

    # 先把参考音频路径解析好并校验存在性。
    # （不能等到生成循环里才发现缺失：那里再 pop 会留下悬空引用，
    #   所以校验一律提前，缺文件的角色整体跳过。）
    for sp in list(ready):
        raw = Path(ready[sp]["ref_audio"])
        path = raw if raw.is_absolute() else ROOT / raw
        if path.exists():
            ready[sp]["_path"] = path
        else:
            print(f"参考音频不存在，跳过角色 {sp}: {path}")
            ready.pop(sp)
    if not ready:
        print("没有任何可用的参考音频。")
        return 1

    print(f"可生成的角色 {len(ready)} 个:", " ".join(ready))
    missing = [k for k in speakers if k not in ready]
    if missing:
        print("尚未配置（会跳过）:", " ".join(missing))

    load_modules()
    print("加载权重…")
    t0 = time.time()
    change_gpt_weights(gpt_path=str(GPT_PATH))
    change_sovits_weights(sovits_path=str(SOVITS_PATH))
    print(f"权重就绪 {time.time() - t0:.1f}s")

    # 参考音频一次加载一角色，避免每句都重读磁盘
    todo = []
    for line in manifest["lines"]:
        sp = line["speaker"]
        if sp not in ready:
            continue
        if args.speaker and sp != args.speaker:
            continue
        target = out_dir / sp / f"{line['id']}.mp3"
        if target.exists() and not args.force:
            continue
        text = clean_text(line["text"])
        if len(text) < 2:
            # 「嗯……」这类纯语气词，念出来没有意义，跳过
            continue
        todo.append((sp, line["id"], text, target))

    if args.limit:
        todo = todo[: args.limit]
    print(f"待生成 {len(todo)} 条")

    import lameenc
    import numpy as np
    import soundfile as sf

    enc_ok = 0
    for i, (sp, line_id, text, target) in enumerate(todo, 1):
        ref = ready[sp]
        ref_path = ref["_path"]
        t1 = time.time()
        try:
            result = list(
                get_tts_wav(
                    ref_wav_path=str(ref_path),
                    prompt_text=ref["ref_text"],
                    prompt_language=ref.get("ref_lang", "中文"),
                    text=text,
                    text_language=ref.get("target_lang", "中文"),
                    top_k=15,
                    top_p=1,
                    temperature=1,
                    speed=ref.get("speed", 1),
                    use_cuda_graph=False,
                    use_flash_attention=False,
                )
            )
            sr, audio = result[-1]
            pcm16 = to_pcm16(audio)
            dur = len(pcm16) / float(sr)
            # 个别句子推理会吐出不到 1 秒的残句。这种宁可留空（游戏里这句就没有配音），
            # 也不要塞一段听不清的音频进去。
            if dur < float(ref.get("min_dur", 0.8)):
                print(f"[{i}/{len(todo)}] 过短({dur:.2f}s)，跳过 {sp} {line_id}: {text}")
                continue
            enc = lameenc.Encoder()
            enc.set_bit_rate(128)
            enc.set_in_sample_rate(int(sr))
            enc.set_channels(1)
            enc.set_quality(2)
            mp3 = bytes(enc.encode(pcm16.tobytes())) + bytes(enc.flush())
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(mp3)
            enc_ok += 1
            print(f"[{i}/{len(todo)}] {sp} {line_id} {len(text)}字 "
                  f"{time.time() - t1:.1f}s -> {target.stat().st_size // 1024}KB  {text}")
        except Exception as e:  # 单句失败不该中断整批
            print(f"[{i}/{len(todo)}] 失败 {sp} {line_id}: {type(e).__name__}: {e}")

    # 生成索引：游戏只读这个，没生成的角色保持静音打字（不合成、不报错）
    index = {}
    for sp in ready:
        d = out_dir / sp
        if not d.exists():
            continue
        index[sp] = sorted(p.stem for p in d.glob("*.mp3"))
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"完成，本次生成 {enc_ok} 条；索引已写入 {out_dir / 'index.json'}")
    for sp, ids in index.items():
        print(f"  {sp}: {len(ids)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
