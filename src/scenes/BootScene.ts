import Phaser from 'phaser'
import { generateAllTextures } from '../textures'
import { audioManager } from '../audio'
import { state } from '../config'

// 场景可以直接指定"加载完从哪一幕开始"（存档继续 / 跳过序章）
export const bootTarget = { scene: 'TitleScene' }

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload() {
    // 音频缺失也不报错：注册进加载队列，由 audioManager 判断可用性
    audioManager.registerMusic(this)
  }

  private hideBootHint() {
    const el = document.getElementById('boot-hint')
    if (el) el.style.display = 'none'
  }

  private next() {
    audioManager.finalizeMusic(this)
    this.hideBootHint()
    this.scene.start(bootTarget.scene || 'TitleScene')
  }

  create() {
    generateAllTextures(this)
    if (!this.load.isLoading()) {
      this.next()
    } else {
      this.load.once('complete', () => this.next())
    }
    // 供调试：window.__state 可以看到当前进度
    ;(window as any).__state = state
  }
}
