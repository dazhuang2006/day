import Phaser from 'phaser'
import { audioManager } from '../audio'
import { loadPrefs, TEXT_SPEED_MS } from '../prefs'

export type Line = {
  who?: string // 角色 key，用于头像与配色；undefined = 旁白
  name?: string // 显示名覆盖
  text: string
  onShown?: () => void
}

const NAME_COLORS: Record<string, number> = {
  starberry: 0xc9458f,
  twilight: 0x7a4bb0,
  fluttershy: 0xff9ad5,
  applejack: 0xd07a20,
  rainbow: 0x3fa0e0,
  rarity: 0x9a6fc0,
  pinkie: 0xff5aa8,
  narrator: 0x8a6fa8
}

export const CHARACTER_NAMES: Record<string, string> = {
  starberry: '星莓',
  twilight: '紫悦',
  fluttershy: '柔柔',
  applejack: '苹果嘉儿',
  rainbow: '云宝',
  rarity: '珍奇',
  pinkie: '碧琪'
}

export const whoName = (who?: string, name?: string): string =>
  name ?? (who ? CHARACTER_NAMES[who] || who : '')

export type DialogueOptions = {
  portrait?: boolean
  speed?: number
}

export async function dialogue(scene: Phaser.Scene, lines: Line[], opts: DialogueOptions = {}): Promise<void> {
  const W = scene.scale.width
  const H = scene.scale.height
  // 默认速度跟随玩家在设置里选的那一档
  const speed = opts.speed ?? TEXT_SPEED_MS[loadPrefs().textSpeed]
  const showPortrait = opts.portrait !== false

  const boxW = W - 60
  const boxH = 134
  const bx = 30
  const by = H - boxH - 24

  // 注意：对话框必须画在所有"气氛遮罩"之上。
  // 第五章会铺一层 depth=1000 的黑幕当夜色，之前对话框只有 900，结果整块被压暗到看不清。
  // 这里统一抬到 1500：高于所有场景内遮罩，低于转场用的淡入淡出（2000）。
  const container = scene.add.container(0, 0).setDepth(1500)

  const bg = scene.add.graphics()
  bg.fillStyle(0xffffff, 0.96)
  bg.fillRoundedRect(bx, by, boxW, boxH, 18)
  bg.lineStyle(3, 0xffc9e0, 1)
  bg.strokeRoundedRect(bx, by, boxW, boxH, 18)
  container.add(bg)

  const portraitX = bx + 46
  const portraitY = by + boxH / 2
  let portraitSpr: Phaser.GameObjects.Image | null = null
  let portraitFrame: Phaser.GameObjects.Graphics | null = null

  const textXWith = portraitX + 96
  const textXWithout = bx + 26

  if (showPortrait) {
    portraitFrame = scene.add.graphics()
    portraitFrame.fillStyle(0xfff0f6)
    portraitFrame.fillCircle(portraitX, portraitY, 42)
    portraitFrame.lineStyle(2.5, 0xff9ad5)
    portraitFrame.strokeCircle(portraitX, portraitY, 42)
    container.add(portraitFrame)
    const tex = scene.textures.exists('starberry_stand') ? 'starberry_stand' : undefined
    if (tex) {
      // 贴图 72px、相框直径 84px，正面稿会稍微溢出，镜像后反而刚好贴合
      portraitSpr = scene.add.image(portraitX, portraitY, tex).setScale(-1.05, 1.05)
      container.add(portraitSpr)
    }
  }

  const nameText = scene.add
    .text(textXWith, by + 14, '', {
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
      fontSize: '20px',
      fontStyle: 'bold',
      color: '#7a4bb0'
    })
    .setDepth(1501)
  container.add(nameText)

  const bodyText = scene.add
    .text(textXWith, by + 50, '', {
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
      fontSize: '19px',
      lineSpacing: 9,
      color: '#4a3657',
      wordWrap: { width: boxW - 150, useAdvancedWrap: true }
    })
    .setDepth(1501)
  container.add(bodyText)

  /**
   * 旁白（没有 who）时不显示头像，并且把文字区左移、加宽——
   * 夜戏里一直亮着星莓的头像很出戏，空着个圆框也难看。
   */
  const setSpeaker = (who?: string) => {
    const has = !!who && !!portraitSpr
    if (portraitFrame) portraitFrame.setVisible(has)
    portraitSpr?.setVisible(has)
    if (has && portraitSpr) {
      const tex = `${who}_stand`
      if (scene.textures.exists(tex)) portraitSpr.setTexture(tex)
    }
    const x = has ? textXWith : textXWithout
    nameText.setX(x)
    bodyText.setX(x)
    bodyText.setWordWrapWidth(boxW - (has ? 150 : 60), true)
  }

  // 操作提示：手机端没有键盘，只提示"点击"
  const isTouch = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  const hint = scene.add
    .text(bx + boxW - 30, by + boxH - 22, isTouch ? '点击继续 ▼' : 'Ctrl 加速 · Esc 跳过 ▼', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#d08ab8'
    })
    .setOrigin(1, 1)
    .setAlpha(0)
  container.add(hint)

  let lineIdx = 0
  let typing = false
  let done = false
  let fast = false

  // 推进到下一句时的轻响（很轻，不打断阅读）
  function playBlip() {
    audioManager.playBlip()
  }

  let resolveFn: () => void = () => {}
  const finished = new Promise<void>((r) => (resolveFn = r))

  // 打字机计时器
  const timer = scene.time.addEvent({ delay: speed, loop: true, callback: () => {} })
  timer.paused = true

  // 长按 Ctrl 快进（一次多吐 3 个字）
  const setFast = (on: boolean) => {
    if (fast === on) return
    fast = on
    // TimerEvent.delay 在类型上是只读的，用 reset 改比较安全
    timer.reset({ delay: on ? speed / 3 : speed, loop: true, callback: tick, callbackScope: null })
  }

  const setFull = () => {
    const l = lines[lineIdx]
    bodyText.setText(l.text)
    typing = false
    setFast(false)
    timer.paused = true
    hint.setAlpha(1)
  }

  const tick = () => {
    if (!typing) return
    const l = lines[lineIdx]
    const cur = bodyText.text
    if (cur.length < l.text.length) {
      const step = fast ? 3 : 1
      bodyText.setText(l.text.slice(0, cur.length + step))
      if (bodyText.text.length >= l.text.length) setFull()
    } else {
      setFull()
    }
  }
  timer.callback = tick

  const showLine = (idx: number) => {
    const l = lines[idx]
    setSpeaker(l.who)
    if (l.who) {
      nameText.setText(whoName(l.who, l.name))
      nameText.setColor('#' + NAME_COLORS[l.who].toString(16).padStart(6, '0'))
    } else {
      nameText.setText('')
    }
    bodyText.setText('')
    typing = true
    hint.setAlpha(0)
    timer.paused = false
    l.onShown?.()
    // 有真人配音就播（第一次调用会触发异步解码，这里没赶上也无妨：
    // 台词本身照常显示，预加载过的句子正常都能命中）。
    // 注意：这里**故意不做合成声线兜底**——没有配音文件时保持静音打字，
    // 绝不用振荡器合成的电子音去顶替真人配音。
    if (l.who) audioManager.sayVoiceLine(scene, l.who, l.text)
  }

  const advance = () => {
    if (done) return
    if (typing) {
      setFull()
      return
    }
    lineIdx++
    if (lineIdx >= lines.length) {
      done = true
      cleanup()
      container.destroy()
      resolveFn()
    } else {
      playBlip()
      showLine(lineIdx)
    }
  }

  const skipAll = () => {
    if (done) return
    done = true
    cleanup()
    container.destroy()
    resolveFn()
  }

  // 输入
  const keyObj = scene.input.keyboard!.addKeys('SPACE,Z,ENTER,CTRL') as {
    SPACE: Phaser.Input.Keyboard.Key
    Z: Phaser.Input.Keyboard.Key
    ENTER: Phaser.Input.Keyboard.Key
    CTRL: Phaser.Input.Keyboard.Key
  }
  const keysArr: Phaser.Input.Keyboard.Key[] = [keyObj.SPACE, keyObj.Z, keyObj.ENTER]

  const onAdvance = () => advance()
  const onPointer = () => advance()
  const onCtrlDown = () => setFast(true)
  const onCtrlUp = () => setFast(false)

  const cleanup = () => {
    keysArr.forEach((k) => k.off('down', onAdvance))
    scene.input.off('pointerdown', onPointer)
    keyObj.CTRL.off('down', onCtrlDown)
    keyObj.CTRL.off('up', onCtrlUp)
    timer.remove()
    // 跳过或结束时，把还没念完的配音掐掉，别让它漏到下一幕
    audioManager.stopVoice()
  }

  keysArr.forEach((k) => k.on('down', onAdvance))
  scene.input.on('pointerdown', onPointer)
  // 长按 Ctrl 加速打字
  keyObj.CTRL.on('down', onCtrlDown)
  keyObj.CTRL.on('up', onCtrlUp)
  // 按 Esc 跳过整段对话
  const skipKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC, false)
  skipKey.on('down', skipAll)

  showLine(0)
  return finished
}

/** 短气泡台词（用于彩蛋 / 简单互动），不弹全屏对话 */
export function sayBubble(scene: Phaser.Scene, text: string, x: number, y: number, who?: string) {
  const color = who ? '#' + NAME_COLORS[who].toString(16).padStart(6, '0') : '#7a4bb0'
  const t = scene.add
    .text(x, y - 30, text, {
      fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
      fontSize: '17px',
      color,
      backgroundColor: 'rgba(255,255,255,0.95)',
      padding: { x: 12, y: 8 }
    })
    .setOrigin(0.5)
    .setDepth(880)
  t.setAlpha(0)
  scene.tweens.add({ targets: t, alpha: 1, duration: 180, yoyo: false })
  scene.tweens.add({
    targets: t,
    y: t.y - 14,
    alpha: 0,
    duration: 900,
    delay: 2200,
    onComplete: () => t.destroy()
  })
  return t
}
