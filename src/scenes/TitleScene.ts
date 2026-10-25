import Phaser from 'phaser'
import { GAME, PHASE_LABEL, PHASE_START, resetState, state } from '../config'
import { readSave, clearSave, saveGame, applySave } from '../persistence'
import { loadPrefs, savePrefs, TEXT_SPEED_LABEL, type Prefs } from '../prefs'
import { audioManager } from '../audio'
import { fadeIn, fadeOut } from '../sceneUtils'

// 设置面板打开时，回车/空格不再等于"继续游戏"
let settingsOpen = false

// 标题界面：新游戏 / 继续 / 跳过序章
export class TitleScene extends Phaser.Scene {
  private busy = false

  constructor() {
    super('TitleScene')
  }

  create() {
    // 先把存档读进内存，这样"继续"能定位到正确的章节
    const save = readSave()
    if (save) applySave(save)

    const W = this.scale.width
    const H = this.scale.height

    // 夜色调，和终章呼应
    this.add.rectangle(0, 0, W, H, 0x241a4a).setOrigin(0)
    this.add.rectangle(0, 0, W, H, 0x5a3a8a, 0.28).setOrigin(0)

    // 星星
    for (let i = 0; i < 40; i++) {
      const s = this.add
        .image(Math.random() * W, Math.random() * H, i % 3 ? 'star_spark' : 'star_gold')
        .setScale(0.3 + Math.random() * 0.3)
        .setAlpha(0.5)
        .setDepth(1)
      this.tweens.add({
        targets: s,
        alpha: 0.12,
        duration: 900 + Math.random() * 1400,
        yoyo: true,
        repeat: -1
      })
    }

    // 中央灯光
    const glow = this.add.circle(W / 2, H / 2 + 40, 210, 0xffd9ea, 0.1).setDepth(2)
    this.tweens.add({ targets: glow, scale: 1.1, alpha: 0.16, duration: 2600, yoyo: true, repeat: -1 })

    // 标题
    this.add
      .text(W / 2, 108, GAME.title, {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '52px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(10)
      .setShadow(0, 4, '#7a4bb0', 12, false, true)

    this.add
      .text(W / 2, 160, GAME.subtitle, {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '20px',
        color: '#ffd9ea'
      })
      .setOrigin(0.5)
      .setDepth(10)

    // 主角（贴图由 BootScene 生成）
    const pony = this.add.sprite(W / 2, 268, 'starberry_stand').setScale(1.5).setDepth(10)
    if (this.anims.exists('starberry_walk')) pony.anims.play('starberry_walk', true)
    this.tweens.add({
      targets: pony,
      y: pony.y - 8,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })

    // 按键提示（手机端没有键盘，改成触摸说明）
    const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    this.add
      .text(
        W / 2,
        H - 24,
        isTouch
          ? '点一下地面走过去 · 走到东西旁边会自动互动 · 点屏幕推进对话'
          : 'W A S D / 方向键 或 点击移动　·　E / 空格 交互　·　空格 / 回车 / 点击 推进对话',
        {
          fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
          fontSize: '13px',
          color: '#c9b6e8'
        }
      )
      .setOrigin(0.5)
      .setDepth(10)

    // 按钮
    const labels: { text: string; action: () => void; primary?: boolean }[] = [
      { text: '新的一天', action: () => this.startNew(), primary: true }
    ]
    if (save) {
      labels.push({
        text: `继续 · ${PHASE_LABEL[save.phase] ?? '继续游戏'}`,
        action: () => this.continueGame(),
        primary: true
      })
    }
    labels.push({ text: '跳过序章，直接去花园', action: () => this.skipIntro() })

    labels.forEach((b, i) => {
      const y = 366 + i * 54
      this.makeButton(W / 2, y, b.text, b.action, b.primary)
    })
    this.makeSettingsButton(W - 96, H - 38)

    // 有存档时，回车 / 空格 = 继续
    if (save) {
      this.input.keyboard!.on('keydown-ENTER', () => {
        if (!settingsOpen) this.continueGame()
      })
      this.input.keyboard!.on('keydown-SPACE', () => {
        if (!settingsOpen) this.continueGame()
      })
    }

    fadeIn(this, 500)
    audioManager.resumeOnGesture()
  }

  private makeButton(x: number, y: number, label: string, action: () => void, primary = false) {
    const w = 380
    const h = 48
    const g = this.add.graphics().setDepth(20)
    const paint = (hover: boolean) => {
      g.clear()
      g.fillStyle(primary ? 0xc9458f : 0x6a4a9a, hover ? 1 : 0.82)
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 24)
      g.lineStyle(2, hover ? 0xfff3e0 : 0xffc9e0, hover ? 1 : 0.7)
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 24)
    }
    paint(false)

    const t = this.add
      .text(x, y, label, {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '19px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(21)

    const zone = this.add
      .zone(x, y, w, h)
      .setOrigin(0.5)
      .setDepth(22)
      .setInteractive({ useHandCursor: true })

    zone.on('pointerover', () => {
      paint(true)
      t.setScale(1.04)
    })
    zone.on('pointerout', () => {
      paint(false)
      t.setScale(1)
    })
    zone.on('pointerdown', () => {
      audioManager.playCollect()
      action()
    })
  }

  private guard(): boolean {
    if (this.busy) return false
    this.busy = true
    return true
  }

  /** 右下角的设置入口 */
  private makeSettingsButton(x: number, y: number) {
    const w = 150
    const h = 36
    const g = this.add.graphics().setDepth(20)
    const paint = (hover: boolean) => {
      g.clear()
      g.fillStyle(0x6a4a9a, hover ? 0.95 : 0.7)
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 18)
      g.lineStyle(1.5, 0xffc9e0, hover ? 0.9 : 0.5)
      g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 18)
    }
    paint(false)
    this.add
      .text(x, y, '设置 / 音量', {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '14px',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(21)
    const zone = this.add.zone(x, y, w, h).setOrigin(0.5).setDepth(22).setInteractive({ useHandCursor: true })
    zone.on('pointerover', () => paint(true))
    zone.on('pointerout', () => paint(false))
    zone.on('pointerdown', () => this.openSettings())
  }

  /**
   * 设置面板：音乐音量 / 静音 / 文字速度。
   * 面板遮住全屏并吃掉点击，避免误触下面的按钮。
   */
  private openSettings() {
    if (settingsOpen) return
    settingsOpen = true
    const W = this.scale.width
    const H = this.scale.height
    const cx = W / 2
    const cy = H / 2
    const pw = 520
    const ph = 300
    const objs: Phaser.GameObjects.GameObject[] = []

    const shade = this.add
      .rectangle(cx, cy, W, H, 0x150f2e, 0.72)
      .setDepth(1000)
      .setInteractive()
    const panel = this.add
      .rectangle(cx, cy, pw, ph, 0x2a2350, 0.98)
      .setStrokeStyle(2, 0xff9ad5)
      .setDepth(1001)
      .setInteractive()
    const title = this.add
      .text(cx, cy - ph / 2 + 34, '设置', {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '24px',
        fontStyle: 'bold',
        color: '#ffffff'
      })
      .setOrigin(0.5)
      .setDepth(1002)
    objs.push(shade, panel, title)

    const prefs = loadPrefs()
    const apply = () => {
      savePrefs(prefs)
      // 通知音频管理器立刻生效
      window.dispatchEvent(new CustomEvent<Prefs>('starberry:prefs', { detail: prefs }))
    }
    apply()

    const rowLabel = (text: string, y: number) => {
      const t = this.add
        .text(cx - pw / 2 + 40, y, text, {
          fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
          fontSize: '17px',
          color: '#ffd9ea'
        })
        .setOrigin(0, 0.5)
        .setDepth(1002)
      objs.push(t)
      return t
    }

    /** 一行选项：点一下就切换，选中项用 ● 标出来 */
    const optionRows: { refresh: () => void }[] = []
    const options = (
      y: number,
      startX: number,
      items: { label: () => string; selected: () => boolean; pick: () => void }[]
    ) => {
      let x = startX
      const texts: Phaser.GameObjects.Text[] = []
      items.forEach((item) => {
        const t = this.add
          .text(x, y, item.label(), {
            fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
            fontSize: '16px',
            fontStyle: 'bold',
            color: '#ffffff',
            backgroundColor: '#6a4a9a',
            padding: { x: 14, y: 7 }
          })
          .setOrigin(0, 0.5)
          .setDepth(1003)
          .setInteractive({ useHandCursor: true })
        t.on('pointerdown', () => {
          audioManager.playCollect()
          item.pick()
          apply()
          optionRows.forEach((r) => r.refresh())
        })
        texts.push(t)
        x += t.width + 10
        objs.push(t)
      })
      optionRows.push({
        refresh: () =>
          texts.forEach((t, i) => {
            t.setText(items[i].label())
            t.setColor(items[i].selected() ? '#ffe066' : '#ffffff')
          })
      })
    }

    rowLabel('音乐 / 音效', cy - 84)
    options(cy - 84, cx - 40, [
      {
        label: () => (prefs.muted ? '已静音 ✕' : '开着 ♪'),
        selected: () => !prefs.muted,
        pick: () => {
          prefs.muted = !prefs.muted
        }
      }
    ])

    rowLabel('音量', cy - 26)
    options(
      cy - 26,
      cx - 130,
      [0.25, 0.5, 0.7, 1].map((v) => ({
        label: () => `${Math.round(v * 100)}%`,
        selected: () => !prefs.muted && Math.abs(prefs.volume - v) < 0.01,
        pick: () => {
          prefs.volume = v
          prefs.muted = false
        }
      }))
    )

    rowLabel('文字速度', cy + 32)
    options(
      cy + 32,
      cx - 130,
      (['slow', 'normal', 'fast'] as Prefs['textSpeed'][]).map((s) => ({
        label: () => TEXT_SPEED_LABEL[s],
        selected: () => prefs.textSpeed === s,
        pick: () => {
          prefs.textSpeed = s
        }
      }))
    )

    optionRows.forEach((r) => r.refresh())

    const hint = this.add
      .text(cx, cy + ph / 2 - 44, '游戏里随时按 M 也能静音 / 取消静音', {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '13px',
        color: '#c9b6e8'
      })
      .setOrigin(0.5)
      .setDepth(1002)
    objs.push(hint)

    // 声音自检：手机上没法开控制台，点一下把关键状态显示出来（只读诊断，不影响游戏）
    const selfCheck = this.add
      .text(cx, cy + ph / 2 - 74, '声音自检 ▸', {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '14px',
        color: '#9fe3ff'
      })
      .setOrigin(0.5)
      .setDepth(1002)
      .setInteractive({ useHandCursor: true })
    selfCheck.on('pointerdown', () => {
      const PROBE = '亲爱的，你终于来了。'
      const d = audioManager.voiceDiagnostics(this, 'rarity', PROBE)
      selfCheck.setText(`试播中…`)
      const ok = audioManager.sayVoiceLine(this, 'rarity', PROBE)
      this.time.delayedCall(900, () => {
        const d2 = audioManager.voiceDiagnostics(this, 'rarity', PROBE)
        hint.setText(
          `音频:${d.ctx}  解锁:${this.sound.locked ? '否' : '是'}  ` +
            `配音:${d.total}条  缓存:${d2.cached ? '有' : d2.loading ? '加载中' : '无'}\n` +
            `试播:${ok ? '已发起' : d.loading ? '等加载' : '失败'}  ` +
            `在播:${d2.playing ? '是' : '否'}  静音:${d.muted ? '开' : '关'}  音量:${Math.round(d.volume * 100)}%`
        )
        hint.setColor('#ffe066')
        selfCheck.setText('声音自检 ▸')
      })
    })
    objs.push(selfCheck)

    const btn = this.add
      .text(cx, cy + ph / 2 - 18, '确定', {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '17px',
        fontStyle: 'bold',
        color: '#ffffff',
        backgroundColor: '#c9458f',
        padding: { x: 26, y: 8 }
      })
      .setOrigin(0.5)
      .setDepth(1003)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerdown', () => {
      settingsOpen = false
      objs.forEach((o) => o.destroy())
      btn.destroy()
    })
    objs.push(btn)
  }

  private go(scene: string) {
    fadeOut(this, 320).then(() => this.scene.start(scene))
  }

  startNew() {
    if (!this.guard()) return
    resetState()
    clearSave()
    state.phase = 'intro'
    saveGame()
    this.go('IntroScene')
  }

  continueGame() {
    if (!this.guard()) return
    const target = PHASE_START[state.phase] ?? PHASE_START.intro
    // 终章已读完信：直接进自由互动，不重复读信
    if (state.phase === 'done' && state.letterRead) {
      state.phase = 'done'
      this.go('BirthdayScene')
      return
    }
    this.go(target.scene)
  }

  skipIntro() {
    if (!this.guard()) return
    resetState()
    clearSave()
    state.phase = 'garden'
    saveGame()
    this.go('GardenScene')
  }
}
