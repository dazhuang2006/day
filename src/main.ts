import Phaser from 'phaser'
import { GAME, state } from './config'
import { audioManager } from './audio'
import { loadPrefs, savePrefs } from './prefs'
import { BootScene } from './scenes/BootScene'
import { TitleScene } from './scenes/TitleScene'
import { IntroScene } from './scenes/IntroScene'
import { GardenScene } from './scenes/GardenScene'
import { BoxScene } from './scenes/BoxScene'
import { DessertScene } from './scenes/DessertScene'
import { EveningScene } from './scenes/EveningScene'
import { SurpriseScene } from './scenes/SurpriseScene'
import { BirthdayScene } from './scenes/BirthdayScene'

// 首次用户操作时恢复音频（浏览器自动播放策略）
audioManager.resumeOnGesture()

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-wrap',
  width: GAME.width,
  height: GAME.height,
  backgroundColor: '#fdf3ff',
  // 全屏作用在 #game-wrap 上，而不是默认的 document.body。
  // 用 body 全屏时，body 上没有对应的尺寸规则，#game-wrap 高度会塌成 0，
  // Phaser 就按"容器高 0"算 FIT 缩放，画面会被推到屏幕外/裁掉一截。
  fullscreenTarget: 'game-wrap',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  input: {
    keyboard: true,
    mouse: true,
    touch: true
  },
  scene: [
    BootScene,
    TitleScene,
    IntroScene,
    GardenScene,
    BoxScene,
    DessertScene,
    EveningScene,
    SurpriseScene,
    BirthdayScene
  ]
})

// 手机进入全屏时浏览器会触发 blur，而 Phaser 默认在失焦时 suspend 它自己的
// AudioContext —— 人物配音（走 Phaser 音源）就会没声音；背景垫音走的是我们
// 自己建的 AudioContext，不受影响，于是表现为"有背景音、没人声"。
// 关掉这个自动暂停，并在全屏切换时主动恢复上下文。
game.sound.pauseOnBlur = false

