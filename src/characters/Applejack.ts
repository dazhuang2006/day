import { Pony } from './Pony'

// 苹果嘉儿 Applejack —— 苹果园、食材、甜点
export class Applejack extends Pony {
  constructor() {
    super('applejack', { body: 0xffc26b, mane: 0xffb040, mane2: 0xffe066, eye: 0x7fbf3f, mark: 'apple' })
  }
}
