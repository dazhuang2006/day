import Phaser from 'phaser'
import { Player, type InteractTarget } from '../player'
import { gardenIntro, fluttershyBrief, flowerHints, gardenDone } from '../data/dialogue'
import { Collectible } from '../objects/Collectible'
import { FLOWERS, FLOWER_LABEL, state } from '../config'
import { audioManager } from '../audio'
import { fadeIn, fadeOut, toast, handleInteraction, controlHint as controller } from '../sceneUtils'
import { setupInteractionHighlights } from '../objects/interactSetup'
import { saveGame } from '../persistence'

export class GardenScene extends Phaser.Scene {
  player!: Player
  collectibles: Collectible[] = []
  fluttershyMet = false
  private exitOpen = false

  constructor() {
    super('GardenScene')
  }

  create() {
    this.buildGarden()
    audioManager.playMusic(this, 'garden')
    audioManager.setIntensity(
      !state.talkedTo.includes('garden_fluttershy') ? 0 : state.flowers.length >= FLOWERS.length ? 2 : 1
    )
    // 本章的配音先预加载（flowerHints 是无角色的旁白，不走配音）
    audioManager.preloadVoiceClips(this, [...gardenIntro, ...fluttershyBrief, ...gardenDone])
    fadeIn(this)

    this.player = new Player(this, 480, 430)
    this.player.bounds = { x: 70, y: 130, w: 820, h: 390 }
    this.player.setObstacles([{ x: 480, y: 300, r: 60 }]) // 溪流石头

    // 三朵目标花
    this.collectibles = [
      new Collectible(this, 220, 320, 'flower_pink'),
      new Collectible(this, 620, 380, 'flower_purple'),
      new Collectible(this, 400, 240, 'flower_white')
    ]

    // 柔柔（右上）
    this.add.image(780, 220, 'fluttershy_stand').setScale(1.15).setDepth(220)

    this.player.say(gardenIntro).then(() => {
      toast(this, controller('点一下花，星莓会走过去采（这一步先找柔柔说话）', '收集三朵特别的花：粉色、紫色、白色'))
    })

    // 从存档继续时，可能已经采过花了
    if (state.flowers.length >= FLOWERS.length) this.openExit(false)

    // 走到目标旁边就自动交互 + 每个交互点显示提示光圈
    this.wireInteractions()

    this.input.keyboard!.on('keydown-E', () => this.tryInteract())
    this.input.keyboard!.on('keydown-SPACE', () => this.tryInteract())
  }

  /** 光圈与底部提示的接线（坐标只在 targets() 里写一次） */
  private wireInteractions() {
    const briefed = () => state.talkedTo.includes('garden_fluttershy')
    setupInteractionHighlights(this, this.player, {
      targets: this.targets(),
      visuals: [
        { x: 780, y: 220, radius: 34, reach: 62, color: 0xff9ad5, enabled: () => !briefed() },
        ...this.collectibles.map((c) => ({
          x: () => c.spr.x,
          y: () => c.spr.y - 6,
          radius: 26,
          reach: 58,
          sprite: c.spr,
          enabled: () => briefed() && !c.collected
        })),
        {
          x: 900,
          y: 150,
          radius: 32,
          reach: 66,
          color: 0xffe066,
          enabled: () => this.exitOpen && state.flowers.length >= FLOWERS.length
        }
      ],
      hud: {
        idle: controller('点一下花或地面，星莓会走过去', '点一下花或地面走过去 · 也可用 WASD 移动'),
        near: controller('走到发光的点就会自动互动', '走到发光的点自动互动，或按 E / 空格')
      }
    })
  }

  /** 本章所有可交互目标：键盘按 E 与"走到就自动交互"共用同一份 */
  private targets(): InteractTarget[] {
    const briefed = () => state.talkedTo.includes('garden_fluttershy')
    return [
      {
        x: 780,
        y: 220,
        radius: 78,
        reach: 62,
        enabled: () => !briefed(),
        run: () => this.talkFluttershy()
      },
      ...this.collectibles.map((c) => ({
        x: c.spr.x,
        y: c.spr.y,
        radius: 52,
        reach: 58,
        enabled: () => briefed() && !c.collected,
        run: () => this.collectFlower(c)
      })),
      {
        x: 900,
        y: 150,
        radius: 74,
        reach: 66,
        enabled: () => this.exitOpen && state.flowers.length >= FLOWERS.length,
        run: () => this.goNext()
      }
    ]
  }

  /** 没打招呼时的提示语 */
  private fallbackHint(): string {
    if (!state.talkedTo.includes('garden_fluttershy')) return '点一下柔柔，走过去和她说话'
    return state.flowers.length >= FLOWERS.length ? '点右上角的星星出口' : '点一下花，星莓会走过去采'
  }

  tryInteract() {
    if (this.player.busy) return
    const px = this.player.spr.x
    const py = this.player.spr.y
    handleInteraction(this, px, py, this.targets(), this.fallbackHint())
  }

