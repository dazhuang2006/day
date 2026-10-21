import Phaser from 'phaser'
import { Player, type InteractTarget } from '../player'
import { dessertIntro, orchardBrief, dessertItemHints, dessertCook, dessertDone } from '../data/dialogue'
import { Collectible } from '../objects/Collectible'
import { DESSERT_ITEMS, DESSERT_ITEM_LABEL, TOPPINGS, state } from '../config'
import { audioManager } from '../audio'
import { fadeIn, fadeOut, toast, handleInteraction, controlHint as controller } from '../sceneUtils'
import { setupInteractionHighlights } from '../objects/interactSetup'
import { saveGame } from '../persistence'

export class DessertScene extends Phaser.Scene {
  player!: Player
  collectibles: Collectible[] = []
  miniActive = false
  chosenCount = 0
  options: Phaser.GameObjects.Arc[] = []
  optionUsed: boolean[] = []
  finishBtn: Phaser.GameObjects.Text | null = null
  miniToppings: Phaser.GameObjects.Arc[] = []
  private finished = false
  private panelObjs: Phaser.GameObjects.GameObject[] = []

  constructor() {
    super('DessertScene')
  }

  create() {
    this.buildOrchard()
    audioManager.playMusic(this, 'orchard')
    audioManager.setIntensity(state.talkedTo.includes('dessert_applejack') ? 1 : 0)
    // 本章的配音先预加载（dessertItemHints 是无角色的旁白，不走配音）
    audioManager.preloadVoiceClips(this, [...dessertIntro, ...orchardBrief, ...dessertCook, ...dessertDone])
    fadeIn(this)

    this.player = new Player(this, 480, 470)
    this.player.bounds = { x: 70, y: 140, w: 820, h: 380 }
    this.player.setObstacles([{ x: 320, y: 300, r: 60 }])

    this.collectibles = [
      new Collectible(this, 240, 400, 'apple'),
      new Collectible(this, 500, 350, 'strawberry'),
      new Collectible(this, 700, 420, 'cream'),
      new Collectible(this, 200, 240, 'chocolate'),
      new Collectible(this, 700, 240, 'icing')
    ]
    // 存档继续：已经采过的材料直接标记为已收集
    this.collectibles.forEach((c) => {
      if (state.dessertMaterials.includes(c.spr.texture.key)) c.markCollected()
    })

    // 苹果嘉儿（厨房前）
    this.add.image(820, 220, 'applejack_stand').setScale(1.15).setDepth(220)
    // 碧琪在旁边捣乱（本章剧情门槛）
    this.add.image(150, 190, 'pinkie_stand').setScale(1.1).setDepth(190)

    if (state.dessertIntroSeen) {
      // 从存档继续：开场白已经看过
      toast(this, state.dessertDone ? '甜点已经做好啦' : controller('点一下材料，星莓会走过去收', '收集甜点需要的五种材料吧'))
    } else {
      this.player.say(dessertIntro).then(() => {
        state.dessertIntroSeen = true
        saveGame()
        toast(this, controller('点一下材料，星莓会走过去收', '收集甜点需要的五种材料吧'))
      })
    }

    // 存档继续：材料已齐但甜点还没做完，直接放行厨房
    if (state.dessertDone) {
      this.finished = true
      this.createPortal()
    }

    // 走到目标旁边就自动交互 + 每个交互点显示提示光圈
    this.wireInteractions()

    this.input.keyboard!.on('keydown-E', () => this.tryInteract())
    this.input.keyboard!.on('keydown-SPACE', () => this.tryInteract())
  }

  /** 光圈与底部提示的接线（坐标只在 targets() 里写一次） */
  private wireInteractions() {
    const briefed = () => state.talkedTo.includes('dessert_applejack')
    const canAct = () => !this.miniActive
    setupInteractionHighlights(this, this.player, {
      targets: this.targets(),
      visuals: [
        { x: 820, y: 220, radius: 38, reach: 64, color: 0xffc26b, enabled: () => canAct() && !briefed() },
        ...this.collectibles.map((c) => ({
          x: () => c.spr.x,
          y: () => c.spr.y - 6,
          radius: 26,
          reach: 58,
          sprite: c.spr,
          enabled: () => canAct() && briefed() && !c.collected
        })),
        // 厨房：没材料时不亮（避免误导），材料齐了才显示
        {
          x: 820,
          y: 220,
          radius: 30,
          reach: 68,
          color: 0xffe066,
          enabled: () =>
            canAct() &&
            briefed() &&
            !this.finished &&
            state.dessertMaterials.length >= DESSERT_ITEMS.length
        },
        { x: 60, y: 170, radius: 32, reach: 66, color: 0x53d8d0, enabled: () => canAct() && this.finished }
      ],
      hud: {
        idle: controller('点一下材料，星莓会走过去收', '点一下走过去 · 也可用 WASD 移动'),
        near: controller('走到发光的点就会自动互动', '走到发光的点自动互动，或按 E / 空格')
      }
    })
  }

