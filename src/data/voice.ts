// ============================================================
// 合成的"人声"：每位小马用不同的声线说 / 唱一句台词
//
// 项目里没有任何人声素材，所以这里用 WebAudio 现场合成：
//   1. 用锯齿波当声带（glottal source），带轻微颤音；
//   2. 两个带通滤波器当作共振峰（formant），按元的元音（a/e/i/o/u）
//      设置中心频率，这样听起来像"在说话"而不是单纯蜂鸣；
//   3. 每个音节独立控制音高 / 时长 / 音量，就能把四个音节
//      编成一小段旋律（"生日快乐"= ㄕㄥ ㄖˋ ㄎㄨㄞˋ ㄌㄜˋ）。
//
// 每位角色有各自的音域、元音色彩、音色与"唱法"，所以一听就能分辨。
// 如果以后你录到了真实配音，把 mp3 放进 assets/audio/ 并在这里改成
// 播放音频即可（见 prefersAudio() 的注释）。
// ============================================================

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'sil'

/** 中文元音（近似）的共振峰中心频率，单位 Hz */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [800, 1150, 2900],
  e: [500, 1800, 2600],
  i: [300, 2300, 3000],
  o: [500, 900, 2500],
  u: [330, 700, 2400],
  sil: [500, 1200, 2500]
}

export type VoiceProfile = {
  /** 相对音高（半音），负值更低沉 */
  pitch: number
  /** 每位角色的基频（女声区，越低越成熟） */
  base: number
  wave: OscillatorType
  /** 发音速度倍率：>1 更急促 */
  rate: number
  vibrato: number
  /** 音量包络的起音（秒），越小越"硬" */
  attack: number
  /** 气息感（噪声成分）0~1 */
  breath: number
}

/** 七位角色 + 旁白（默认）的声线 */
export const VOICES: Record<string, VoiceProfile> = {
  starberry: { pitch: 0, base: 262, wave: 'sawtooth', rate: 1.0, vibrato: 4.5, attack: 0.03, breath: 0.06 },
  twilight: { pitch: -1, base: 236, wave: 'sawtooth', rate: 1.06, vibrato: 4.0, attack: 0.02, breath: 0.03 },
  fluttershy: { pitch: 3, base: 294, wave: 'sine', rate: 0.86, vibrato: 5.5, attack: 0.08, breath: 0.22 },
  applejack: { pitch: -5, base: 196, wave: 'triangle', rate: 1.02, vibrato: 3.2, attack: 0.02, breath: 0.05 },
  rainbow: { pitch: 1, base: 277, wave: 'square', rate: 1.22, vibrato: 6.0, attack: 0.02, breath: 0.04 },
  rarity: { pitch: 0, base: 262, wave: 'triangle', rate: 0.92, vibrato: 5.2, attack: 0.05, breath: 0.1 },
  pinkie: { pitch: 5, base: 330, wave: 'square', rate: 1.18, vibrato: 8.0, attack: 0.015, breath: 0.05 }
}

export const DEFAULT_VOICE = VOICES.starberry

const semitone = (n: number) => Math.pow(2, n / 12)

export type Syllable = {
  /** 唱名（0=do … 7=高音 do），决定音高 */
  degree: number
  /** 元音，决定口型 */
  vowel: Vowel
  /** 时长（秒） */
  dur: number
  /** 这一音节的相对音量 */
  gain?: number
}

/** "生日快乐"的音节（ㄕㄥ ㄖˋ ㄎㄨㄞˋ ㄌㄜˋ），顺手编成一小段上行旋律 */
export const HAPPY_BIRTHDAY: Syllable[] = [
  { degree: 0, vowel: 'e', dur: 0.34 },
  { degree: 2, vowel: 'i', dur: 0.3 },
  { degree: 4, vowel: 'u', dur: 0.34, gain: 1.05 },
  { degree: 7, vowel: 'e', dur: 0.62, gain: 1.1 }
]

/** 把音级换算成频率 */
const degreeFreq = (profile: VoiceProfile, degree: number) =>
  profile.base * semitone(profile.pitch + degree)

export type PhraseOptions = {
  /** 整体音量 */
  volume?: number
  /** 整体音高偏移（半音） */
  transpose?: number
  /** 每个音节之间额外的间隔（秒），用来做"抢着说"的效果 */
  spread?: number
}

