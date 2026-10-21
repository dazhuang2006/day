import Phaser from 'phaser'
import { Player, type InteractTarget } from '../player'
import {
  eveningIntro,
  eveningGreet,
  twilightHelper,
  rainbowHelper,
  pinkieHelper,
  rarityHelper,
  fluttershyHelper,
  applejackHelper,
  eveningMonologue
} from '../data/dialogue'
import { Decoration } from '../objects/Decoration'
import { DECOR_TASKS, DECOR_LABEL, state } from '../config'
import { audioManager } from '../audio'
import { fadeIn, fadeOut, toast, handleInteraction, controlHint as controller } from '../sceneUtils'
import { setupInteractionHighlights } from '../objects/interactSetup'
import { saveGame } from '../persistence'

// ============================================================
// 本章的唯一数据源：每个布置槽位在哪、用什么贴图、由哪位朋友带来。
// （以前是 GIVER + GIVER_BY_SLOT 两张手写表，必须人工保持一致，
//   一旦挪动槽位就会静默卡关；现在反过来从 SLOT 生成，不可能对不上。）
// ============================================================
type SlotDef = { x: number; y: number; texture: string; giver?: string }

const SLOTS: SlotDef[] = [
  { x: 480, y: 170, texture: 'fairy_light', giver: 'twilight' }, // 挂灯
  { x: 180, y: 250, texture: 'flower_pink', giver: 'fluttershy' }, // 放花
  { x: 620, y: 280, texture: 'star_gold', giver: 'twilight' }, // 摆桌子（桌布）
  { x: 700, y: 300, texture: 'mystery_box', giver: 'applejack' }, // 放礼物
  { x: 830, y: 230, texture: 'cake_base', giver: 'pinkie' }, // 放甜点
  { x: 300, y: 210, texture: 'star_pink', giver: 'rainbow' }, // 放星星装饰
  { x: 880, y: 380, texture: 'ribbon', giver: 'rarity' } // 放彩带
]

// 每位朋友这次带来了哪几件东西（由 SLOTS 反推，不再手写）
const GIFTS_BY_GIVER: Record<string, { slots: number[]; toast: string }> = (() => {
  const toastText: Record<string, string> = {
    twilight: '收到紫悦带来的灯串和桌布',
    fluttershy: '收到柔柔养好的花',
    applejack: '收到苹果嘉儿带来的礼物',
    pinkie: '收到碧琪端来的甜点',
    rainbow: '收到云宝带回来的星星装饰',
    rarity: '收到珍奇挑好的彩带'
  }
  const map: Record<string, { slots: number[]; toast: string }> = {}
  SLOTS.forEach((s, i) => {
    if (!s.giver) return
    if (!map[s.giver]) map[s.giver] = { slots: [], toast: toastText[s.giver] ?? '收到一件布置物' }
    map[s.giver].slots.push(i)
  })
  return map
})()

// 角色站位：刻意和布置槽位拉开距离，避免"想找角色聊天却一直在布置"
const CHARACTER_SPOTS = [
  { key: 'twilight', x: 620, y: 170, lines: twilightHelper },
  { key: 'rainbow', x: 220, y: 200, lines: rainbowHelper },
  { key: 'pinkie', x: 860, y: 330, lines: pinkieHelper },
  { key: 'rarity', x: 760, y: 460, lines: rarityHelper },
  { key: 'fluttershy', x: 160, y: 360, lines: fluttershyHelper },
  { key: 'applejack', x: 820, y: 190, lines: applejackHelper }
] as const

export class EveningScene extends Phaser.Scene {
  player!: Player
  slots: Decoration[] = []
  placedCount = 0
  finished = false

  constructor() {
    super('EveningScene')
  }

