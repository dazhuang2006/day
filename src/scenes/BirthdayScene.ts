import Phaser from 'phaser'
import { dialogue, sayBubble } from './dialogue'
import { LETTER } from '../data/birthdayLetter'
import { MEMORIES } from '../data/memories'
import { audioManager } from '../audio'
import { fadeIn } from '../sceneUtils'
import { saveGame } from '../persistence'
import { state } from '../config'
import { FINALE_VIDEO } from '../config'
import { playFinaleVideo } from '../video'

// 隐藏彩蛋台词（十六节）
const EASTER: Record<string, string[]> = {
  twilight: ['我当然知道今天是什么日子。', '但我答应星莓不能说。'],
  pinkie: ['我差一点就说出来了！', '还好我忍住了！'],
  rainbow: ['我可是跑遍了整个小马谷才把东西送过来的！'],
  rarity: ['这份礼物的包装，可是我亲自设计的。'],
  applejack: ['甜点可是我的拿手好戏。'],
  fluttershy: ['小动物们也准备了一份小礼物。']
}

const PARTY = ['twilight', 'fluttershy', 'applejack', 'rainbow', 'rarity', 'pinkie']

export class BirthdayScene extends Phaser.Scene {
  constructor() {
    super('BirthdayScene')
  }

  create() {
    this.buildCabin()
    // 主题曲从第四章就开始了，这里如果还在放就继续，不要从头重播
    if (!audioManager.isPlayingMusic('birthday')) audioManager.playMusic(this, 'birthday')
    fadeIn(this, 700)

    // 读档继续且信已经读完：直接进自由互动模式
    if (state.letterRead && state.phase === 'done') {
      this.freeExplore()
      return
    }

    // 结尾顺序：结尾语 → 生日信 → 自由互动。
    // 注意 1：合唱（birthdayShout）已经在 SurpriseScene 里播过了，这里不能再播一次。
    // 注意 2：不能再用 delayedCall 起并行定时器——freeExplore() 会清掉场景里所有文字，
    //         那样会把还没读完的对话框一起清掉。这里改成严格串行。
    this.time.delayedCall(600, () => {
      this.runFinale().catch((e) => console.warn('[finale]', e))
    })
  }

  private async runFinale() {
    await this.ending()
    await this.showLetter()
    // 信读完之后放收尾视频（文件缺失会自动跳过，不影响流程）
    const played = await this.playFinale()
    // mode='replace' 表示视频就是结尾，不进自由互动
    if (played && FINALE_VIDEO.mode === 'replace') return
    this.freeExplore()
  }

  /** 播放收尾视频。返回是否真的播了（没有视频/播不起来时返回 false） */
  private async playFinale(): Promise<boolean> {
    if (!FINALE_VIDEO.src) return false
    // 'wait' 模式下读档重进不再重播（那时 letterRead 已经是 true）
    if (FINALE_VIDEO.mode === 'wait' && state.finaleVideoSeen) return false

    const result = await playFinaleVideo({
      src: FINALE_VIDEO.src,
      width: this.scale.width,
      height: this.scale.height,
      skippable: FINALE_VIDEO.skippable,
      skipAfter: FINALE_VIDEO.skipAfter,
      // 播放期间让游戏音频彻底让位，只留视频原声。
      // 注意不能用"压低音量"——Phaser 播的音乐不走 audioManager 的 GainNode，
      // 调总线音量对它无效（之前"打开视频音乐还在响"就是这个原因）。
      onStart: () => audioManager.setVideoSilence(true),
      onEnd: () => audioManager.setVideoSilence(false)
    })

    // 只有真播过才记为"看过"；文件缺失不算
    if (result === 'ended' || result === 'skipped') {
      state.finaleVideoSeen = true
      saveGame()
      return true
    }
    return false
  }

  async showLetter() {
    const W = this.scale.width
    const H = this.scale.height

    const panel = this.add
      .rectangle(W / 2, H / 2, W - 140, H - 60, 0xffffff, 0.97)
      .setStrokeStyle(3, 0xff9ad5)
      .setDepth(1500)
    const title = this.add
      .text(W / 2, 96, LETTER.title, {
        fontFamily: 'Microsoft YaHei',
        fontSize: '30px',
        fontStyle: 'bold',
        color: '#c9458f'
      })
      .setOrigin(0.5)
      .setDepth(1501)

    const body = this.add
      .text(W / 2, 150, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '19px',
        lineSpacing: 12,
        align: 'center',
        color: '#4a3657',
        wordWrap: { width: W - 240, useAdvancedWrap: true }
      })
      .setOrigin(0.5, 0)
      .setDepth(1502)

