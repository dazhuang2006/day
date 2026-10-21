// ============================================================
// 合成音乐配方
//
// 之前的兜底音乐只有三个裸正弦音（基音 + 三度 + 五度）在 A 小调上晃，
// 听起来又空又沉。这里换成：
//   1. 全部用明亮的大调 / 温暖柔和的和弦，一条能循环的和弦进行；
//   2. 每个音由几个略微失谐的正弦叠加成"柔和垫音"，再过低通滤波；
//   3. 主音 + 八度 + 五度的轻快琶音，节奏更跳一点。
// 这样即使没有任何 mp3，听起来也是温柔的八音盒，而不是低音嗡嗡声。
// ============================================================

export type Chord = number[]

export type MusicPreset = {
  /** 一条可循环的和弦进行（Hz） */
  progression: Chord[]
  /** 柱式和弦（铺垫）每个和弦持续几个循环小节 */
  padBars: number
  /** 每个循环小节多少毫秒 */
  barMs: number
  /** 主音 / 琶音音色 */
  leadWave: OscillatorType
  /** 琶音每小节几个音（0 = 只要铺垫） */
  arpPerBar: number
  arpGain: number
  padGain: number
  /** 每个音的起音 / 衰减时间（秒） */
  attack: number
  release: number
  /** 低通滤波截止频率（越亮越高） */
  cutoff: number
  /** 失谐叠加系数，让垫音更厚 */
  detune: number[]
}

const A3 = 220.0
const B3 = 246.94
const C4 = 261.63
const D4 = 293.66
const E4 = 329.63
const F4 = 349.23
const G4 = 392.0
const A4 = 440.0
const B4 = 493.88
const C5 = 523.25
const D5 = 587.33
const E5 = 659.25

// 明亮的大调走向：C → G → Am → F（听感温暖、落地感强）
const BRIGHT: Chord[] = [
  [C4, E4, G4],
  [B3, D4, G4],
  [A3, C4, E4],
  [A3, C4, F4]
]

// 更跳的 I–V–vi–IV 高八度版本
const SUNNY: Chord[] = [
  [C4, E4, G4, C5],
  [D4, G4, B4, D5],
  [C4, E4, A4, C5],
  [C4, F4, A4, C5]
]

// 傍晚：上行的大调级进，安静但不黯淡
const DUSK: Chord[] = [
  [E4, A4, C5],
  [F4, A4, C5],
  [G4, B4, D5],
  [A4, C5, E5]
]

const BASE = {
  leadWave: 'sine' as OscillatorType,
  detune: [1, 1.003, 0.997]
}

export const MUSIC: Record<
  'morning' | 'garden' | 'orchard' | 'evening' | 'surprise' | 'birthday',
  MusicPreset
> = {
  // 清晨：清亮、跳一点
  morning: {
    ...BASE,
    progression: SUNNY,
    padBars: 2,
    barMs: 1650,
    arpPerBar: 5,
    arpGain: 0.055,
    padGain: 0.05,
    attack: 0.35,
    release: 2.6,
    cutoff: 3600
  },
  // 花园：梦幻、飘一点，比之前亮很多
  garden: {
    ...BASE,
    progression: BRIGHT,
    padBars: 2,
    barMs: 1900,
    arpPerBar: 4,
    arpGain: 0.05,
    padGain: 0.05,
    attack: 0.5,
    release: 3.2,
    cutoff: 3000
  },
  // 果园：活泼
  orchard: {
    ...BASE,
    progression: SUNNY,
    padBars: 2,
    barMs: 1350,
    arpPerBar: 6,
    arpGain: 0.06,
    padGain: 0.045,
    attack: 0.25,
    release: 2.2,
    cutoff: 4200
  },
  // 傍晚小屋：温柔但不压抑
  // （现在第四章起会直接放 assets/audio/birthday.mp3；这份配方只在
  //   mp3 缺失或音频上下文被浏览器挂起时作为兜底）
  evening: {
    ...BASE,
    progression: DUSK,
    padBars: 2,
    barMs: 2200,
    arpPerBar: 3,
    arpGain: 0.045,
    padGain: 0.055,
    attack: 0.7,
    release: 3.6,
    cutoff: 2600
  },
  // 敲门惊喜：期待感
  surprise: {
    ...BASE,
    progression: SUNNY,
    padBars: 1,
    barMs: 1500,
    arpPerBar: 6,
    arpGain: 0.06,
    padGain: 0.05,
    attack: 0.3,
    release: 2.6,
    cutoff: 4000
  },
  // 生日：最饱满
  birthday: {
    ...BASE,
    progression: BRIGHT,
    padBars: 2,
    barMs: 2000,
    arpPerBar: 4,
    arpGain: 0.055,
    padGain: 0.055,
    attack: 0.5,
    release: 3.4,
    cutoff: 3400
  }
}
