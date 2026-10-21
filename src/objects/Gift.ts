import Phaser from 'phaser'
import { audioManager } from '../audio'

// 神秘盒子 / 礼物：带锁定动画与开启动画
export class Gift {
  box: Phaser.GameObjects.Image
  private scene: Phaser.Scene
  private opened = false
  private sparkle: Phaser.GameObjects.Particles.ParticleEmitter | null = null

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey = 'mystery_box') {
    this.scene = scene
    this.box = scene.add.image(x, y, textureKey).setScale(2).setDepth(40)
  }

  /** 靠近盒子时出现“？”，表示还不能打开 */
  showQuestion() {
    const q = this.scene.add
      .text(this.box.x, this.box.y - 70, '?', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '34px',
        fontStyle: 'bold',
        color: '#ff9ad5'
      })
      .setDepth(880)
    this.scene.tweens.add({
      targets: q,
      y: q.y - 8,
      alpha: 0.2,
      duration: 900,
      yoyo: true,
      repeat: 2,
      onComplete: () => q.destroy()
    })
  }

  /** 读档用：盒子已经是"包好了"的状态，直接把里面的礼物显示出来 */
  showInner(innerKey: string) {
    if (this.opened) return
    this.opened = true
    this.box.setScale(1.2).setAngle(0)
    const inner = this.scene.add.image(this.box.x, this.box.y, innerKey).setScale(1.3).setDepth(41)
    this.scene.tweens.add({
      targets: inner,
      y: inner.y - 6,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }

  /** 开启动画：盒子旋转放大 + 星星迸发，然后显示内部礼物 */
  open(innerKey: string): Promise<void> {
    if (this.opened) return Promise.resolve()
    this.opened = true
    audioManager.playSparkle()
    return new Promise<void>((res) => {
      this.scene.tweens.add({
        targets: this.box,
        scale: 2.4,
        angle: 10,
        y: this.box.y - 8,
        duration: 420,
        ease: 'Back.easeOut',
        onComplete: () => {
          this.scene.tweens.add({
            targets: this.box,
            scale: 1.2,
            angle: 0,
            y: this.box.y + 8,
            duration: 260,
            onComplete: () => {
              const inner = this.scene.add.image(this.box.x, this.box.y, innerKey).setScale(0.1)
              this.scene.tweens.add({ targets: inner, scale: 1.3, duration: 500, ease: 'Back.easeOut' })
              this.sparkle = this.scene.add.particles(0, 0, 'star_gold', {
                x: this.box.x,
                y: this.box.y,
                speed: { min: 40, max: 140 },
                scale: { start: 0.7, end: 0 },
                lifespan: 900,
                quantity: 2,
                frequency: 120,
                blendMode: Phaser.BlendModes.ADD
              })
              // 粒子飘一会儿就停，别让它一直挂在场景里
              this.scene.time.delayedCall(1800, () => {
                this.sparkle?.stop()
                this.scene.time.delayedCall(1000, () => {
                  this.sparkle?.destroy()
                  this.sparkle = null
                })
              })
              res()
            }
          })
        }
      })
    })
  }
}