  /** 本章所有可交互目标：键盘与"走到就自动交互"共用 */
  private targets(): InteractTarget[] {
    const briefed = () => state.talkedTo.includes('dessert_applejack')
    // 小游戏面板开着的时候不要自动触发任何东西
    const canAct = () => !this.miniActive
    return [
      {
        x: 820,
        y: 220,
        radius: 88,
        reach: 64,
        enabled: () => canAct() && !briefed(),
        run: () => this.talkApplejack()
      },
      ...this.collectibles.map((c) => ({
        x: c.spr.x,
        y: c.spr.y,
        radius: 52,
        reach: 58,
        enabled: () => canAct() && briefed() && !c.collected,
        run: () => this.collectItem(c)
      })),
      {
        x: 820,
        y: 220,
        radius: 92,
        reach: 68,
        enabled: () => canAct() && briefed(),
        run: () => this.enterKitchen()
      },
      {
        x: 60,
        y: 170,
        radius: 74,
        reach: 66,
        enabled: () => canAct() && this.finished,
        run: () => this.goNext()
      }
    ]
  }

  private fallbackHint(): string {
    if (!state.talkedTo.includes('dessert_applejack')) return '点右边的苹果嘉儿，先问问要准备什么'
    return this.finished ? '点左下角的出口回小屋' : '点一下材料，星莓会走过去收'
  }

  tryInteract() {
    if (this.player.busy || this.miniActive) return
    handleInteraction(
      this,
      this.player.spr.x,
      this.player.spr.y,
      this.targets(),
      this.fallbackHint()
    )
  }

  /** 第三章剧情：苹果嘉儿交代材料，碧琪差点说漏嘴 */
  private async talkApplejack() {
    await this.player.say(orchardBrief)
    if (!state.talkedTo.includes('dessert_applejack')) state.talkedTo.push('dessert_applejack')
    audioManager.setIntensity(1)
    saveGame()
  }

  private async enterKitchen() {
    if (this.finished) {
      toast(this, '甜点已经做好啦，去左下角的出口吧')
      return
    }
    if (state.dessertMaterials.length >= DESSERT_ITEMS.length) {
      await this.startMini()
      return
    }
    await this.player.say([{ who: 'applejack', text: '材料还没齐呢，先去收齐吧。' }])
  }

  async collectItem(c: Collectible) {
    const key = c.spr.texture.key
    await this.player.say([{ text: dessertItemHints[key] ?? '一份材料。' }])
    await c.collect()
    if (!state.dessertMaterials.includes(key)) state.dessertMaterials.push(key)
    toast(this, `找到${DESSERT_ITEM_LABEL[key]}（${state.dessertMaterials.length}/5）`)
    audioManager.setIntensity(state.dessertMaterials.length >= DESSERT_ITEMS.length ? 2 : 1.5)
    saveGame()
    if (state.dessertMaterials.length >= DESSERT_ITEMS.length) {
      audioManager.setIntensity(2)
      await this.player.say(dessertCook)
      toast(this, '去厨房找苹果嘉儿，开始做甜点！')
    } else {
      audioManager.setIntensity(1.5)
    }
  }

  async startMini() {
    this.player.busy = true
    this.miniActive = true
    await this.buildMiniGame()
  }

