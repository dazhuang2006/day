import Phaser from 'phaser'
import { Starberry } from './characters/Starberry'
import { dialogue } from './scenes/dialogue'

export type Facing = 'up' | 'down' | 'left' | 'right'

// 玩家所在的"演员层"：高于所有布景与道具（布景多为 0~220），
// 低于对话框(1500)/提示(880~1500)/转场(2000+)。
const PLAYER_DEPTH = 500

/** 场景当前可交互的目标（用于"走到就自动交互"，让手机不用按键） */
export type InteractTarget = {
  x: number
  y: number
  /** 目标自带半径（物件 52 / 角色 60 左右） */
  radius?: number
  /** 玩家要走到离目标多近才算"够得着" */
  reach?: number
  enabled?: () => boolean
  run: () => void | Promise<void>
}

/**
 * 玩家控制：键盘（WASD / 方向键）+ 点触（点哪走哪）。
 * 交互支持两种方式：按 E/空格，或直接走到目标旁边自动触发。
 */
export class Player {
  scene: Phaser.Scene
  spr: Phaser.GameObjects.Sprite
  busy = false
  speed = 165
  bounds: { x: number; y: number; w: number; h: number } | null = null
  facing: Facing = 'down'
  /** 点触移动的目标点；null 表示不在自动行走 */
  private moveTarget: { x: number; y: number } | null = null
  /** 场景每帧提供的交互目标 */
  private targets: InteractTarget[] = []
  /** 当一个目标从"够不着"变成"够得着"时回调（用来点亮提示光圈 / 更新 HUD） */
  onNearChange?: (index: number) => void
  /** 最近一次够得着的目标下标，-1 表示没有 */
  nearIndex = -1
  private keys: Record<string, Phaser.Input.Keyboard.Key>
  private obstacles: { x: number; y: number; r: number }[] = []
  private isWalking = false
  /** 对话结束后的一小段"防误触"时间 */
  private freezeMs = 0
  private lastAutoInteract = 0
  /** 自动交互的冷却，避免同一次行走连续触发 */
  private autoCooldown = 900

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene
    const star = new Starberry()
    this.spr = star.spawn(scene, x, y, 1.2)
    this.spr.setDepth(PLAYER_DEPTH)
    this.spr.setData('player', true)

    // 方向键 + WASD，统一成同一组 Key，方便 JustDown 检测交互
    this.keys = scene.input.keyboard!.addKeys(
      'W,A,S,D,E,SPACE,UP,LEFT,DOWN,RIGHT'
    ) as Record<string, Phaser.Input.Keyboard.Key>

