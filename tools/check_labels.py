# 检查标注结果的一致性：同一角色的音高应该聚在一起，如果某个角色跨度过大，
# 说明标注里混进了别人的片段——用它做参考音频会把音色带偏。
#
# 用法：
#   C:\Users\23201\.conda\envs\GPTSoVits\python.exe tools\check_labels.py refs/dub/segs/labels.json
import json
import statistics as st
import sys
from pathlib import Path

ROOT = Path(r"D:\python\xiangmu\youxi1")
CN = {
    "starberry": "星莓", "twilight": "紫悦", "fluttershy": "柔柔",
    "applejack": "苹果嘉儿", "rainbow": "云宝", "rarity": "珍奇", "pinkie": "碧琪",
}


def main() -> int:
    p = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if p is None or not p.exists():
        print("用法: check_labels.py <labels.json>")
        return 1
    recs = json.loads(p.read_text(encoding="utf-8-sig"))

    groups = {}
    excluded = {}
    for r in recs:
        sp = r.get("speaker")
        if not sp:
            continue
        if sp not in CN:
            excluded[sp] = excluded.get(sp, 0) + 1
            continue
        groups.setdefault(sp, []).append(r)

    print(f"共 {len(recs)} 条标注；排除 {sum(excluded.values())} 条 "
          f"({', '.join(f'{k}×{v}' for k, v in sorted(excluded.items()))})")
    print()
    print(f"{'角色':<10}{'条数':>5}{'音高中位':>10}{'音高范围':>16}{'时长合计':>10}{'时长范围':>14}")
    print("-" * 74)
    stats = {}
    for sp, items in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        f0 = sorted(r["f0_mean"] for r in items)
        durs = [r["dur"] for r in items]
        med = st.median(f0)
        stats[sp] = {"n": len(items), "med": med, "lo": f0[0], "hi": f0[-1],
                     "dur_sum": sum(durs)}
        print(f"{CN[sp]:<10}{len(items):>5}{med:>10.0f}{f0[0]:>8.0f}~{f0[-1]:<7.0f}"
              f"{sum(durs):>9.1f}s{min(durs):>7.1f}~{max(durs):<6.1f}s")

    print()
    # 谁的中位音高明显偏离自己的主体？离群点很可能标错了人
    print("一致性检查：")
    any_issue = False
    for sp, s in stats.items():
        items = groups[sp]
        f0 = sorted(r["f0_mean"] for r in items)
        med = st.median(f0)
        # 与中位数相差超过 60Hz 的，视为可能标错
        off = [r for r in items if abs(r["f0_mean"] - med) > 60]
        spread = f0[-1] - f0[0]
        flag = ""
        if spread > 120:
            flag = f"  ⚠ 跨度 {spread:.0f}Hz 偏大"
            any_issue = True
        if off:
            flag += f"  离群 {len(off)} 条: " + ", ".join(
                f"{Path(r['file']).name}({r['f0_mean']:.0f}Hz)" for r in off[:5]
            )
            any_issue = True
        if s["dur_sum"] < 5:
            flag += f"  ⚠ 可用时长仅 {s['dur_sum']:.1f}s，偏少"
            any_issue = True
        print(f"  {CN[sp]:<10} 跨度 {spread:>5.0f}Hz{flag}")

    # 跨角色对比：谁和谁的中位音高太近，可能被混淆
    print()
    print("角色之间的音高区分度（中位音高差 < 20Hz 的容易听混）：")
    keys = list(stats)
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            a, b = keys[i], keys[j]
            d = abs(stats[a]["med"] - stats[b]["med"])
            if d < 20:
                print(f"  ⚠ {CN[a]}({stats[a]['med']:.0f}Hz) 与 {CN[b]}({stats[b]['med']:.0f}Hz) 仅差 {d:.0f}Hz")
    if not any_issue:
        print("  未发现明显异常")
    return 0


if __name__ == "__main__":
    sys.exit(main())