  buildMiniGame(): Promise<void> {
    const W = this.scale.width
    const H = this.scale.height
    this.options = []
    this.optionUsed = []
    this.miniToppings = []
    this.chosenCount = 0
    return new Promise((res) => {
      // 半透明面板
      const panel = this.add.rectangle(W / 2, H / 2, W - 120, H - 60, 0xffffff, 0.94).setDepth(700)
      const title = this.add
        .text(W / 2, 116, '装饰“星莓的特别甜点”', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '26px',
          fontStyle: 'bold',
          color: '#c9458f'
        })
        .setOrigin(0.5)
        .setDepth(701)
      const tip = this.add
        .text(W / 2, 154, '点下面的材料，把它们放到甜点上（至少三种）', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '15px',
          color: '#9a6fc0'
        })
        .setOrigin(0.5)
        .setDepth(701)
      // 蛋糕
      const cake = this.add.image(W / 2, 305, 'cake_base').setScale(1.6).setDepth(702)
      // 选项行
      TOPPINGS.forEach((t, i) => {
        const x = W / 2 - 220 + i * 110
        const circle = this.add.circle(x, 448, 26, t.icon).setDepth(703).setStrokeStyle(3, 0xff9ad5)
        const label = this.add
          .text(x, 488, t.label, { fontFamily: 'Microsoft YaHei', fontSize: '16px', color: '#7a4bb0' })
          .setOrigin(0.5)
          .setDepth(704)
        circle.setInteractive({ useHandCursor: true })
        circle.on('pointerdown', () => this.chooseTopping(i, circle, t))
        this.options.push(circle)
        this.optionUsed.push(false)
        this.panelObjs.push(label)
      })
      // 完成按钮
      this.finishBtn = this.add
        .text(W / 2, 528, '做好了！', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#ffffff',
          backgroundColor: '#c9458f',
          padding: { x: 24, y: 10 }
        })
        .setOrigin(0.5)
        .setDepth(705)
        .setAlpha(0.5)
        .setInteractive({ useHandCursor: true })
      this.finishBtn.on('pointerdown', () => {
        if (this.chosenCount < 3) {
          toast(this, `再多放几种装饰吧（还需 ${3 - this.chosenCount} 种）`)
          return
        }
        this.teardownMini(panel, title, tip)
        res()
      })
    })
  }

  chooseTopping(i: number, circle: Phaser.GameObjects.Arc, t: (typeof TOPPINGS)[number]) {
    if (this.optionUsed[i]) return
    this.optionUsed[i] = true
    this.chosenCount++
    circle.setAlpha(0.35)
    circle.disableInteractive()
    if (!state.toppings.includes(t.key)) state.toppings.push(t.key)
    this.addToppingDecor(t.icon)
    if (this.chosenCount >= 3) this.finishBtn!.setAlpha(1)
  }

  addToppingDecor(color: number) {
    audioManager.playCollect()
    const cx = this.scale.width / 2
    const cy = 305
    // 沿蛋糕表面环形排列，整齐不重叠、都落在蛋糕上
    const n = this.chosenCount
    const total = 8
    const angle = (n - 1) * ((Math.PI * 2) / total) - Math.PI / 2
    const R = 30
    const px = cx + Math.cos(angle) * R * 1.3
    const py = cy + Math.sin(angle) * R * 0.9 + 4
    const s = this.add.circle(px, py, 13, color).setStrokeStyle(2, 0xffffff).setDepth(750).setScale(0)
    this.tweens.add({ targets: s, scale: 1, duration: 320, ease: 'Back.easeOut' })
    this.miniToppings.push(s)
  }

  private teardownMini(panel: Phaser.GameObjects.Rectangle, title: Phaser.GameObjects.Text, tip: Phaser.GameObjects.Text) {
    panel.destroy()
    title.destroy()
    tip.destroy()
    this.options.forEach((o) => o.destroy())
    this.panelObjs.forEach((o) => o.destroy())
    this.panelObjs = []
    this.options = []
    this.finishBtn?.destroy()
    this.finishBtn = null
    this.runDessertDone()
  }

  async runDessertDone() {
    this.miniActive = false
    await this.player.say(dessertDone)
    this.player.busy = false
    this.finished = true
    state.dessertDone = true
    state.phase = 'evening'
    saveGame()
    this.createPortal()
  }

  /** 出口（不再用 setInterval 轮询，改为统一的交互判定） */
  private createPortal() {
    const portal = this.add.image(60, 170, 'star_pink').setScale(1.5).setDepth(30)
    this.tweens.add({ targets: portal, scale: 1.8, alpha: 0.6, duration: 700, yoyo: true, repeat: -1 })
    toast(this, controller('点左下角的出口，回小屋吧', '走向左下角的出口，回小屋吧'))
  }

  private async goNext() {
    this.player.busy = true
    state.phase = 'evening'
    saveGame()
    await fadeOut(this)
    this.scene.start('EveningScene')
  }

  update(time: number, delta: number) {
    this.player.update(delta)
  }

  buildOrchard() {
    const W = 960
    const H = 560
    this.add.rectangle(0, 0, W, H, 0xfff0d8).setOrigin(0)
    this.add.rectangle(0, 360, W, H - 360, 0xa8e58a).setOrigin(0)
    // 苹果树（左侧果园）
    for (let i = 0; i < 3; i++) {
      const x = 160 + i * 200
      const g = this.add.graphics()
      g.fillStyle(0x9a6f4f)
      g.fillRoundedRect(x - 8, 340, 16, 90, 5)
      g.fillStyle(0x8fd66f)
      g.fillCircle(x, 300, 42)
      g.fillCircle(x - 26, 320, 30)
      g.fillCircle(x + 26, 320, 30)
      // 苹果
      for (let a = 0; a < 4; a++) {
        g.fillStyle(0xff5a5a)
        g.fillCircle(x - 20 + a * 13, 300 + (a % 2) * 12, 5)
      }
    }
    // 厨房（右侧）
    const kit = this.add.graphics()
    kit.fillStyle(0xf2d9c0)
    kit.fillRoundedRect(700, 160, 220, 200, 12)
    kit.fillStyle(0xffc9a3)
    kit.fillRoundedRect(700, 160, 220, 30, 12)
    // 灶台
    kit.fillStyle(0x9a6f4f)
    kit.fillRoundedRect(720, 300, 80, 40, 6)
    kit.fillRoundedRect(840, 300, 60, 40, 6)
    kit.fillStyle(0xffe066)
    kit.fillCircle(740, 320, 8)
    kit.fillCircle(780, 320, 8)
    // 太阳 / 云
    this.add.circle(120, 90, 32, 0xffe066).setDepth(2)
    this.add.image(760, 100, 'cloud').setScale(1.1).setDepth(3).setAlpha(0.9)
    // 蝴蝶
    const b = this.add.image(400, 200, 'butterfly').setDepth(6)
    this.tweens.add({ targets: b, x: 520, y: 260, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' })
  }
}
