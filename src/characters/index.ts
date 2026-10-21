import Phaser from 'phaser'
import { Starberry } from './Starberry'
import { Twilight } from './Twilight'
import { Fluttershy } from './Fluttershy'
import { Applejack } from './Applejack'
import { RainbowDash } from './RainbowDash'
import { Rarity } from './Rarity'
import { PinkiePie } from './PinkiePie'
import { Pony } from './Pony'

export { Pony }
export { Starberry, Twilight, Fluttershy, Applejack, RainbowDash, Rarity, PinkiePie }

// 注册表：方便场景按 key 生成任意角色
export const PONIES: Record<string, Pony> = {
  starberry: new Starberry(),
  twilight: new Twilight(),
  fluttershy: new Fluttershy(),
  applejack: new Applejack(),
  rainbow: new RainbowDash(),
  rarity: new Rarity(),
  pinkie: new PinkiePie()
}

export function spawnPony(scene: Phaser.Scene, key: string, x: number, y: number, scale = 1.1) {
  const pony = PONIES[key]
  return pony ? pony.spawn(scene, x, y, scale) : null
}
