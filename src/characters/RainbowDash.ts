import { Pony } from './Pony'

// 云宝 Rainbow Dash —— 速度、跑腿、布置
export class RainbowDash extends Pony {
  constructor() {
    super('rainbow', { body: 0x9ad7ff, mane: 0xff5a78, mane2: 0x53d8d0, eye: 0xff5a9c, mark: 'bolt' })
  }
}
