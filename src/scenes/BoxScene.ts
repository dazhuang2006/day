import Phaser from 'phaser'
import { Player, type InteractTarget } from '../player'
import { boxIntro, twilightBrief, boxItemHints, rarityWrap } from '../data/dialogue'
import { Collectible } from '../objects/Collectible'
import { Gift } from '../objects/Gift'
import { BOX_ITEMS, BOX_ITEM_LABEL, state } from '../config'
import { audioManager } from '../audio'
import { fadeIn, fadeOut, toast, handleInteraction, controlHint as controller } from '../sceneUtils'
import { setupInteractionHighlights } from '../objects/interactSetup'
import { saveGame } from '../persistence'

export class BoxScene extends Phaser.Scene {
  player!: Player
  collectibles: Collectible[] = []
  gift!: Gift
  rarityMet = false
  wrapped = false

  constructor() {
    super('BoxScene')
  }

  create() {
    this.buildCabin()
    audioManager.playMusic(this, 'garden')
    audioManager.setIntensity(state.talkedTo.includes('box_twilight') ? 1 : 0)
    // 本章的配音先预加载（boxItemHints 是无角色的旁白，不走配音）
    audioManager.preloadVoiceClips(this, [...boxIntro, ...twilightBrief, ...rarityWrap])
    fadeIn(this)

    this.player = new Player(this, 480, 440)
    this.player.bounds = { x: 80, y: 150, w: 800, h: 360 }

    this.gift = new Gift(this, 620, 280)
    this.collectibles = [
      new Collectible(this, 200, 380, 'ribbon'),
      new Collectible(this, 300, 230, 'starDeco'),
      new Collectible(this, 700, 220, 'wrapPaper'),
      new Collectible(this, 830, 380, 'hanging')
    ]

    this.add.image(170, 200, 'rarity_stand').setScale(1.15).setDepth(200)
    // 紫悦来对计划（本章剧情门槛）
    this.add.image(860, 490, 'twilight_stand').setScale(1.15).setDepth(490)

    if (state.boxIntroSeen) {
      // 从存档继续：开场白已经看过
      toast(this, state.giftWrapped ? controller('点左上角的出口去苹果园', '礼物已经包好了，去左上角出口') : controller('点一下要捡的东西，星莓会走过去拿', '找到包装要用的四样东西吧'))
    } else {
      this.player.say(boxIntro).then(() => {
        state.boxIntroSeen = true
        saveGame()
        toast(this, controller('点一下要捡的东西，星莓会走过去拿', '找到包装要用的四样东西吧'))
      })
    }

    // 从存档继续：已经包好礼物时不再重播包装动画，直接把礼物显示出来
    if (state.giftWrapped) {
      this.wrapped = true
      this.gift.showInner('star_gold')
    }

    // 走到目标旁边就自动交互 + 每个交互点显示提示光圈
    this.wireInteractions()

    this.input.keyboard!.on('keydown-E', () => this.tryInteract())
    this.input.keyboard!.on('keydown-SPACE', () => this.tryInteract())
  }

  /** 光圈与底部提示的接线（坐标只在 targets() 里写一次） */
  private wireInteractions() {
    const briefed = () => state.talkedTo.includes('box_twilight')
    setupInteractionHighlights(this, this.player, {
      targets: this.targets(),
      visuals: [
        { x: 860, y: 490, radius: 34, reach: 62, color: 0xc9a3ff, enabled: () => !briefed() },
        { x: 620, y: 280, radius: 30, reach: 56, sprite: this.gift.box, enabled: () => !this.wrapped },
        ...this.collectibles.map((c) => ({
          x: () => c.spr.x,
          y: () => c.spr.y - 6,
          radius: 26,
          reach: 58,
          sprite: c.spr,
          enabled: () => briefed() && !c.collected
        })),
        { x: 170, y: 200, radius: 34, reach: 62, color: 0xc9a3ff, enabled: () => !this.rarityMet },
        {
          x: 60,
          y: 170,
          radius: 32,
          reach: 66,
          color: 0xffe066,
          enabled: () => this.wrapped
        }
      ],
      hud: {
        idle: controller('点一下要拿的东西，星莓会走过去', '点一下走过去 · 也可用 WASD 移动'),
        near: controller('走到发光的点就会自动互动', '走到发光的点自动互动，或按 E / 空格')
      }
    })
  }

  tryInteract() {
    if (this.player.busy) return
    handleInteraction(
      this,
      this.player.spr.x,
      this.player.spr.y,
      this.targets(),
      this.fallbackHint()
    )
  }

