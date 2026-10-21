import { Pony } from './Pony'

// 珍奇 Rarity —— 礼物包装、房间装饰
export class Rarity extends Pony {
  constructor() {
    super('rarity', { body: 0xffffff, mane: 0xc9a3ff, mane2: 0x9ad7ff, eye: 0x3fb0e0, mark: 'gem' })
  }
}
