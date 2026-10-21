import Phaser from 'phaser'
import { dialogue } from './dialogue'
import { knockLines, doorCheckLines, quietLines, surpriseLines, birthdayShout } from '../data/dialogue'
import { audioManager } from '../audio'
import { fadeIn, fadeOut } from '../sceneUtils'
import { saveGame } from '../persistence'
import { state } from '../config'

// 第五章：把"敲门 → 开门"拆成 7 个节拍，
// 让光、音量、镜头一点点升上去，最后才全亮。
//   1 云宝报信 → 2 第一次敲门 → 3 第二次敲门（更响）→ 4 珍奇检查
//   5 紫悦数拍子 → 6 最后一次敲门 → 7 门开、灯亮、合唱
export class SurpriseScene extends Phaser.Scene {
  /** 盖住全屏的黑幕，随节拍慢慢升起 */
  private dark!: Phaser.GameObjects.Rectangle
  /** 门后的暖光 */
  private glow!: Phaser.GameObjects.Arc
  private revealing = false

  constructor() {
    super('SurpriseScene')
  }

  create() {
    this.buildNight()
    // 主题曲从第四章一路延续到这里：已经在放就不要打断重播
    if (!audioManager.isPlayingMusic('birthday')) audioManager.playMusic(this, 'birthday')
    // 本章的配音先预加载，避免第一句因为还在解码而没声音
    audioManager.preloadVoiceClips(this, [...knockLines, ...doorCheckLines, ...quietLines, ...surpriseLines, ...birthdayShout])
    audioManager.setIntensity(0)
    fadeIn(this, 500)

    this.run()
  }

  async run() {
    // 1. 报信：还是很暗，音乐只有垫音
    await dialogue(this, knockLines)

    // 2. 第一次敲门
    await this.knock(1)
    // 3. 第二次敲门，更近、更响
    await this.knock(2)

    // 4~5. 门前的最后检查（音乐开始长出琶音）
    audioManager.setIntensity(1)
    this.brighten(0.08)
    await dialogue(this, doorCheckLines)

    // 6. 最后一次敲门：她就在门外
    audioManager.setIntensity(2)
    this.brighten(0.2)
    await this.knock(3)
    await dialogue(this, quietLines)

    // 7. 门开、灯亮
    await dialogue(this, surpriseLines)
    this.reveal()
    // 黑幕退到只剩一点点，让彩灯与大家一起亮起来
    await this.brightenTo(0.12)

    await dialogue(this, birthdayShout)

    // 彩带 / 烟花
    this.fireworks()
    this.time.delayedCall(1600, () => {
      fadeOut(this, 900).then(() => this.scene.start('BirthdayScene'))
    })
  }

