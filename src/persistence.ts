// ============================================================
// 存档：把进度写进 localStorage，关掉浏览器再回来可以继续。
// 全部操作都做了容错——隐私模式 / 存储被禁用 / 存档损坏都不会影响游戏。
// ============================================================

import { SAVE_KEY, SAVE_VERSION, state, type Phase } from './config'

export type SaveData = {
  v: number
  t: number
  phase: Phase
  flowers: string[]
  items: string[]
  giftWrapped: boolean
  toppings: string[]
  dessertMaterials: string[]
  dessertDone: boolean
  decorations: string[]
  surprised: boolean
  letterRead: boolean
  introSeen?: boolean
  boxIntroSeen?: boolean
  wrapSeen?: boolean
  dessertIntroSeen?: boolean
  eveningIntroSeen?: boolean
  finaleVideoSeen?: boolean
  talkedTo?: string[]
  received?: string[]
}

let storageOk = true

export function saveGame() {
  if (!storageOk) return
  try {
    const data: SaveData = {
      v: SAVE_VERSION,
      t: Date.now(),
      phase: state.phase,
      flowers: [...state.flowers],
      items: [...state.items],
      giftWrapped: state.giftWrapped,
      toppings: [...state.toppings],
      dessertMaterials: [...state.dessertMaterials],
      dessertDone: state.dessertDone,
      decorations: [...state.decorations],
      surprised: state.surprised,
      letterRead: state.letterRead,
      introSeen: state.introSeen,
      boxIntroSeen: state.boxIntroSeen,
      wrapSeen: state.wrapSeen,
      dessertIntroSeen: state.dessertIntroSeen,
      eveningIntroSeen: state.eveningIntroSeen,
      finaleVideoSeen: state.finaleVideoSeen,
      talkedTo: [...state.talkedTo],
      received: [...state.received]
    }
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {
    storageOk = false
  }
}

export function readSave(): SaveData | null {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SaveData
    if (!data || data.v !== SAVE_VERSION || !data.phase) return null
    return data
  } catch {
    return null
  }
}

export function hasSave(): boolean {
  return readSave() !== null
}

export function clearSave() {
  try {
    window.localStorage.removeItem(SAVE_KEY)
  } catch {
    /* ignore */
  }
}

/** 把存档还原到全局 state（只做一次，在进入场景前调用） */
export function applySave(data: SaveData) {
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  state.phase = data.phase
  state.flowers = arr(data.flowers)
  state.items = arr(data.items)
  state.giftWrapped = !!data.giftWrapped
  state.toppings = arr(data.toppings)
  state.dessertMaterials = arr(data.dessertMaterials)
  state.dessertDone = !!data.dessertDone
  state.decorations = arr(data.decorations)
  state.surprised = !!data.surprised
  state.letterRead = !!data.letterRead
  state.introSeen = !!data.introSeen
  state.boxIntroSeen = !!data.boxIntroSeen
  state.wrapSeen = !!data.wrapSeen
  state.dessertIntroSeen = !!data.dessertIntroSeen
  state.eveningIntroSeen = !!data.eveningIntroSeen
  state.finaleVideoSeen = !!data.finaleVideoSeen
  state.talkedTo = arr(data.talkedTo)
  state.received = arr(data.received)
}

export function applyLoadedSave(): boolean {
  const data = readSave()
  if (!data) return false
  applySave(data)
  return true
}
