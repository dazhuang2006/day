import { Pony } from './Pony'
import { STARBERRY } from '../config'

// 原创主角：星莓 Starberry
export class Starberry extends Pony {
  constructor() {
    super('starberry', {
      body: STARBERRY.body,
      mane: STARBERRY.mane,
      mane2: STARBERRY.mane2,
      eye: STARBERRY.eye,
      mark: 'starHorseshoe',
      ribbon: STARBERRY.ribbon
    })
  }
}