/** 全屏切换后确保音频上下文是 running（部分手机浏览器会顺手把上下文挂起） */
function resumeAudioSoon() {
  window.setTimeout(() => {
    const sm = game.sound as unknown as { context?: AudioContext }
    const ctx = sm.context
    if (ctx && (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted')) {
      ctx.resume().catch(() => {})
    }
    audioManager.resumeIfSuspended()
  }, 120)
}

// 配音索引：列出 assets/audio/voice 下真实存在的 mp3。
// 只是个 json，通常在玩家点进游戏前就回来了；万一没赶上，
// 那几句会短暂没有声音（下次进入该场景即正常），不会卡住或报错。
audioManager.loadVoiceIndex()

// 离开页面时停掉合成音频，避免残留计时器
window.addEventListener('beforeunload', () => audioManager.stopAll())

// ---------- 全屏 ----------
// 浏览器规定"进入全屏"必须由用户操作触发，所以做成右上角按钮；F11 交给浏览器原生全屏。
// 用 Phaser 的 scale.startFullscreen/stopFullscreen：它会处理 vendor 前缀与缩放重算，
// 比自己调 requestFullscreen 稳（FIT 模式下画面会自己铺满整屏）。
const fsBtn = document.getElementById('fs-btn')

// 把游戏逻辑尺寸写进 CSS 变量：全屏时 canvas 的 max-width/max-height 用它，
// 保证"按 16:9 等比放大"而不是按视口比例拉伸变形
document.documentElement.style.setProperty('--game-w', `${GAME.width}px`)
document.documentElement.style.setProperty('--game-h', `${GAME.height}px`)

let fsRefreshTimer: number | null = null

/**
 * 全屏状态变化后让 Phaser 重算缩放。
 * 光改 CSS 不够：Phaser 的 FIT 缩放是在 resize 事件里算的，
 * 而全屏切换时容器尺寸变化不一定触发它，于是画布会停在旧尺寸。
 * 延迟一拍是等浏览器把全屏布局应用完（同步调用会读到旧的容器尺寸）。
 */
function refreshScaleSoon() {
  if (fsRefreshTimer !== null) window.clearTimeout(fsRefreshTimer)
  fsRefreshTimer = window.setTimeout(() => {
    fsRefreshTimer = null
    try {
      game.scale.refresh()
    } catch {
      /* 忽略：某些环境 refresh 会抛，不影响使用 */
    }
  }, 80)
}

function syncFsIcon() {
  if (!fsBtn) return
  const on = game.scale.isFullscreen
  fsBtn.textContent = on ? '⤡' : '⛶'
  fsBtn.title = on ? '退出全屏（F11）' : '全屏（F11）'
  fsBtn.setAttribute('aria-label', on ? '退出全屏' : '切换全屏')
  fsBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
  refreshScaleSoon()
  resumeAudioSoon()
}

if (fsBtn) {
  fsBtn.addEventListener('click', () => {
    try {
      if (game.scale.isFullscreen) game.scale.stopFullscreen()
      // 显式把全屏元素定为 #game-wrap。
      // 不传的话 Phaser 默认拿 document.body 去全屏，而 body 上没有对应的尺寸规则，
      // #game-wrap 高度会塌成 0，Phaser 按"容器高 0"算 FIT，画面就跑到屏幕外/被裁掉。
      else game.scale.startFullscreen()
    } catch {
      /* 某些环境（内嵌 iframe 未授权等）不允许全屏，忽略即可，不影响游戏 */
    }
  })
  // Phaser 在状态变化时会抛这两个事件
  game.scale.on('enterfullscreen', syncFsIcon)
  game.scale.on('leavefullscreen', syncFsIcon)
  // 浏览器原生全屏（F11 / Esc）时 Phaser 不一定发事件，这里补一个监听
  document.addEventListener('fullscreenchange', syncFsIcon)
  // 视口本身变化（旋转屏幕、拖动窗口）也要重算
  window.addEventListener('resize', refreshScaleSoon)
  window.addEventListener('orientationchange', refreshScaleSoon)
  syncFsIcon()
}

// 全局静音快捷键：M
window.addEventListener('keydown', (e) => {
  if (e.key !== 'm' && e.key !== 'M') return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const prefs = loadPrefs()
  prefs.muted = !prefs.muted
  savePrefs(prefs)
  window.dispatchEvent(new CustomEvent('starberry:prefs', { detail: prefs }))
})

// 调试钩子：便于在控制台/工具中访问游戏实例
;(window as any).__game = game
;(window as any).__state = state

// 调试跳关：控制台里 __jump('evening') 可以直接跳到某一幕
;(window as any).__jump = (key: string) => {
  // Phaser 的 scene.start 会自己停掉当前场景，不用手动 stop
  game.scene.start(key)
}

// 调试结尾视频：控制台里 __finale() 直接播一遍收尾视频。
// 方便不用通关就能确认视频文件是否放对、能不能播。
;(window as any).__finale = async () => {
  const scene: any = game.scene.getScene('BirthdayScene')
  if (!scene || typeof scene.playFinale !== 'function') return 'no-scene'
  try {
    return (await scene.playFinale()) ? 'played' : 'skipped(missing or already seen)'
  } catch (e) {
    return `error: ${e}`
  }
}

// 调试配音：控制台里 __say('starberry', '我们回小屋吧。')
// 返回 'clip'（播了真人配音）/ 'loading'（有文件但还在解码，稍后再调一次）/
//      'missing'（这个角色或这句还没有配音文件——此时保持静音，不做任何合成替换）
;(window as any).__audio = audioManager
;(window as any).__say = (speaker: string, text: string) => {
  const scene = game.scene.getScenes(true)[0]
  if (!scene) return 'none'
  if (audioManager.sayVoiceLine(scene, speaker, text)) return 'clip'
  return audioManager.hasVoiceClip(speaker, text) ? 'loading' : 'missing'
}