  create() {
    this.buildCabin()
    // 进屋（和每位朋友挨个说话）就从这里开始放主题曲：
    // 只要 assets/audio/birthday.mp3 存在，它会一直放到终章结束，中途不再换曲。
    audioManager.playMusic(this, 'birthday')
    // 本章的配音先预加载，避免第一句因为还在解码而没声音
    audioManager.preloadVoiceClips(this, [
      ...eveningIntro,
      ...Object.values(eveningGreet).flat(),
      ...twilightHelper,
      ...rainbowHelper,
      ...pinkieHelper,
      ...rarityHelper,
      ...fluttershyHelper,
      ...applejackHelper,
      ...eveningMonologue
    ])
    fadeIn(this)

    this.player = new Player(this, 480, 470)
    this.player.bounds = { x: 80, y: 150, w: 800, h: 370 }

    // 布置槽位（没收到东西之前是半透明的"空位"提示）
    this.slots = SLOTS.map((s) => new Decoration(this, s.x, s.y, s.texture))

    // 存档继续：已经收到的东西重新出现，已经布置好的直接呈放置状态
    this.slots.forEach((s, i) => {
      if (state.decorations.includes(DECOR_TASKS[i])) {
        s.placeImmediately()
        return
      }
      const giver = SLOTS[i].giver
      if (!giver || state.received.includes(giver)) s.reveal()
    })
    this.placedCount = state.decorations.length
    if (this.placedCount >= DECOR_TASKS.length) this.finished = true
    this.refreshIntensity()

    // 角色精灵
    CHARACTER_SPOTS.forEach((s) => this.add.image(s.x, s.y, `${s.key}_stand`).setScale(1.1).setDepth(s.y))
    if (state.eveningIntroSeen) {
      toast(this, controller('点一下朋友，星莓会走过去打招呼', '和大家打招呼吧——她们会各自把准备好的东西交给你'))
    } else {
      this.player.say(eveningIntro).then(() => {
        state.eveningIntroSeen = true
        saveGame()
        toast(this, controller('点一下朋友，星莓会走过去打招呼', '和大家打招呼吧——她们会各自把准备好的东西交给你'))
      })
    }

    // 走到目标旁边就自动交互 + 每个交互点显示提示光圈
    this.wireInteractions()

    this.input.keyboard!.on('keydown-E', () => this.tryInteract())
    this.input.keyboard!.on('keydown-SPACE', () => this.tryInteract())
  }

  /** 光圈与底部提示的接线（坐标只在 SLOTS / CHARACTER_SPOTS 里写一次） */
  private wireInteractions() {
    setupInteractionHighlights(this, this.player, {
      targets: this.targets(),
      visuals: [
        ...this.slots.map((s, i) => ({
          x: s.spr.x,
          y: s.spr.y,
          radius: 26,
          reach: 54,
          color: 0xffe066,
          enabled: () => s.canPlace(SLOTS[i].giver, state.received)
        })),
        ...CHARACTER_SPOTS.map((spot) => ({
          x: spot.x,
          y: spot.y,
          radius: 30,
          reach: 60,
          color: 0xff9ad5,
          // 已经拿过东西的人不再亮圈，避免一屋子光圈看不出重点
          enabled: () => !state.received.includes(spot.key)
        }))
      ],
      hud: {
        idle: controller('点一下朋友，星莓会走过去打招呼', '点一下朋友走过去 · 也可用 WASD 移动'),
        near: controller('走到发光的点就会自动互动', '走到发光的点自动互动，或按 E / 空格')
      }
    })
  }

  tryInteract() {
    if (this.player.busy || this.finished) return
    handleInteraction(
      this,
      this.player.spr.x,
      this.player.spr.y,
      this.targets(),
      '点一下朋友或发光的位置，星莓会自己走过去'
    )
  }

  /** 本章所有可交互目标：键盘与"走到就自动交互"共用 */
  private targets(): InteractTarget[] {
    return [
      // 槽位优先：收到东西之后，站在发光位置就是"布置"
      ...this.slots.map((s, i) => ({
        x: s.spr.x,
        y: s.spr.y,
        radius: 52,
        reach: 54,
        enabled: () => s.canPlace(SLOTS[i].giver, state.received),
        run: () => this.place(s)
      })),
      // 朋友：随时可以聊天；第一次找她会把准备好的东西交给你
      ...CHARACTER_SPOTS.map((spot) => ({
        x: spot.x,
        y: spot.y,
        radius: 64,
        reach: 60,
        run: () => this.talkTo(spot.key)
      }))
    ]
  }