  /** 一次敲门：音效 + 画面轻震 + 大字 + 黑幕稍微褪一点 */
  private async knock(index: number) {
    audioManager.playKnock()
    this.cameras.main.shake(120 + index * 30, 0.003 + index * 0.001)
    this.brighten(0.05)
    const knock = this.add
      .text(this.scale.width / 2, 300, '咚。', {
        fontFamily: 'Microsoft YaHei',
        fontSize: `${52 + index * 8}px`,
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(1200)
      .setAlpha(0)
    this.tweens.add({ targets: knock, alpha: 1, scale: 1.2, duration: 160, yoyo: true, hold: 200 })
    await new Promise((r) => this.time.delayedCall(500 + index * 90, r))
  }

  /** 黑幕淡下去一点（不销毁，最后一次统一清掉） */
  private brighten(amount: number) {
    const next = Math.max(0, this.dark.alpha - amount)
    this.tweens.add({ targets: this.dark, alpha: next, duration: 700, ease: 'Sine.easeOut' })
    this.tweens.add({ targets: this.glow, alpha: Math.min(0.5, this.glow.alpha + amount), duration: 700 })
  }

  private brightenTo(alpha: number): Promise<void> {
    return new Promise((res) => {
      this.tweens.add({
        targets: this.dark,
        alpha,
        duration: 900,
        ease: 'Sine.easeOut',
        onComplete: () => res()
      })
      this.tweens.add({ targets: this.glow, alpha: 0.5, duration: 900 })
    })
  }

  private reveal() {
    if (this.revealing) return
    this.revealing = true
    audioManager.playSparkle()
    this.cameras.main.flash(260, 255, 214, 170, false)
    state.surprised = true
    state.phase = 'done'
    saveGame()
    this.dark.destroy()
    this.revealParty()
  }

  revealParty() {
    const W = this.scale.width
    // 彩灯
    for (let i = 0; i < 14; i++) {
      const colors = ['fairy_light', 'fairy_light_pink', 'fairy_light_blue', 'fairy_light_green']
      const x = 40 + i * 68
      const l = this.add.image(x, 90, colors[i % 4]).setScale(1.6).setDepth(1201)
      this.tweens.add({ targets: l, scale: 2, alpha: 0.3, duration: 600 + i * 60, yoyo: true, repeat: -1 })
    }
    // 星星粒子
    this.add
      .particles(0, 0, 'star_gold', {
        x: { min: 0, max: W },
        y: { min: 120, max: 260 },
        speed: { min: 20, max: 70 },
        scale: { start: 0.8, end: 0 },
        lifespan: 1600,
        quantity: 1,
        frequency: 60,
        blendMode: Phaser.BlendModes.ADD
      })
      .setDepth(1201)
    // 角色们一字排开
    const order = ['twilight', 'fluttershy', 'applejack', 'rainbow', 'rarity', 'pinkie']
    order.forEach((k, i) => {
      const x = W / 2 - 210 + i * 84
      const spr = this.add.image(x, 330, `${k}_stand`).setScale(1.15).setDepth(1202)
      spr.setAlpha(0)
      this.tweens.add({ targets: spr, alpha: 1, duration: 400, delay: i * 90 })
      this.tweens.add({ targets: spr, y: 320, duration: 500, yoyo: true, repeat: -1, delay: i * 90 })
    })
    // 星莓在中间
    const sb = this.add.image(W / 2, 260, 'starberry_stand').setScale(1.3).setDepth(1203).setAlpha(0)
    this.tweens.add({ targets: sb, alpha: 1, duration: 500, delay: 260 })
  }

  fireworks() {
    const W = this.scale.width
    for (let i = 0; i < 6; i++) {
      this.time.delayedCall(i * 260, () => {
        const x = Phaser.Math.Between(120, W - 120)
        const y = Phaser.Math.Between(120, 220)
        const color = [0xff5a78, 0xffe066, 0x53d8d0, 0xb98bff][i % 4]
        const burst = this.add
          .particles(0, 0, 'sparkle', {
            x,
            y,
            speed: { min: 100, max: 260 },
            scale: { start: 1, end: 0 },
            lifespan: 900,
            quantity: 30,
            tint: color,
            blendMode: Phaser.BlendModes.ADD
          })
          .setDepth(1204)
        burst.explode(30)
        this.time.delayedCall(900, () => burst.destroy())
      })
    }
  }

  buildNight() {
    const W = 960
    const H = 560
    this.add.rectangle(0, 0, W, H, 0x1a1433).setOrigin(0)
    // 门（中间）
    this.add.rectangle(W / 2, 360, 130, 220, 0x2a2350).setDepth(10)
    this.add.rectangle(W / 2, 360, 18, 220, 0x3a2f58).setDepth(11)
    this.add.circle(W / 2 - 30, 360, 5, 0xffe066).setDepth(12)
    // 门缝里漏出来的暖光（随节拍变亮）
    this.glow = this.add.circle(W / 2, 360, 150, 0xffd9a0, 1).setAlpha(0.04).setDepth(9)
    this.tweens.add({ targets: this.glow, scale: 1.06, duration: 2200, yoyo: true, repeat: -1 })
    // 黑色遮罩（覆盖全屏，靠节拍一点点升起）
    this.dark = this.add.rectangle(0, 0, W, H, 0x000000).setOrigin(0).setDepth(1000).setAlpha(0.88)
  }
}