  /** 第一章剧情：柔柔交代三朵花的用意 */
  async talkFluttershy() {
    this.fluttershyMet = true
    await this.player.say(fluttershyBrief)
    if (!state.talkedTo.includes('garden_fluttershy')) state.talkedTo.push('garden_fluttershy')
    // 聊过之后音乐长出琶音
    audioManager.setIntensity(1)
    saveGame()
  }

  async collectFlower(c: Collectible) {
    const key = c.spr.texture.key.replace('flower_', '')
    await this.player.say([{ text: flowerHints[key] ?? '一朵漂亮的花。' }])
    await c.collect()
    if (!state.flowers.includes(key)) state.flowers.push(key)
    toast(this, `收集到${FLOWER_LABEL[key]}（${state.flowers.length}/3）`)
    saveGame()

    if (state.flowers.length >= FLOWERS.length) {
      // 全部集齐
      await this.player.say(gardenDone)
      audioManager.setIntensity(2)
      this.openExit(true)
      state.phase = 'box'
      saveGame()
    } else {
      audioManager.setIntensity(1.5)
    }
  }

  /** 出口出现星星（fromCelebration = 刚采完花，需要播一次闪烁） */
  private openExit(fromCelebration: boolean) {
    if (this.exitOpen) return
    this.exitOpen = true
    const star = this.add.image(900, 150, 'star_gold').setScale(1.6).setDepth(30)
    if (fromCelebration) {
      star.setScale(0)
      this.tweens.add({ targets: star, scale: 1.6, duration: 500, yoyo: true, repeat: 2 })
    } else {
      this.tweens.add({ targets: star, alpha: 0.6, duration: 800, yoyo: true, repeat: -1 })
    }
    toast(this, controller('点右上角的星星出口', '走向右上角的星星出口'))
  }

  async goNext() {
    this.player.busy = true
    state.phase = 'box'
    saveGame()
    await fadeOut(this)
    this.scene.start('BoxScene')
  }

  update(time: number, delta: number) {
    this.player.update(delta)
  }

  buildGarden() {
    const W = 960
    const H = 560
    // 天空
    this.add.rectangle(0, 0, W, H, 0xbfeaff).setOrigin(0).setDepth(0)
    this.add.rectangle(0, 0, W, H, 0xfff0d8, 0.18).setOrigin(0).setDepth(0)
    // 草地
    this.add.rectangle(0, 330, W, H - 330, 0xa8e58a).setOrigin(0).setDepth(1)
    this.add.rectangle(0, 326, W, 10, 0x8fd66f).setOrigin(0).setDepth(1)
    // 太阳
    this.add.circle(120, 90, 34, 0xffe066).setDepth(2)
    // 彩虹
    const rainbow = this.add.graphics().setDepth(2)
    const colors = [0xff5a78, 0xffa05a, 0xffe066, 0x8fd66f, 0x53d8d0, 0x7a5cff, 0xc9a3ff]
    colors.forEach((c, i) => {
      rainbow.lineStyle(8, c)
      rainbow.beginPath()
      rainbow.arc(700, 200, 120 + i * 10, Math.PI, 1.9 * Math.PI)
      rainbow.strokePath()
    })
    // 溪流
    const stream = this.add.graphics().setDepth(1)
    stream.fillStyle(0x9ad7ff, 0.6)
    stream.fillEllipse(480, 300, 260, 40)
    // 装饰小花（避开三朵目标花的位置，避免玩家分不清哪个能采）
    const targets = [
      { x: 220, y: 320 },
      { x: 620, y: 380 },
      { x: 400, y: 240 }
    ]
    const clear = (x: number, y: number) => targets.every((t) => Math.hypot(t.x - x, t.y - y) > 95)
    let placed = 0
    let guard = 0
    while (placed < 14 && guard++ < 300) {
      const k = ['flower_pink', 'flower_purple', 'flower_white', 'flower_pink'][placed % 4]
      const x = 90 + Math.random() * 780
      const y = 345 + Math.random() * 190
      if (!clear(x, y)) continue
      this.add.image(x, y, k).setScale(0.8).setDepth(2).setAlpha(0.85)
      placed++
    }
    // 蝴蝶
    for (let i = 0; i < 3; i++) {
      const b = this.add.image(200 + i * 220, 150 + i * 40, 'butterfly').setDepth(6)
      this.tweens.add({
        targets: b,
        x: b.x + (i % 2 ? 60 : -60),
        y: b.y + 40,
        duration: 2500 + i * 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      })
      this.tweens.add({ targets: b, angle: (i % 2 ? 1 : -1) * 8, duration: 900, yoyo: true, repeat: -1 })
    }
    // 云
    this.add.image(760, 100, 'cloud').setScale(1.3).setDepth(3).setAlpha(0.9)
    this.add.image(300, 80, 'cloud').setScale(1).setDepth(3).setAlpha(0.8)
    // 星星光点
    for (let i = 0; i < 8; i++) {
      const s = this.add
        .image(Math.random() * W, Math.random() * 120, 'star_spark')
        .setDepth(4)
        .setScale(0.5)
        .setAlpha(0.6)
      this.tweens.add({ targets: s, alpha: 0.1, scale: 0.7, duration: 1200 + i * 200, yoyo: true, repeat: -1 })
    }
  }
}
