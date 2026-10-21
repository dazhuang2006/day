import Phaser from 'phaser'
import { Player, type InteractTarget } from '../player'
import { introLines, introBoxProbe, introCalendar } from '../data/dialogue'
import { audioManager } from '../audio'
import { fadeIn, fadeOut, toast, handleInteraction, controlHint as controller } from '../sceneUtils'
import { setupInteractionHighlights } from '../objects/interactSetup'
import { saveGame } from '../persistence'
import { state } from '../config'

export class IntroScene extends Phaser.Scene {
  player!: Player
  boxSeen = false
  calendarSeen = false
  /** 布景里可交互的几件东西（提示光圈要跟随它们的位置） */
  private boxSprite: Phaser.GameObjects.Rectangle | null = null
  private calSprite: Phaser.GameObjects.Rectangle | null = null
  private doorSprite: Phaser.GameObjects.Rectangle | null = null

  constructor() {
    super('IntroScene')
  }

  create() {
    this.buildRoom()
    audioManager.playMusic(this, 'morning')
    // 本章的配音先预加载，避免第一句因为还在解码而没声音
    audioManager.preloadVoiceClips(this, [...introLines, ...introBoxProbe, ...introCalendar])
    fadeIn(this)

    this.player = new Player(this, 480, 430)
    this.player.bounds = { x: 70, y: 150, w: 820, h: 360 }
    this.player.setObstacles([
      { x: 300, y: 300, r: 70 }, // 床
      { x: 640, y: 240, r: 55 } // 桌子
    ])

    if (state.introSeen) {
      // 从存档继续：开场白已经看过，只给引导
      toast(this, controller('点一下桌上的日历，星莓会自己走过去', '桌上有日历，过去看看吧（点一下或按 E）'))
    } else {
      this.player.say(introLines).then(() => {
        state.introSeen = true
        saveGame()
        toast(this, controller('点一下桌上的日历，星莓会自己走过去', '桌上有日历，过去看看吧（点一下或按 E）'))
      })
    }

    this.input.keyboard!.on('keydown-E', () => this.tryInteract())
    this.input.keyboard!.on('keydown-SPACE', () => this.tryInteract())

    // 手机端：走到目标旁边就自动交互 + 每个交互点显示提示光圈
    this.wireInteractions()
  }

  tryInteract() {
    if (this.player.busy) return
    handleInteraction(
      this,
      this.player.spr.x,
      this.player.spr.y,
      this.targets(),
      '点一下桌上的日历或床边的盒子，星莓会走过去'
    )
  }

  /** 本章所有可交互目标：键盘与"走到就自动交互"共用 */
  private targets(): InteractTarget[] {
    return [
      {
        x: 360,
        y: 405,
        radius: 58,
        reach: 58,
        enabled: () => !this.boxSeen,
        run: () => this.interactBox()
      },
      {
        // 日历在桌子上方，桌子障碍会把玩家挡开 ~73px，所以判定要放宽一点，
        // 否则走到桌前也不会触发（这就是"走到日历没反应"的原因）
        x: 655,
        y: 210,
        radius: 92,
        reach: 92,
        enabled: () => !this.calendarSeen,
        run: () => this.interactCalendar()
      },
      { x: 878, y: 360, radius: 76, reach: 66, run: () => this.interactDoor() }
    ]
  }

  /** 光圈与提示接线 */
  private wireInteractions() {
    setupInteractionHighlights(this, this.player, {
      targets: this.targets(),
      visuals: [
        // 光圈画在物件"身前"一点：压在日历/门上会被布景挡住，看不清
        { x: 360, y: 418, radius: 26, reach: 58, sprite: this.boxSprite ?? undefined, enabled: () => !this.boxSeen },
        {
          x: 655,
          y: 232,
          radius: 30,
          reach: 92,
          sprite: this.calSprite ?? undefined,
          enabled: () => !this.calendarSeen
        },
        { x: 866, y: 380, radius: 30, reach: 66, enabled: () => this.calendarSeen && this.boxSeen }
      ],
      hud: {
        idle: '点一下地面，星莓会走过去',
        near: '走到发光的位置就会自动互动'
      }
    })
  }

  async interactBox() {
    this.boxSeen = true
    await this.player.say(introBoxProbe)
    toast(this, '桌上有日历，别忘了看看')
  }

