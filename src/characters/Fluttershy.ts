import { Pony } from './Pony'

// 柔柔 Fluttershy —— 花园、小动物、温柔陪伴
export class Fluttershy extends Pony {
  constructor() {
    super('fluttershy', { body: 0xffe9a0, mane: 0xff9ad5, mane2: 0xffc9e0, eye: 0x3fa0e0, mark: 'butterfly' })
  }
}