  /** 本章所有可交互目标：键盘与"走到就自动交互"共用 */
  private targets(): InteractTarget[] {
    const briefed = () => state.talkedTo.includes('box_twilight')
    return [
      {
        x: 860,
        y: 490,
        radius: 78,
        reach: 62,
        enabled: () => !briefed(),
        run: () => this.talkTwilight()
      },
      {
        x: 620,
        y: 280,
        radius: 62,
        reach: 56,
        enabled: () => !this.wrapped,
        run: () => this.probeBox()
      },
      ...this.collectibles.map((c) => ({
        x: c.spr.x,
        y: c.spr.y,
        radius: 52,
        reach: 58,
        enabled: () => briefed() && !c.collected,
        run: () => this.collectItem(c)
      })),
      {
        x: 170,
        y: 200,
        radius: 78,
        reach: 62,
        enabled: () => !this.rarityMet,
        run: () => this.talkRarity()
      },
      {
        x: 60,
        y: 170,
        radius: 74,
        reach: 66,
        enabled: () => this.wrapped,
        run: () => this.goNext()
      }
    ]
  }

  private fallbackHint(): string {
    if (!state.talkedTo.includes('box_twilight')) return '点右下角的紫悦，走过去听她说今天的安排'
    return this.wrapped ? '点左上角的出口去苹果园' : '点一下要捡的东西，星莓会走过去拿'
  }

  /** 第二章剧情：紫悦来对计划 */
  private async talkTwilight() {
    await this.player.say(twilightBrief)
    if (!state.talkedTo.includes('box_twilight')) state.talkedTo.push('box_twilight')
    audioManager.setIntensity(1)
    saveGame()
  }

  private async probeBox() {
    await this.player.say([{ who: 'starberry', text: '还不到时候……先把东西找齐吧。' }])
  }

  private async talkRarity() {
    this.rarityMet = true
    await this.player.say([
      { who: 'rarity', text: '亲爱的，你终于来了。' },
      { who: 'starberry', text: '我、我在准备一点小东西……' },
      { who: 'rarity', text: '嘘——我懂。交给我吧。' }
    ])
  }

  async collectItem(c: Collectible) {
    const key = c.spr.texture.key
    await this.player.say([{ text: boxItemHints[key] ?? '找到一件东西。' }])
    await c.collect()
    if (!state.items.includes(key)) state.items.push(key)
    toast(this, `找到${BOX_ITEM_LABEL[key]}（${state.items.length}/4）`)
    audioManager.setIntensity(state.items.length >= BOX_ITEMS.length ? 2 : 1.5)
    saveGame()

    if (state.items.length >= BOX_ITEMS.length && !this.wrapped) {
      this.wrapped = true
      state.giftWrapped = true
      await this.player.say(rarityWrap)
      // 珍奇包装动画：盒子变成礼物
      await this.gift.open('star_gold')
      state.wrapSeen = true
      state.phase = 'dessert'
      saveGame()
      toast(this, '礼物包装好了……去苹果园找苹果嘉儿吧')
    }
  }

  async goNext() {
    this.player.busy = true
    state.phase = 'dessert'
    saveGame()
    await fadeOut(this)
    this.scene.start('DessertScene')
  }

  update(time: number, delta: number) {
    this.player.update(delta)
  }

  buildCabin() {
    const W = 960
    const H = 560
    this.add.rectangle(0, 0, W, H, 0xfdf0f5).setOrigin(0)
    // 地板
    this.add.rectangle(0, 360, W, H - 360, 0xf2d9c0).setOrigin(0)
    this.add.rectangle(0, 356, W, 8, 0xe0b88a).setOrigin(0)
    // 木纹
    const grain = this.add.graphics()
    grain.lineStyle(2, 0xe0b88a, 0.4)
    for (let i = 0; i < 5; i++) grain.lineBetween(0, 380 + i * 45, W, 380 + i * 45)
    // 窗户（左墙）
    this.add.rectangle(150, 200, 150, 130, 0xbfeaff).setDepth(2)
    this.add.rectangle(150, 135, 156, 6, 0xffc9a3).setDepth(3)
    this.add.rectangle(150, 267, 156, 6, 0xffc9a3).setDepth(3)
    this.add.rectangle(75, 200, 6, 136, 0xffc9a3).setDepth(3)
    this.add.rectangle(225, 200, 6, 136, 0xffc9a3).setDepth(3)
    this.add.image(150, 200, 'cloud').setScale(0.9).setDepth(2).setAlpha(0.8)
    // 架子
    this.add.rectangle(820, 240, 90, 8, 0xffc9a3).setDepth(1)
    // 桌子 + 盒子位置
    const table = this.add.graphics().setDepth(1)
    table.fillStyle(0xffc9a3)
    table.fillRoundedRect(560, 250, 130, 40, 8)
    table.fillStyle(0x9a6f4f)
    table.fillRect(572, 290, 12, 110)
    table.fillRect(668, 290, 12, 110)
    // 门（左墙偏下，作出口）
    this.add.rectangle(60, 170, 46, 120, 0xc9a3ff).setDepth(2)
    // 地面小毯子
    this.add.ellipse(480, 470, 240, 60, 0xffd9ea).setDepth(1)
  }
}