  async interactCalendar() {
    this.calendarSeen = true
    await this.player.say(introCalendar)
    toast(this, '出房间，去花园吧')
  }

  async interactDoor() {
    if (!this.calendarSeen) {
      toast(this, '先看看桌上的日历吧')
      return
    }
    if (!this.boxSeen) {
      toast(this, '床那边……是不是有什么？')
      return
    }
    this.player.busy = true
    state.phase = 'garden'
    saveGame()
    await fadeOut(this)
    this.scene.start('GardenScene')
  }

  update(time: number, delta: number) {
    this.player.update(delta)
  }

  buildRoom() {
    const W = 960
    const H = 560
    // 房间背景
    this.add.rectangle(0, 0, W, H, 0xfff2fb).setOrigin(0).setDepth(0)
    // 地板
    this.add.rectangle(0, 340, W, H - 340, 0xffe3ef).setOrigin(0).setDepth(1)
    this.add.rectangle(0, 336, W, 8, 0xffc9e0).setOrigin(0).setDepth(1)
    // 墙裙
    this.add.rectangle(0, 280, W, 56, 0xffd9ea).setOrigin(0).setDepth(1)
    // 窗口（窗外是晨光）
    this.add.rectangle(140, 200, 200, 160, 0xbfeaff).setDepth(2)
    this.add.rectangle(140, 200, 200, 160, 0xffe9a0, 0.25).setDepth(3)
    this.add.rectangle(140, 120, 206, 6, 0xffc9e0).setDepth(4)
    this.add.rectangle(140, 282, 206, 6, 0xffc9e0).setDepth(4)
    this.add.rectangle(40, 200, 6, 166, 0xffc9e0).setDepth(4)
    this.add.rectangle(240, 200, 6, 166, 0xffc9e0).setDepth(4)
    this.add.rectangle(140, 200, 6, 166, 0xffc9e0).setDepth(4)
    // 太阳
    this.add.circle(70, 150, 22, 0xffe066).setDepth(4)
    // 窗外云
    this.add.image(210, 130, 'cloud').setScale(1.1).setDepth(4).setAlpha(0.9)
    // 小鸟
    this.add.text(200, 180, '♪', { fontSize: '20px', color: '#8a6fa8' }).setDepth(5)
    // 床
    const bed = this.add.graphics().setDepth(2)
    bed.fillStyle(0xffb7d5)
    bed.fillRoundedRect(240, 250, 140, 110, 12)
    bed.fillStyle(0xffffff)
    bed.fillRoundedRect(252, 242, 116, 34, 12) // 枕头
    bed.fillStyle(0xb98bff)
    bed.fillRoundedRect(268, 278, 84, 66, 10) // 被子
    // 小盒子（藏在床下，可接近）
    this.add.rectangle(336, 384, 46, 6, 0x8a5a44).setDepth(2).setAlpha(0.7) // 床腿
    const box = this.add.rectangle(360, 400, 34, 26, 0xff9ec7).setDepth(4)
    this.boxSprite = box
    this.add.rectangle(360, 396, 34, 4, 0xff7fb1).setDepth(5)
    this.add.rectangle(358, 398, 2, 22, 0xfff3e0).setDepth(5)
    box.setData('box', true)
    // 桌子 + 日历
    const table = this.add.graphics().setDepth(2)
    table.fillStyle(0xffc9a3)
    table.fillRoundedRect(600, 210, 110, 60, 8)
    table.fillStyle(0x9a6f4f)
    table.fillRect(610, 270, 10, 90)
    table.fillRect(690, 270, 10, 90)
    // 日历（被翻过去，内容不可读）
    const cal = this.add.rectangle(655, 196, 56, 40, 0xfff3e0).setDepth(4)
    this.calSprite = cal
    this.add.rectangle(655, 188, 56, 6, 0xff9ec7).setDepth(5)
    this.add.circle(648, 214, 3, 0xff6f9f).setDepth(5).setAlpha(0.8)
    this.add.circle(662, 214, 3, 0xff6f9f).setDepth(5).setAlpha(0.8)
    cal.setData('calendar', true)
    // 门
    const door = this.add.rectangle(878, 360, 66, 130, 0xc9a3ff).setDepth(2)
    this.doorSprite = door
    this.add.rectangle(878, 360, 10, 130, 0x9a6fc0).setDepth(3)
    this.add.circle(858, 360, 3, 0xffe066).setDepth(4)
    door.setData('door', true)
  }
}
