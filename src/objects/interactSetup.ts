import Phaser from 'phaser'
import type { Player, InteractTarget } from '../player'
import { InteractionHighlights, type HighlightSource } from './InteractionPoint'

// ============================================================
// 交互点提示光圈的便捷接线
//
// 场景只提供一份 targets（坐标的唯一来源），其余交给这里：
//   1. 光圈显示在哪些位置、什么颜色、多大；
//   2. 玩家走到跟前时点亮（跟随 Player 的 onNearChange）；
//   3. 底部一行"现在能做什么"的提示，减少"我走到这里怎么没反应"的困惑。
// ============================================================

export type InteractHighlightConfig = {
  /** 与 player.setInteractTargets 用同一份列表（下标必须一致） */
  targets: InteractTarget[]
  /** 光圈外观：与 targets 同序；不填的项会被跳过（不画光圈） */
  visuals: (HighlightSource | null)[]
  /** 底部的操作提示 */
  hud?: {
    /** 没有走到任何交互点旁边时的提示 */
    idle: string
    /** 走到交互点旁边时的提示 */
    near: string
  }
}

export function setupInteractionHighlights(
  scene: Phaser.Scene,
  player: Player,
  config: InteractHighlightConfig
): InteractionHighlights {
  player.setInteractTargets(config.targets)

  // 底部的"现在能做什么"提示（先建好，onNearChange 里要用）
  let hud: Phaser.GameObjects.Text | null = null
  if (config.hud) {
    hud = scene.add
      .text(scene.scale.width / 2, scene.scale.height - 56, config.hud.idle, {
        fontFamily: 'Microsoft YaHei, PingFang SC, sans-serif',
        fontSize: '15px',
        color: '#5a4470',
        backgroundColor: 'rgba(255,255,255,0.82)',
        padding: { x: 12, y: 6 }
      })
      .setOrigin(0.5)
      .setDepth(860)
      .setAlpha(0.55)
  }
  const sources: HighlightSource[] = []
  const indexMap: number[] = []
  config.visuals.forEach((v, i) => {
    if (!v) return
    sources.push(v)
    indexMap.push(i)
  })

  const highlights = new InteractionHighlights(scene)
  highlights.set(sources)
  // ticker 负责跟随会漂浮/移动的物件位置
  scene.events.on(Phaser.Scenes.Events.UPDATE, () => highlights.update())
  player.onNearChange = (idx) => {
    const mapped = indexMap.indexOf(idx)
    highlights.setNear(mapped, true)
    if (hud && config.hud) {
      hud.setText(mapped >= 0 ? config.hud.near : config.hud.idle).setAlpha(mapped >= 0 ? 1 : 0.55)
    }
  }

  return highlights
}
