import Phaser from 'phaser'

// ============================================================
// 交互点提示光圈
//
// 之前玩家走到日历/盒子跟前没有任何视觉反馈，不知道"这里能交互"。
// 这里给每个交互点画一个柔和的双层光圈：
//   - 远处：淡淡的呼吸光，只是"这里有个东西"
//   - 玩家走近：光圈变亮、变实，并给一点放大反馈 → 明确"可以互动了"
// 目标消失（采走了花、聊过的人）时，光圈自动淡出销毁。
// ============================================================

export type HighlightSource = {
  /** 目标位置；给函数是为了跟随会浮动/移动的物件 */
  x: number | (() => number)
  y: number | (() => number)
  /** 跟随的精灵：物件被采集/销毁后光圈自动收掉 */
  sprite?: Phaser.GameObjects.Components.Transform & { active?: boolean }
  /** 是否还应该显示（默认一直显示） */
  enabled?: () => boolean
  /** 光圈基础大小 */
  radius?: number
  /** 玩家的"我够得着了"半径，用来点亮 */
  reach?: number
  color?: number
}

type Mark = {
  src: HighlightSource
  core: Phaser.GameObjects.Arc
  ring: Phaser.GameObjects.Arc
  alive: boolean
  /** 进入范围时只播一次反馈 */
  lit: boolean
}

export class InteractionHighlights {
  private scene: Phaser.Scene
  private marks: Mark[] = []
  private ticker?: Phaser.Time.TimerEvent
  private lastNearKey = ''
  /** 当前够得着的交互点（供 HUD 显示"可互动"） */
  nearIndex = -1

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.ticker = scene.time.addEvent({ delay: 80, loop: true, callback: () => this.update() })
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy())
  }

  set(sources: HighlightSource[]) {
    // 已有的按位置复用，避免每帧重建
    const next: Mark[] = []
    sources.forEach((src, i) => {
      const existing = this.marks[i]
      if (existing && existing.alive && existing.src.sprite === src.sprite) {
        existing.src = src
        next.push(existing)
        return
      }
      if (existing && existing.alive) {
        existing.core.destroy()
        existing.ring.destroy()
        existing.alive = false
      }
      next.push(this.create(src))
    })
    // 多出来的收掉
    this.marks.slice(sources.length).forEach((m) => {
      if (m.alive) {
        m.core.destroy()
        m.ring.destroy()
        m.alive = false
      }
    })
    this.marks = next
  }

  /**
   * 点亮/熄灭某一个光圈。
   * 由 Player 的 onNearChange 调用：玩家走进判定范围时给一次放大反馈，
   * 这样"走到跟前"这件事在视觉上是明确发生的。
   */
  setNear(index: number, animate = true) {
    this.marks.forEach((m, i) => {
      if (!m.alive) return
      const color = m.src.color ?? 0xffd94d
      if (i === index) {
        m.core.setFillStyle(color, 0.85)
        m.ring.setStrokeStyle(3.5, color, 1)
        if (animate) {
          m.core.setScale(1.55)
          m.ring.setScale(1.55)
          this.scene.tweens.add({
            targets: [m.core, m.ring],
            scale: 1,
            duration: 280,
            ease: 'Back.easeOut'
          })
        }
        m.lit = true
      } else if (m.lit) {
        m.lit = false
        m.core.setFillStyle(color, 0.35)
        m.ring.setStrokeStyle(2.5, color, 0.55)
      }
    })
    this.nearIndex = index
  }

  private create(src: HighlightSource): Mark {
    const color = src.color ?? 0xffd94d
    const r = src.radius ?? 26
    const core = this.scene.add.circle(0, 0, r * 0.34, color, 0.35).setDepth(6)
    const ring = this.scene.add.circle(0, 0, r, color, 0).setStrokeStyle(2.5, color, 0.55).setDepth(6)
    this.scene.tweens.add({
      targets: [core, ring],
      scale: { from: 0.88, to: 1.12 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    return { src, core, ring, alive: true, lit: false }
  }

  update() {
    this.marks.forEach((m) => {
      if (!m.alive) return
      const { src } = m
      // 物件被采集/销毁 → 收掉光圈
      if (src.sprite && src.sprite.active === false) {
        m.core.destroy()
        m.ring.destroy()
        m.alive = false
        return
      }
      if (src.enabled && !src.enabled()) {
        m.core.setVisible(false)
        m.ring.setVisible(false)
        if (m.lit) {
          m.lit = false
          const c = src.color ?? 0xffd94d
          m.core.setFillStyle(c, 0.35)
          m.ring.setStrokeStyle(2.5, c, 0.55)
        }
        return
      }
      const x = typeof src.x === 'function' ? src.x() : src.x
      const y = typeof src.y === 'function' ? src.y() : src.y
      m.core.setPosition(x, y).setVisible(true)
      m.ring.setPosition(x, y).setVisible(true)
    })
  }

  /** 玩家身边有没有够得着的交互点 */
  get hasNear(): boolean {
    return this.nearIndex >= 0
  }

  destroy() {
    this.ticker?.remove()
    this.ticker = undefined
    this.marks.forEach((m) => {
      if (m.alive) {
        m.core.destroy()
        m.ring.destroy()
        m.alive = false
      }
    })
    this.marks = []
  }
}
