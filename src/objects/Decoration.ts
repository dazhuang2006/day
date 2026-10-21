import Phaser from 'phaser'
import { audioManager } from '../audio'

// 装饰物：第四章布置任务用。
// 一开始是隐形的——必须先从朋友那里把它收下来（reveal），
// 才会出现在房间里并开始"呼吸"提示。
export class Decoration {
  spr: Phaser.GameObjects.Image
  placed = false
  /** 是否已经从朋友手里收到这件东西（收到后才会显示并可布置） */
  revealed = false
  private scene: Phaser.Scene
  private scale: number

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string, scale = 1.4) {
    this.scene = scene
    this.scale = scale
    this.spr = scene.add.image(x, y, textureKey).setScale(scale).setDepth(30)
    this.spr.setAlpha(0).setVisible(false)
  }

  /** 从朋友手里收到这件东西：出现 + 呼吸光 */
  reveal() {
    if (this.revealed || this.placed) return
    this.revealed = true
    this.spr.setVisible(true).setAlpha(0.25)
    this.scene.tweens.add({
      targets: this.spr,
      scale: this.scale * 1.1,
      alpha: 0.4,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }

  /**
   * 现在能不能布置：还没摆好、已经从朋友手里收到。
   * giver 为空表示这件东西一开始就有；否则必须在 received 里。
   */
  canPlace(giver: string | undefined, received: string[]): boolean {
    if (this.placed || !this.revealed) return false
    return !giver || received.includes(giver)
  }

  near(px: number, py: number): boolean {
    if (this.placed || !this.revealed) return false
    const dx = px - this.spr.x
    const dy = py - this.spr.y
    return dx * dx + dy * dy < 48 * 48
  }

  place(): Promise<void> {
    if (this.placed) return Promise.resolve()
    this.placed = true
    this.revealed = true
    this.spr.setVisible(true)
    this.scene.tweens.killTweensOf(this.spr)
    audioManager.playCollect()
    return new Promise<void>((res) => {
      this.scene.tweens.add({
        targets: this.spr,
        scale: 1.6,
        alpha: 1,
        angle: 12,
        duration: 420,
        ease: 'Back.easeOut',
        yoyo: false,
        onComplete: () => {
          this.scene.tweens.add({
            targets: this.spr,
            scale: 1.45,
            angle: 0,
            duration: 220,
            onComplete: () => res()
          })
        }
      })
    })
  }

  /** 读档用：直接呈现"已布置好"的状态，不播动画、不发音 */
  placeImmediately() {
    if (this.placed) return
    this.placed = true
    this.revealed = true
    this.scene.tweens.killTweensOf(this.spr)
    this.spr.setVisible(true).setScale(1.45).setAlpha(1).setAngle(0)
  }
}
