import Phaser from 'phaser'

/** 是否触摸设备（用来决定提示文案走"点击"还是"按键"） */
export const IS_TOUCH =
  typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0)

/** 按设备给出不同的操作提示：手机"点"，电脑"点或按键" */
export function controlHint(touch: string, desktop: string): string {
  return IS_TOUCH ? touch : desktop
}

// 交互提示气泡（“按 E / 空格”）
export function hintText(scene: Phaser.Scene, x: number, y: number, label = '按 E 或 空格 交互') {
  const t = scene.add
    .text(x, y, label, {
      fontFamily: 'Microsoft YaHei',
      fontSize: '15px',
      color: '#7a4bb0',
      backgroundColor: 'rgba(255,255,255,0.85)',
      padding: { x: 10, y: 6 }
    })
    .setOrigin(0.5)
    .setDepth(890)
    .setAlpha(0)
  t.setData('hintLabel', label)
  return t
}

export function showHint(t: Phaser.GameObjects.Text | null, on: boolean) {
  if (!t) return
  t.setAlpha(on ? 1 : 0)
}

// ============================================================
// 交互目标统一仲裁
//
// 原来每个场景自己用 Math.hypot 逐个 if 判断，导致几类问题：
//   1. 判定顺序写死，站在两个目标中间时永远只能触发先判断的那个（对话死区）；
//   2. 半径写死得很大（90~110），隔着老远就把远处的角色触发了；
//   3. 同一处代码要复制四五遍。
// 这里改成"在半径内选最近的一个"，重叠区域自然被就近仲裁。
// ============================================================

export type InteractTarget = {
  x: number
  y: number
  /** 触发半径（默认 60） */
  radius?: number
  /**
   * 手动按 E 的判定半径。不填就用 radius。
   * （自动交互用的是 player.ts 里的 reach，两者分开是为了让按键更宽容、
   *   而"走过去自动触发"更贴身，避免路过就被弹对话。）
   */
  reach?: number
  /** 当前是否可交互（例如已经收集过 / 还没解锁）；返回 false 则忽略该目标 */
  enabled?: () => boolean
  /** 命中后执行 */
  run: () => void | Promise<void>
}

/** 在候选里挑距离最近且在半径内的目标 */
export function selectNearest(
  targets: InteractTarget[],
  px: number,
  py: number
): { target: InteractTarget; d: number } | null {
  let best: { target: InteractTarget; d: number } | null = null
  for (const t of targets) {
    if (t.enabled && !t.enabled()) continue
    const d = Math.hypot(px - t.x, py - t.y)
    if (d > (t.reach ?? t.radius ?? 60)) continue
    if (!best || d < best.d) best = { target: t, d }
  }
  return best
}

/**
 * 按下交互键时调用：命中最近的目标就执行它，什么都没命中就弹 fallback 提示。
 * 返回 true 表示这次按键被某个目标处理了。
 */
export function handleInteraction(
  scene: Phaser.Scene,
  px: number,
  py: number,
  targets: InteractTarget[],
  fallback?: string
): boolean {
  const best = selectNearest(targets, px, py)
  if (!best) {
    if (fallback) toast(scene, fallback)
    return false
  }
  try {
    const r = best.target.run()
    if (r && typeof (r as Promise<void>).then === 'function') {
      // 目标内部的异常不应该吃掉整个场景的交互
      ;(r as Promise<void>).catch((e) => console.warn('[interaction]', e))
    }
  } catch (e) {
    console.warn('[interaction]', e)
  }
  return true
}

// 屏幕下方轻提示（用于引导，非对话）
// 位置放在对话框之上：否则会被对话框压住看不见
export function toast(scene: Phaser.Scene, text: string, ms = 2200) {
  const t = scene.add
    .text(scene.scale.width / 2, scene.scale.height - 138, text, {
      fontFamily: 'Microsoft YaHei',
      fontSize: '16px',
      color: '#7a4bb0',
      backgroundColor: 'rgba(255,255,255,0.9)',
      padding: { x: 14, y: 8 }
    })
    .setOrigin(0.5)
    .setDepth(910)
    .setAlpha(0)
  scene.tweens.add({ targets: t, alpha: 1, duration: 200, yoyo: false })
  scene.tweens.add({
    targets: t,
    alpha: 0,
    duration: 500,
    delay: ms,
    onComplete: () => t.destroy()
  })
}

// 淡入 / 淡出场景
// 层级约定：场景内容(0~1200) < 对话框与信件面板(1500) < 淡入(1900) < 淡出(3000)
export function fadeIn(scene: Phaser.Scene, duration = 600) {
  const rect = scene.add
    .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width + 4, scene.scale.height + 4, 0xfff4fb)
    .setDepth(1900)
  rect.setAlpha(1)
  scene.tweens.add({ targets: rect, alpha: 0, duration, onComplete: () => rect.destroy() })
  return rect
}

export function fadeOut(scene: Phaser.Scene, duration = 700): Promise<void> {
  return new Promise((res) => {
    const rect = scene.add
      .rectangle(scene.scale.width / 2, scene.scale.height / 2, scene.scale.width + 4, scene.scale.height + 4, 0xfff4fb)
      .setDepth(3000)
    rect.setAlpha(0)
    scene.tweens.add({
      targets: rect,
      alpha: 1,
      duration,
      onComplete: () => res()
    })
  })
}