    const pageHint = this.add
      .text(W / 2, H - 120, '点击继续 ▸', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '16px',
        color: '#d08ab8'
      })
      .setOrigin(0.5)
      .setDepth(1503)

    const sign = this.add
      .text(W / 2, H - 70, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '22px',
        fontStyle: 'bold',
        color: '#7a4bb0'
      })
      .setOrigin(0.5)
      .setDepth(1503)

    let page = 0
    const PAGES: string[][] = []
    for (let i = 0; i < LETTER.lines.length; i += 4) {
      PAGES.push(LETTER.lines.slice(i, i + 4))
    }

    const typePage = (idx: number, resolve: () => void) => {
      body.setText('')
      const full = PAGES[idx].join('\n')
      let i = 0
      const timer = this.time.addEvent({
        delay: 28,
        loop: true,
        callback: () => {
          i++
          body.setText(full.slice(0, i))
          if (i >= full.length) {
            timer.remove()
            if (idx === PAGES.length - 1) sign.setText(LETTER.sign)
            resolve()
          }
        }
      })
    }

    // 读完信时用它通知 runFinale()：本函数不自己往下演，避免流程被打乱
    let finish: () => void = () => {}
    const letterDone = new Promise<void>((r) => (finish = r))

    // 信读完后出现的按钮。
    // 之前是"信一读完就自动收面板并播视频"，太唐突——玩家还没来得及看最后一眼。
    // 现在改成：信留在屏幕上，出现一个按钮，点它才收信并进入视频。
    const openBtn = this.add
      .text(W / 2, H - 118, '', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#c9458f',
        padding: { left: 26, right: 26, top: 12, bottom: 12 }
      })
      .setOrigin(0.5)
      .setDepth(1510)
      .setAlpha(0)
      .setVisible(false)

    openBtn.setInteractive({ useHandCursor: true })
    // 轻微呼吸感，提示这是可点的
    this.tweens.add({
      targets: openBtn,
      scale: { from: 1, to: 1.04 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })

    /** 收掉信件并放行到下一步（视频） */
    const closeLetter = () => {
      this.input.off('pointerdown', advance)
      this.input.keyboard!.off('keydown-SPACE', advance)
      this.input.keyboard!.off('keydown-ENTER', advance)
      this.tweens.killTweensOf(openBtn)
      panel.destroy()
      title.destroy()
      body.destroy()
      pageHint.destroy()
      sign.destroy()
      openBtn.destroy()
      state.letterRead = true
      state.phase = 'done'
      saveGame()
      finish()
    }

    let letterWaiting = false
    let advancing = false
    const advance = async () => {
      if (advancing || letterWaiting) return
      if (page < PAGES.length) {
        advancing = true
        await new Promise<void>((r) => typePage(page, r))
        page++
        if (page >= PAGES.length) {
          pageHint.setText('点击，读完这封信')
          sign.setText(LETTER.sign)
        }
        advancing = false
        return
      }
      // 已经翻到最后一页，再点一次 = 信真的读完了。
      // 这里不马上收信，而是把按钮亮出来，让玩家自己决定什么时候继续。
      letterWaiting = true
      pageHint.setText('')
      openBtn.setText(FINALE_VIDEO.letterButtonText)
      openBtn.setVisible(true)
      this.tweens.add({ targets: openBtn, alpha: 1, duration: 260, ease: 'Sine.easeOut' })
      openBtn.off('pointerup')
      // 用 pointerup 而不是 pointerdown：按钮是在 pointerdown 的处理过程中才被激活的，
      // 同一次点击不会回头再派发给它，绑 pointerdown 会"第一次点没反应"。
      openBtn.on('pointerup', () => closeLetter())
    }

    // 先打出第一页
    await new Promise<void>((r) => typePage(0, r))
    page = 1
    this.input.on('pointerdown', advance)
    this.input.keyboard!.on('keydown-SPACE', advance)
    this.input.keyboard!.on('keydown-ENTER', advance)

    // 一直等到玩家读完这封信（或直接跳过）
    return letterDone
  }

  // —— 结尾 & 自由互动模式 ——
  async ending() {
    const W = this.scale.width
    const H = this.scale.height
    const show = (s: string, delay: number, size = 40) =>
      new Promise<void>((r) => {
        this.time.delayedCall(delay, () => {
          const t = this.add
            .text(W / 2, H / 2 - 40, s, {
              fontFamily: 'Microsoft YaHei',
              fontSize: `${size}px`,
              fontStyle: 'bold',
              color: '#c9458f'
            })
            .setOrigin(0.5)
            .setDepth(900)
            .setAlpha(0)
          this.tweens.add({ targets: t, alpha: 1, duration: 700, onComplete: () => r() })
        })
      })

    await show('今天的秘密任务完成。', 0, 32)
    await show('生日快乐。', 900, 46)
    await show('愿你的每一天，都有属于自己的星星。', 1400, 26)
  }

  freeExplore() {
    const W = this.scale.width
    const H = this.scale.height
    // 清空结尾文字
    this.children.list
      .filter((c) => c instanceof Phaser.GameObjects.Text)
      .forEach((c: any) => {
        if ((c as Phaser.GameObjects.Text).text !== undefined) c.destroy()
      })

    const guide = this.add
      .text(W / 2, 40, '可以在小屋里，和大家多待一会儿', {
        fontFamily: 'Microsoft YaHei',
        fontSize: '18px',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(900)

    // 角色彩蛋
    PARTY.forEach((k, i) => {
      const x = W / 2 - 230 + i * 92
      const spr = this.add.image(x, 330, `${k}_stand`).setScale(1.15).setDepth(330)
      spr.setInteractive({ useHandCursor: true })
      spr.on('pointerdown', () => {
        const lines = EASTER[k] ?? []
        if (lines.length) sayBubble(this, lines[0], x, 300, k)
      })
    })
    // 星莓
    const sb = this.add.image(W / 2, 260, 'starberry_stand').setScale(1.3).setDepth(260)
    sb.setInteractive({ useHandCursor: true })
    sb.on('pointerdown', () => {
      sayBubble(this, '今天的星星，都在为你亮着。', W / 2, 220, 'starberry')
    })

    // 记忆彩蛋（可点击的星星 / 花）
    // 位置要避开屋子中央的蛋糕(480,200)和彩灯(90)，否则会撞出两块蛋糕
    const memSpots = [
      { x: 170, y: 265 },
      { x: 800, y: 300 },
      { x: 330, y: 205 },
      { x: 640, y: 300 },
      { x: 300, y: 450 }
    ]
    MEMORIES.forEach((m, i) => {
      const spot = memSpots[i % memSpots.length]
      const icon = m.icon
      let key = 'star_gold'
      if (icon.includes('flower')) key = 'flower_pink'
      else if (icon === 'wrapPaper') key = 'ribbon'
      else if (icon === 'cake_base') key = 'cake_base'
      else if (icon === 'ribbon') key = 'ribbon'
      const spr = this.add.image(spot.x, spot.y, key).setScale(0.9).setDepth(200).setAlpha(0.9)
      spr.setInteractive({ useHandCursor: true })
      spr.on('pointerdown', () => {
        audioManager.playCollect()
        sayBubble(this, m.text, spot.x, spot.y - 20)
      })
      this.tweens.add({ targets: spr, alpha: 0.5, scale: 1.05, duration: 900, yoyo: true, repeat: -1 })
    })
  }

  buildCabin() {
    const W = 960
    const H = 560
    // 夜空
    this.add.rectangle(0, 0, W, H, 0x241a4a).setOrigin(0)
    this.add.rectangle(0, 0, W, H, 0x5a3a8a, 0.3).setOrigin(0)
    // 繁星
    for (let i = 0; i < 26; i++) {
      const s = this.add.image(Math.random() * W, Math.random() * 160, i % 3 ? 'star_spark' : 'star_gold').setDepth(1).setScale(0.4).setAlpha(0.7)
      this.tweens.add({ targets: s, alpha: 0.15, scale: 0.55, duration: 1100 + i * 130, yoyo: true, repeat: -1 })
    }
    // 小屋地板
    this.add.rectangle(0, 380, W, H - 380, 0x4a3a6a).setOrigin(0)
    this.add.rectangle(0, 376, W, 8, 0x7a5a9a).setOrigin(0)
    // 彩灯
    for (let i = 0; i < 14; i++) {
      const colors = ['fairy_light', 'fairy_light_pink', 'fairy_light_blue', 'fairy_light_green']
      const l = this.add.image(40 + i * 68, 90, colors[i % 4]).setScale(1.5).setDepth(20)
      this.tweens.add({ targets: l, scale: 2, alpha: 0.3, duration: 600 + i * 60, yoyo: true, repeat: -1 })
    }
    // 中央蛋糕
    this.add.image(W / 2, 200, 'cake_base').setScale(1.5).setDepth(150)
  }
}
