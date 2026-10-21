import Phaser from 'phaser'
import { audioManager } from '../audio'

// 可收集物：靠近后按交互键（E / Space）收集，带粒子反馈
export class Collectible {
  spr: Phaser.GameObjects.Image
  collected = false
  private radius: number
  private scene: Phaser.Scene

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string, radius = 46) {
    this.scene = scene
    this.radius = radius
    this.spr = scene.add.image(x, y, textureKey).setScale(1.4).setDepth(50)
    this.spr.setData('collectible', true)

    // 柔和的浮光
    scene.tweens.add({
      targets: this.spr,
      y: y - 6,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
    scene.tweens.add({
      targets: this.spr,
      angle: 8,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }

  near(px: number, py: number): boolean {
    if (this.collected) return false
    const dx = px - this.spr.x
    const dy = py - this.spr.y
    return dx * dx + dy * dy < this.radius * this.radius
  }

  /** 读档后把已收集的道具直接抹掉（不播动画） */
  markCollected() {
    if (this.collected) return
    this.collected = true
    this.scene.tweens.killTweensOf(this.spr)
    this.spr.destroy()
  }

  /** 执行收集动画，返回 Promise 便于串剧情 */
  collect(): Promise<void> {
    if (this.collected) return Promise.resolve()
    this.collected = true
    audioManager.playCollect()
    const burst = this.scene.add.particles(0, 0, 'sparkle', {
      x: this.spr.x,
      y: this.spr.y,
      speed: { min: 60, max: 180 },
      scale: { start: 0.8, end: 0 },
      lifespan: 600,
      quantity: 16,
      blendMode: Phaser.BlendModes.ADD
    })
    burst.explode(16)
    return new Promise<void>((res) => {
      this.scene.tweens.add({
        targets: this.spr,
        scale: 1.9,
        alpha: 0,
        duration: 420,
        ease: 'Back.easeIn',
        onComplete: () => {
          this.spr.destroy()
          burst.destroy()
          res()
        }
      })
    })
  }

  destroy() {
    if (this.spr && this.spr.active) this.spr.destroy()
  }
}