/** 一个音节：声带 + 两个共振峰 + 音量包络 */
function singSyllable(
  ctx: AudioContext,
  dest: AudioNode,
  profile: VoiceProfile,
  syl: Syllable,
  startAt: number,
  opts: PhraseOptions
) {
  const dur = syl.dur / profile.rate
  const t = startAt
  const level = (opts.volume ?? 0.1) * (syl.gain ?? 1)

  const osc = ctx.createOscillator()
  osc.type = profile.wave
  const f0 = degreeFreq(profile, syl.degree + (opts.transpose ?? 0))
  osc.frequency.setValueAtTime(f0 * 0.985, t)
  osc.frequency.linearRampToValueAtTime(f0, t + dur * 0.35)

  // 颤音：让长音有"唱"的感觉
  if (profile.vibrato > 0) {
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = profile.vibrato
    lfoGain.gain.value = f0 * 0.012
    lfo.connect(lfoGain)
    lfoGain.connect(osc.frequency)
    lfo.start(t)
    lfo.stop(t + dur + 0.1)
  }

  const env = ctx.createGain()
  env.gain.setValueAtTime(0.0001, t)
  env.gain.linearRampToValueAtTime(level, t + profile.attack)
  env.gain.setValueAtTime(level, t + Math.max(profile.attack, dur * 0.55))
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur)

  const [f1, f2, f3] = FORMANTS[syl.vowel]
  const filters: BiquadFilterNode[] = [
    [f1, 0.9],
    [f2, 1.4],
    [f3, 1.1]
  ].map(([f, q]) => {
    const bf = ctx.createBiquadFilter()
    bf.type = 'bandpass'
    bf.frequency.value = f
    bf.Q.value = q
    return bf
  })

  osc.connect(env)
  filters.forEach((f) => f.connect(dest))
  // 三个共振峰并联，权重递减
  filters[0].gain.value = 1
  filters[1].gain.value = 0.55
  filters[2].gain.value = 0.22
  env.connect(filters[0])
  env.connect(filters[1])
  env.connect(filters[2])

  // 气息：一点点噪声，让柔柔/珍奇听起来更"轻"
  if (profile.breath > 0.01) {
    const noiseLen = Math.max(1, Math.floor(ctx.sampleRate * (dur + 0.05)))
    const buf = ctx.createBuffer(1, noiseLen, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < noiseLen; i++) data[i] = (Math.random() * 2 - 1) * profile.breath
    const noise = ctx.createBufferSource()
    noise.buffer = buf
    const nf = ctx.createBiquadFilter()
    nf.type = 'bandpass'
    nf.frequency.value = 2400
    nf.Q.value = 0.8
    const ng = ctx.createGain()
    ng.gain.setValueAtTime(0.0001, t)
    ng.gain.linearRampToValueAtTime(level * 0.5, t + profile.attack)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    noise.connect(nf)
    nf.connect(ng)
    ng.connect(dest)
    noise.start(t)
    noise.stop(t + dur + 0.05)
  }

  osc.start(t)
  osc.stop(t + dur + 0.05)
}

/** 一个声音在 startAt 时刻唱完一串音节，返回这一段的总时长 */
export function singPhrase(
  ctx: AudioContext,
  dest: AudioNode,
  voiceKey: string,
  syllables: Syllable[],
  startAt: number,
  opts: PhraseOptions = {}
) {
  const profile = VOICES[voiceKey] ?? DEFAULT_VOICE
  let t = startAt
  for (const syl of syllables) {
    singSyllable(ctx, dest, profile, syl, t, opts)
    t += syl.dur / profile.rate + (opts.spread ?? 0)
  }
  return t - startAt
}

/**
 * 合唱：让所有角色错开一点点、用各自声线同时唱同一句，
 * 最后一个音一起收，形成"大家一起喊"的效果。
 */
export function singChorus(
  ctx: AudioContext,
  dest: AudioNode,
  voiceKeys: string[],
  syllables: Syllable[],
  startAt: number,
  opts: PhraseOptions = {}
) {
  const per = (opts.volume ?? 0.1) / Math.max(1, Math.sqrt(voiceKeys.length))
  let total = 0
  voiceKeys.forEach((key, i) => {
    const offset = i * 0.07 + (Math.random() * 0.05 - 0.025)
    const transpose = (opts.transpose ?? 0) + (i % 2 === 0 ? 0 : -0.4)
    const dur = singPhrase(ctx, dest, key, syllables, startAt + Math.max(0, offset), {
      ...opts,
      volume: per,
      transpose
    })
    total = Math.max(total, dur + Math.max(0, offset))
  })
  return total
}
