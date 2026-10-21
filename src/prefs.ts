// ============================================================
// 玩家偏好设置（音量 / 静音 / 文字速度）
// 单独用一个 localStorage key，和游戏进度存档分开，
// 这样"新的一天"清档时不会把设置一起清掉。
// ============================================================

export type Prefs = {
  /** 0~1，音乐与音效的总音量 */
  volume: number
  muted: boolean
  textSpeed: 'slow' | 'normal' | 'fast'
}

export const TEXT_SPEED_MS: Record<Prefs['textSpeed'], number> = {
  slow: 42,
  normal: 26,
  fast: 14
}

export const TEXT_SPEED_LABEL: Record<Prefs['textSpeed'], string> = {
  slow: '慢',
  normal: '正常',
  fast: '快'
}

const PREFS_KEY = 'starberry-day.prefs'

const DEFAULTS: Prefs = { volume: 0.7, muted: false, textSpeed: 'normal' }

function clamp01(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULTS }
    const data = JSON.parse(raw) as Partial<Prefs>
    const speed = data.textSpeed
    return {
      volume: clamp01(data.volume, DEFAULTS.volume),
      muted: !!data.muted,
      textSpeed: speed === 'slow' || speed === 'fast' || speed === 'normal' ? speed : DEFAULTS.textSpeed
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式下写不进去也无所谓 */
  }
}
