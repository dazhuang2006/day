import Phaser from 'phaser'
import type { PonyPalette, Direction } from '../textures'
import { CHARACTER_NAMES } from '../scenes/dialogue'

// 角色基类：负责在场景中生成可动的 Q 版小马精灵
export class Pony {
  key: string
  name: string
  palette: PonyPalette

  constructor(key: string, palette: PonyPalette, name?: string) {
    this.key = key
    this.palette = palette
    this.name = name ?? CHARACTER_NAMES[key] ?? key
  }

  /** 生成一个精灵；可指定朝向与缩放 */
  spawn(scene: Phaser.Scene, x: number, y: number, scale = 1.1, facing: Direction = 'down') {
    const spr = scene.add.sprite(x, y, `${this.key}_stand_${facing}`).setScale(scale)
    spr.setData('ponyKey', this.key)
    spr.setData('facing', facing)
    spr.setDepth(y)
    return spr
  }

  /** 让精灵播放行走动画（按朝向） */
  walk(spr: Phaser.GameObjects.Sprite, facing: Direction = 'down') {
    const anim = `${this.key}_walk_${facing}`
    spr.setData('facing', facing)
    if (spr.scene.anims.exists(anim)) spr.anims.play(anim, true)
  }

  stop(spr: Phaser.GameObjects.Sprite, facing?: Direction) {
    const dir = (facing ?? (spr.getData('facing') as Direction) ?? 'down') as Direction
    spr.anims.stop()
    spr.setTexture(`${this.key}_stand_${dir}`)
  }

  /** 轻快的走路浮动动画（原地点头） */
  bob(scene: Phaser.Scene, spr: Phaser.GameObjects.Sprite) {
    scene.tweens.add({
      targets: spr,
      y: spr.y - 6,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    })
  }
}
