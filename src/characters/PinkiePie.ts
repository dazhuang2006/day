import { Pony } from './Pony'

// 碧琪 Pinkie Pie —— 最终惊喜、气氛担当
export class PinkiePie extends Pony {
  constructor() {
    super('pinkie', { body: 0xff9ad5, mane: 0xff6fb0, mane2: 0xffc9e0, eye: 0x3fb0e0, mark: 'balloon' })
  }
}