  /** 和一位朋友打招呼：她把手里的东西交给星莓（重复找她只会聊天） */
  private async talkTo(key: string) {
    const spot = CHARACTER_SPOTS.find((s) => s.key === key)
    if (!spot) return
    if (!state.talkedTo.includes(`evening_${key}`)) state.talkedTo.push(`evening_${key}`)
    if (key === 'rainbow') this.rainbowFly()
    await this.player.say(eveningGreet[key] ?? ([...spot.lines] as any))

    const gift = GIFTS_BY_GIVER[key]
    if (gift && !state.received.includes(key)) {
      state.received.push(key)
      gift.slots.forEach((i) => this.slots[i]?.reveal())
      toast(this, gift.toast)
      this.refreshIntensity()
    }
    saveGame()
  }

  async place(s: Decoration) {
    const idx = this.slots.indexOf(s)
    const taskKey = DECOR_TASKS[idx]
    await this.player.say([{ text: '（星莓认真地把东西摆好。）' }])
    await s.place()
    if (!state.decorations.includes(taskKey)) state.decorations.push(taskKey)
    this.placedCount = state.decorations.length
    toast(this, `布置完成：${DECOR_LABEL[taskKey]}（${this.placedCount}/${DECOR_TASKS.length}）`)
    this.refreshIntensity()

    if (this.placedCount >= DECOR_TASKS.length) {
      this.finished = true
      state.phase = 'surprise'
      saveGame()
      await this.finishEvening()
    } else {
      saveGame()
    }
  }

  /** 音乐厚度跟着布置进度长：0 件=只有垫音，越多越满 */
  private refreshIntensity() {
    if (this.placedCount >= DECOR_TASKS.length) audioManager.setIntensity(2)
    else if (this.placedCount > 0) audioManager.setIntensity(1.5)
    else audioManager.setIntensity(state.received.length > 1 ? 1 : 0)
  }

  async finishEvening() {
    // 音乐推到最满，房间随之亮起
    audioManager.setIntensity(2)
    this.cameras.main.flash(200, 255, 240, 250, false)
    await this.player.say(eveningMonologue)
    this.player.busy = true
    await fadeOut(this, 1000)
    this.scene.start('SurpriseScene')
  }

  rainbowFly() {
    const r = this.add.image(100, 180, 'rainbow_stand').setScale(1.1).setDepth(20).setAlpha(0.9)
    this.tweens.add({
      targets: r,
      x: 900,
      y: 220,
      duration: 900,
      ease: 'Sine.easeInOut',
      onComplete: () => r.destroy()
    })
  }

  update(time: number, delta: number) {
    this.player.update(delta)
  }

  buildCabin() {
    const W = 960
    const H = 560
    this.add.rectangle(0, 0, W, H, 0x2a2350).setOrigin(0) // 傍晚的暗紫色
    this.add.rectangle(0, 0, W, H, 0x6a4a9a, 0.35).setOrigin(0)
    // 窗外星光
    for (let i = 0; i < 20; i++) {
      const s = this.add.image(Math.random() * W, Math.random() * 160, 'star_spark').setDepth(1).setScale(0.4).setAlpha(0.7)
      this.tweens.add({ targets: s, alpha: 0.15, duration: 1000 + i * 120, yoyo: true, repeat: -1 })
    }
    this.add.image(90, 60, 'cloud').setScale(0.8).setDepth(1).setAlpha(0.5)
    this.add.image(850, 70, 'cloud').setScale(0.9).setDepth(1).setAlpha(0.5)
    // 地板
    this.add.rectangle(0, 380, W, H - 380, 0x4a3a6a).setOrigin(0)
    this.add.rectangle(0, 376, W, 8, 0x7a5a9a).setOrigin(0)
    // 墙裙
    this.add.rectangle(0, 300, W, 76, 0x3a2f58).setOrigin(0)
    // 窗户（月光）
    this.add.rectangle(150, 200, 160, 140, 0x5360b0).setDepth(2)
    this.add.rectangle(150, 134, 166, 6, 0x8a7ab0).setDepth(3)
    this.add.rectangle(150, 268, 166, 6, 0x8a7ab0).setDepth(3)
    // 空桌（布置后放礼物与甜点）
    const table = this.add.graphics().setDepth(1)
    table.fillStyle(0x7a5a9a)
    table.fillRoundedRect(600, 300, 150, 40, 8)
    table.fillStyle(0x4a3a6a)
    table.fillRect(612, 340, 12, 100)
    table.fillRect(726, 340, 12, 100)
    // 挂灯绳（预留）
    this.add.rectangle(480, 190, 600, 2, 0x8a7ab0).setAlpha(0.6).setDepth(2)
  }
}