    this.setupTapToMove()
  }

  setObstacles(list: { x: number; y: number; r: number }[]) {
    this.obstacles = list
  }

  /** 让场景每帧给出可交互目标（手机端靠它实现"走到就交互"） */
  setInteractTargets(targets: InteractTarget[]) {
    this.targets = targets
  }

  /** 某个点玩家能不能站上去（在世界内 + 不在障碍里） */
  private isWalkable(x: number, y: number): boolean {
    if (!this.bounds) return true
    const b = this.bounds
    const m = 18
    if (x < b.x + m || x > b.x + b.w - m) return false
    if (y < b.y + m || y > b.y + b.h - m) return false
    for (const o of this.obstacles) {
      if (Math.hypot(x - o.x, y - o.y) < o.r + 20) return false
    }
    return true
  }

  /**
   * 找一个"离目标点最近、而且玩家真能站上去"的落点。
   * 这一点很关键：桌上的日历、门后面的位置这些点本身不可站，
   * 如果直接把目标点设在那儿，玩家会绕着它原地打转，
   * 永远进不了"站定"状态，自动交互也就不会触发。
   */
  private nearestWalkable(x: number, y: number): { x: number; y: number } {
    if (!this.bounds) return { x, y }
    const b = this.bounds
    const m = 18
    const cx = Phaser.Math.Clamp(x, b.x + m, b.x + b.w - m)
    const cy = Phaser.Math.Clamp(y, b.y + m, b.y + b.h - m)
    if (this.isWalkable(cx, cy)) return { x: cx, y: cy }

    let best: { x: number; y: number } | null = null
    let bestD = Infinity
    for (let ring = 24; ring <= 240; ring += 12) {
      for (let a = 0; a < 32; a++) {
        const ang = (a / 32) * Math.PI * 2
        const px = Phaser.Math.Clamp(cx + Math.cos(ang) * ring, b.x + m, b.x + b.w - m)
        const py = Phaser.Math.Clamp(cy + Math.sin(ang) * ring, b.y + m, b.y + b.h - m)
        if (!this.isWalkable(px, py)) continue
        const d = Math.hypot(px - x, py - y)
        if (d < bestD) {
          bestD = d
          best = { x: px, y: py }
        }
      }
      if (best) return best
    }
    return { x: cx, y: cy }
  }

  /** 关闭对话后短暂冻结移动，避免刚点掉对话框人就往一个方向跑 */
  freeze(ms = 180) {
    this.freezeMs = Math.max(this.freezeMs, ms)
  }

  /**
   * 吸附：如果当前行走目标点附近有可交互目标，就把目标点挪到它身上。
   * 这样手机端"点个大概"也能准确走到花/角色旁边，而不是停在判定圈外干瞪眼。
   * 注意：目标点本身可能被障碍挡住（比如桌上的日历），所以还要再修正一次，
   * 否则玩家会绕着那个点原地打转、永远进不了"站定"状态，自动交互也就不会触发。
   */
  private snapToNearbyTarget() {
    if (!this.moveTarget) return
    let best: { t: InteractTarget; d: number } | null = null
    for (const t of this.targets) {
      if (t.enabled && !t.enabled()) continue
      const d = Math.hypot(this.moveTarget.x - t.x, this.moveTarget.y - t.y)
      if (d > 92) continue
      if (!best || d < best.d) best = { t, d }
    }
    if (best) {
      const p = this.nearestWalkable(best.t.x, best.t.y)
      this.moveTarget.x = p.x
      this.moveTarget.y = p.y
    }
  }

  /** 点哪走哪：手机端的主要移动方式，鼠标也能用 */
  private setupTapToMove() {
    const onPointerDown = (pointer: Phaser.Input.Pointer) => {
      if (this.busy) return
      const p = this.nearestWalkable(pointer.worldX, pointer.worldY)
      if (Math.hypot(p.x - this.spr.x, p.y - this.spr.y) < 6) return
      this.moveTarget = p
      this.showTapMark(p.x, p.y)
    }
    this.scene.input.on('pointerdown', onPointerDown)
  }

  /** 点到的位置如果不可站（越界/在障碍里），修正到最近能站的点 */
  private clampToWalkable(x: number, y: number): { x: number; y: number } {
    return this.nearestWalkable(x, y)
  }

  /** 点一下的落点提示 */
  private showTapMark(x: number, y: number) {
    const ring = this.scene.add.circle(x, y, 6, 0xffffff, 0.5).setDepth(PLAYER_DEPTH + 1)
    const ring2 = this.scene.add.circle(x, y, 6).setStrokeStyle(2, 0xffffff, 0.9).setDepth(PLAYER_DEPTH + 1)
    this.scene.tweens.add({
      targets: [ring, ring2],
      scale: 2.2,
      alpha: 0,
      duration: 420,
      onComplete: () => {
        ring.destroy()
        ring2.destroy()
      }
    })
  }

  /** 停下脚步（对话开始时用） */
  private halt() {
    this.moveTarget = null
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys[c]?.isDown)
  }

  private idleTexture() {
    const key = `starberry_stand_${this.facing}`
    return this.scene.textures.exists(key) ? key : 'starberry_stand'
  }

  private walkAnim(): string | null {
    const key = `starberry_walk_${this.facing}`
    return this.scene.anims.exists(key) ? key : null
  }

  private idle() {
    if (!this.isWalking) return
    this.spr.anims.stop()
    this.spr.setTexture(this.idleTexture())
    this.isWalking = false
  }

  /**
   * 每帧更新。
   * interact 参数保留兼容：传入则按 E/空格时调用它。
   */
  update(delta: number, interact?: (px: number, py: number) => boolean) {
    // 先更新"够得着哪个交互点"——必须在 busy 的早退之前，
    // 否则自动交互一旦触发（busy=true）提示光圈和 HUD 就再也不刷新了
    this.updateNear()

    // 对话中：停住动作，保持当前朝向
    if (this.busy) {
      this.halt()
      this.idle()
      // 仍然刷新"够得着哪个点"：否则一进对话光圈和提示就灭了，
      // 看起来像"走到这里没反应"
      this.updateNear()
      return
    }
    if (this.freezeMs > 0) this.freezeMs = Math.max(0, this.freezeMs - delta)

    let dx = 0
    let dy = 0
    // 键盘优先：一按方向键就取消点触目标
    const left = this.down('A', 'LEFT')
    const right = this.down('D', 'RIGHT')
    const up = this.down('W', 'UP')
    const down = this.down('S', 'DOWN')
    if (left || right || up || down) {
      this.moveTarget = null
      if (left) dx -= 1
      if (right) dx += 1
      if (up) dy -= 1
      if (down) dy += 1
    } else if (this.moveTarget) {
      // 吸附：手指点得不太准也没关系，附近有可交互目标就走到它跟前
      this.snapToNearbyTarget()
      // 点触移动：朝目标点走，到了就停（留一点余量，避免在目标点旁边反复抖动）
      const tdx = this.moveTarget.x - this.spr.x
      const tdy = this.moveTarget.y - this.spr.y
      const dist = Math.hypot(tdx, tdy)
      if (dist <= 7) {
        this.moveTarget = null
      } else if (dist < 26) {
        // 快到目标了：减速靠近，停下时不会"滑过头再回头"
        const k = dist / 26
        dx = (tdx / dist) * k
        dy = (tdy / dist) * k
      } else {
        dx = tdx / dist
        dy = tdy / dist
      }
    }

    const len = Math.hypot(dx, dy)
    const walking = len > 0 && this.freezeMs <= 0

    // 朝向：优先水平（和 2D 俯视的手感一致）
    if (walking) {
      if (Math.abs(dx) > 0.35) this.facing = dx > 0 ? 'right' : 'left'
      else if (Math.abs(dy) > 0.35) this.facing = dy > 0 ? 'down' : 'up'
    }

    if (walking) {
      // 点触移动时按"本帧最多走到目标点"来限制步长，避免在目标点附近抖动
      let stepX = (dx / len) * this.speed * (delta / 1000)
      let stepY = (dy / len) * this.speed * (delta / 1000)
      if (this.moveTarget) {
        const remain = Math.hypot(this.moveTarget.x - this.spr.x, this.moveTarget.y - this.spr.y)
        const stepLen = Math.hypot(stepX, stepY)
        if (stepLen > remain) {
          stepX *= remain / stepLen
          stepY *= remain / stepLen
        }
      }
      this.spr.x += stepX
      this.spr.y += stepY
      if (this.bounds) {
        this.spr.x = Phaser.Math.Clamp(this.spr.x, this.bounds.x, this.bounds.x + this.bounds.w)
        this.spr.y = Phaser.Math.Clamp(this.spr.y, this.bounds.y, this.bounds.y + this.bounds.h)
      }
      for (const o of this.obstacles) {
        const ddx = this.spr.x - o.x
        const ddy = this.spr.y - o.y
        const d = Math.hypot(ddx, ddy)
        const min = o.r + 18
        if (d < min && d > 0.01) {
          this.spr.x = o.x + (ddx / d) * min
          this.spr.y = o.y + (ddy / d) * min
        }
      }
      const anim = this.walkAnim()
      if (anim) {
        if (this.spr.anims.currentAnim?.key !== anim || !this.spr.anims.isPlaying) {
          this.spr.anims.play(anim, true)
        }
      } else {
        this.spr.setTexture(this.idleTexture())
      }
      this.isWalking = true
    } else {
      this.idle()
    }
    this.spr.setDepth(PLAYER_DEPTH)

    // 手动交互（E / 空格）
    if (interact) {
      const pressed = Phaser.Input.Keyboard.JustDown(this.keys.E) || Phaser.Input.Keyboard.JustDown(this.keys.SPACE)
      if (pressed) interact(this.spr.x, this.spr.y)
    }

    // 自动交互：站着不动、且走到某个目标够得着的位置时触发
    if (!walking) this.tryAutoInteract()
  }

  /** 计算当前够得着的目标，并在变化时回调 */
  private updateNear() {
    let best = -1
    let bestD = Infinity
    this.targets.forEach((t, i) => {
      if (t.enabled && !t.enabled()) return
      const d = Math.hypot(this.spr.x - t.x, this.spr.y - t.y)
      if (d > (t.reach ?? t.radius ?? 52)) return
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    if (best !== this.nearIndex) {
      this.nearIndex = best
      this.onNearChange?.(best)
    }
  }

  /** 走到就交互：手机端完全不需要按键 */
  private tryAutoInteract() {
    if (!this.targets.length || this.freezeMs > 0) return
    const now = this.scene.time.now
    if (now - this.lastAutoInteract < this.autoCooldown) return

    let best: { t: InteractTarget; d: number } | null = null
    for (const t of this.targets) {
      if (t.enabled && !t.enabled()) continue
      const d = Math.hypot(this.spr.x - t.x, this.spr.y - t.y)
      const reach = t.reach ?? (t.radius ?? 52)
      if (d > reach) continue
      if (!best || d < best.d) best = { t, d }
    }
    if (!best) return

    this.lastAutoInteract = now
    // 站定后再触发，避免刚走到就弹出对话导致手感突兀
    const t = best.t
    try {
      const r = t.run()
      if (r && typeof (r as Promise<void>).then === 'function') {
        ;(r as Promise<void>).catch((e) => console.warn('[auto-interact]', e))
      }
    } catch (e) {
      console.warn('[auto-interact]', e)
    }
  }

  /** 弹一段对话（期间锁定移动） */
  async say(lines: Parameters<typeof dialogue>[1], opts?: Parameters<typeof dialogue>[2]) {
    this.busy = true
    this.halt()
    this.idle()
    this.freeze(300)
    try {
      await dialogue(this.scene, lines, opts)
    } finally {
      this.busy = false
      // 对话刚结束不要把刚才那次点击当成新的移动指令，同时避免立刻重复触发
      this.lastAutoInteract = this.scene.time.now
      this.freeze(260)
    }
  }

  setPosition(x: number, y: number) {
    this.spr.setPosition(x, y)
    this.spr.setDepth(PLAYER_DEPTH)
  }
}
