// 提取台词时的桩：src/prefs.ts 会读 localStorage，Node 里没有。
// 只提供对话模块用到的两个导出。
export const TEXT_SPEED_MS = { slow: 60, normal: 34, fast: 16 }

export const loadPrefs = () => ({ textSpeed: 'normal' })

export const savePrefs = () => {}
