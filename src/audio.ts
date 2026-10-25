import Phaser from 'phaser'
import { MUSIC, type MusicPreset } from './data/music'
import { HAPPY_BIRTHDAY, singChorus, singPhrase, type Syllable } from './data/voice'
import { loadPrefs, type Prefs } from './prefs'
import VOICE_LINES from './data/voiceLines.json'

// ============================================================
// 音频管理：优先加载 assets/audio 下的 mp3；
// 若文件缺失，自动用 WebAudio 合成轻柔的八音盒音乐兜底，绝不报错。
//
// 合成部分由 data/music.ts 的配方驱动（明亮的大调和弦 + 柔和垫音 + 琶音），
// 不再是三个裸正弦在 A 小调上晃的低沉嗡嗡声。
// ============================================================

export const MUSIC_KEYS = {
  morning: 'music_morning',
  garden: 'music_garden',
  orchard: 'music_orchard',
  evening: 'music_evening',
  surprise: 'music_surprise',
  birthday: 'music_birthday'
}

type MusicName = keyof typeof MUSIC_KEYS

/** 当前正在响的一层垫音，用于切场景时淡出 */
type PadVoice = { osc: OscillatorNode; gain: GainNode; stopAt: number }

class AudioManager {
  private loaded = new Set<string>()
  private ctx: AudioContext | null = null
  private ambientTimer: number | null = null
  private currentPad: MusicName | null = null
  /** 上下文尚未解锁时想播的音乐，等用户第一次操作后补播 */
  private pendingPad: MusicName | null = null
  private playingMusic: Phaser.Sound.BaseSound | null = null
  /** 当前正在播放的曲目名（播 mp3 时为 mp3 名，走合成兜底时等于 currentPad） */
  private currentMusicName: MusicName | null = null
  /** 是否有真实配音（GPT-SoVITS 生成）可用：speaker -> 台词 id 集合 */
  private voiceIndex: Record<string, Set<string>> = {}
  private voiceIndexLoaded = false
  private voiceSound: Phaser.Sound.BaseSound | null = null
  /** speaker -> { 原文: 台词 id }，由 tools/extract-lines.mjs 生成 */
  private voiceLines: Record<string, Record<string, string>> = VOICE_LINES as any
  /** 当前音乐的琶音主音，用来让旋律落在和弦音上 */
  private nextLead = 523.25
  private liveVoices: PadVoice[] = []
  /** 音乐"厚度"：0=只有垫音，1=加琶音，2=再加低音与旋律层 */
  private intensity = 1

  // ---- 音量总线：一切合成声音都经过 master，方便统一调音量 / 静音 ----
  private masterGain: GainNode | null = null
  private musicBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  /** 合成人声单独一条总线，方便把"说话"压得比音效更低 */
  private voiceBus: GainNode | null = null
  private prefs: Prefs = loadPrefs()

  constructor() {
    if (typeof window !== 'undefined') {
      // 设置面板改了偏好就立刻生效
      window.addEventListener('starberry:prefs', (e) => {
        const detail = (e as CustomEvent<Prefs>).detail
        this.setPrefs(detail ?? loadPrefs())
      })
    }
  }

  private ensureBuses(ctx: AudioContext) {
    if (this.masterGain && this.musicBus && this.sfxBus && this.voiceBus) return
    const master = ctx.createGain()
    const music = ctx.createGain()
    const sfx = ctx.createGain()
    const voice = ctx.createGain()
    // 从 0 开始，交给 applyVolume 渐变上去，避免第一次出声时爆音
    master.gain.value = 0
    music.gain.value = 0
    sfx.gain.value = 0
    voice.gain.value = 0
    music.connect(master)
    sfx.connect(master)
    voice.connect(master)
    master.connect(ctx.destination)
    this.masterGain = master
    this.musicBus = music
    this.sfxBus = sfx
    this.voiceBus = voice
    this.applyVolume()
  }

  /** 应用当前偏好（音量 / 静音） */
  setPrefs(p: Prefs) {
    this.prefs = p
    this.applyVolume()
  }

  /**
   * 视频播放期间的静音开关。
   *
   * 为什么单靠 stopAll() 不够：Phaser 播的音乐走它自己的 SoundManager，
   * 实测 stop() 对已经进入循环的音源不一定生效（调用后 getAllPlaying 里还在），
   * 而且总音量总线也不会因此归零——所以必须在三个层面同时压住：
   *   1. stopAll()      —— 停掉我们能拿到的音源对象
   *   2. soundManager.mute —— 兜底，把所有 Phaser 音源（含循环 bgm）硬静音
   *   3. applyVolume()  —— 把我们自己的 GainNode 总线（每个 else 分支都算）归零
   */
  private videoSilent = false
  /** 第一次播放音乐时记住 SoundManager，视频期间用它做兜底静音 */
  private soundManager: Phaser.Sound.BaseSoundManager | null = null
  /** 最近一次播放音乐的场景：视频结束后重播要用 */
  private lastScene: Phaser.Scene | null = null
  /** 视频期间被暂停的曲目，结束后恢复 */
  private resumeMusicAfterVideo: MusicName | null = null

  setVideoSilence(on: boolean) {
    this.videoSilent = on
    if (on) {
      // 记住当前曲目，视频结束后要接着放
      this.resumeMusicAfterVideo = this.currentMusicName
      // 语音不用恢复，直接停掉（否则 resumeAll 会把半句话接回来）
      this.stopVoice()
      if (this.soundManager) {
        try {
          this.soundManager.mute = true
        } catch {
          /* ignore */
        }
        // 用 pause 而不是 stop：保住播放位置，视频结束后接着放
        try {
          this.soundManager.pauseAll()
        } catch {
          /* ignore */
        }
      }
      // 合成垫音不归 Phaser 管，单独停
      this.stopAmbient(0.2)
      this.applyVolume()
      return
    }

    if (this.soundManager) {
      try {
        this.soundManager.mute = false
      } catch {
        /* ignore */
      }
      try {
        this.soundManager.resumeAll()
      } catch {
        /* ignore */
      }
    }
    this.applyVolume()

    // 兜底：如果那个音源其实是被 stop 掉的（pause 没生效），就重新播一遍
    const name = this.resumeMusicAfterVideo
    this.resumeMusicAfterVideo = null
    if (!name) return
    if (this.currentPad === name) {
      this.playAmbient(name)
    } else if (!this.isPlayingMusic(name) && this.lastScene) {
      this.playMusic(this.lastScene, name)
    }
  }

  get isVideoSilent() {
    return this.videoSilent
  }

  private applyVolume() {
    const ctx = this.ctx
    if (!ctx || !this.masterGain || !this.musicBus || !this.sfxBus || !this.voiceBus) return
    // 视频播放时把总线也压到 0，防止之后新触发的音效漏出来
    const v = this.videoSilent ? 0 : this.prefs.muted ? 0 : this.prefs.volume
    const now = ctx.currentTime
    // 用极短的时间常数避免"咔"的爆音。
    // master 保持 1，音量只作用在三条总线上，否则音量会被乘两次。
    this.masterGain.gain.setTargetAtTime(1, now, 0.05)
    this.musicBus.gain.setTargetAtTime(Math.max(0.0001, v), now, 0.05)
    // 音效相对压低一点，避免盖过剧情
    this.sfxBus.gain.setTargetAtTime(Math.max(0.0001, v * 0.9), now, 0.05)
    // 人声再低一点，合成声线本来就比较"抢耳"
    this.voiceBus.gain.setTargetAtTime(Math.max(0.0001, v * 0.75), now, 0.05)
  }

  /** 音乐厚度：收集 / 布置推进时调用，让音乐跟着玩法长起来 */
  setIntensity(level: number) {
    this.intensity = Math.max(0, Math.min(2, level))
  }

  /** 尝试注册音频到加载队列；缺失文件会被安全跳过 */
  registerMusic(scene: Phaser.Scene) {
    const list = [
      { k: MUSIC_KEYS.morning, f: 'morning.mp3' },
      { k: MUSIC_KEYS.garden, f: 'garden.mp3' },
      { k: MUSIC_KEYS.orchard, f: 'orchard.mp3' },
      { k: MUSIC_KEYS.evening, f: 'evening.mp3' },
      { k: MUSIC_KEYS.surprise, f: 'surprise.mp3' },
      { k: MUSIC_KEYS.birthday, f: 'birthday.mp3' }
    ]
    list.forEach(({ k, f }) => scene.load.audio(k, `assets/audio/${f}`))
  }

  /** 加载完成后记录实际可用的音乐 */
  finalizeMusic(scene: Phaser.Scene) {
    Object.values(MUSIC_KEYS).forEach((k) => {
      if (scene.sound.get(k) || scene.cache.audio.exists(k)) {
        this.loaded.add(k)
      }
    })
  }

  private ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (AC) {
        this.ctx = new AC()
      }
    }
    return this.ctx
  }

  /**
   * 外部可调用：确保我们自己的 AudioContext 处于 running。
   * 全屏切换、切回前台时用得上（部分手机会把上下文挂起）。
   */
  resumeIfSuspended() {
    const c = this.ctx
    if (!c) return
    const state = c.state as string
    if (state === 'suspended' || state === 'interrupted') c.resume().catch(() => {})
  }

  /** 浏览器自动播放策略：首次用户操作时恢复音频上下文 */
  resumeOnGesture() {    const unlock = () => {
      const c = this.ensureCtx()
      if (!c) return
      if (c.state === 'suspended') c.resume().catch(() => {})
      // 上下文刚解锁：把音量偏好真正写进去
      this.ensureBuses(c)
      this.applyVolume()
      // 章节音乐若之前因为上下文被挂起而没播出来，这里补播一次
      if (this.pendingPad) {
        const name = this.pendingPad
        this.pendingPad = null
        if (this.currentPad === name && this.ambientTimer === null) this.playAmbient(name)
      }
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      window.removeEventListener('touchstart', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    window.addEventListener('touchstart', unlock)
  }

  private running() {
    const c = this.ensureCtx()
    return c && c.state === 'running' ? c : null
  }

  // ---------- 合成音乐 ----------

  /** 一个"柔和垫音"音：几个略微失谐的正弦叠加，再过一个低通滤波 */
  private padNote(ctx: AudioContext, freq: number, gain: number, p: MusicPreset, delay = 0) {
    this.ensureBuses(ctx)
    const t = ctx.currentTime + delay
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = p.cutoff
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(gain, t + p.attack)
    env.gain.setTargetAtTime(0.0001, t + p.attack, p.release / 3)
    filter.connect(env)
    env.connect(this.musicBus ?? ctx.destination)

    const stopAt = t + p.attack + p.release + 1
    for (const k of p.detune) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq * k
      osc.connect(filter)
      osc.start(t)
      osc.stop(stopAt)
      this.liveVoices.push({ osc, gain: env, stopAt })
    }
    if (this.liveVoices.length > 80) {
      this.liveVoices = this.liveVoices.filter((v) => v.stopAt > ctx.currentTime)
    }
  }

  /** 明亮的琶音音色：三角波，短促、带一点衰减 */
  private pluckNote(ctx: AudioContext, freq: number, gain: number, p: MusicPreset, delay = 0) {
    this.ensureBuses(ctx)
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const env = ctx.createGain()
    osc.type = p.leadWave
    osc.frequency.value = freq
    osc.connect(env)
    env.connect(this.musicBus ?? ctx.destination)
    env.gain.setValueAtTime(0.0001, t)
    env.gain.linearRampToValueAtTime(gain, t + 0.02)
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.9)
    osc.start(t)
    osc.stop(t + 1)
  }

  /** 一个小节：柱式和弦（每 padBars 小节换一次）+ 轻快琶音 + 强度层 */
  private playBar(name: MusicName, bar: number) {
    const ctx = this.running()
    if (!ctx) return
    const p = MUSIC[name]
    const chord = p.progression[Math.floor(bar / p.padBars) % p.progression.length]
    const onChordChange = bar % p.padBars === 0
    if (onChordChange) {
      chord.forEach((f, i) => this.padNote(ctx, f, p.padGain / (1 + i * 0.35), p, i * 0.09))
      // 琶音落在和弦音上：根音高八度 → 五度 → 再高八度
      this.nextLead = chord[0] * 2
      // 厚度 ≥2 时补一层低音，把音乐"托"起来
      if (this.intensity >= 2) this.padNote(ctx, chord[0] / 2, p.padGain * 0.7, p, 0)
    }
    if (p.arpPerBar > 0 && this.intensity >= 1) {
      const span = p.barMs / 1000
      const lead = this.nextLead
      const tones = [lead, lead * 1.5, lead * 2]
      const count = this.intensity >= 2 ? p.arpPerBar : Math.max(2, Math.ceil(p.arpPerBar / 2))
      for (let i = 0; i < count; i++) {
        this.pluckNote(ctx, tones[i % tones.length], p.arpGain, p, (span * i) / Math.max(1, count))
      }
    }
  }

  /** 播放（或切换）合成音乐 */
  playAmbient(name: MusicName) {
    this.stopAmbient()
    this.currentPad = name
    const ctx = this.running()
    if (!ctx) {
      // 上下文还锁着（浏览器自动播放策略）：记下来，等首次操作后补播
      this.pendingPad = name
      return
    }
    this.pendingPad = null
    this.nextLead = 523.25
    let bar = 0
    this.playBar(name, 0)
    this.ambientTimer = window.setInterval(() => {
      if (!this.running()) return
      bar++
      this.playBar(name, bar)
    }, MUSIC[name].barMs)
  }

  private stopAmbient(fade = 0.45) {
    if (this.ambientTimer !== null) {
      window.clearInterval(this.ambientTimer)
      this.ambientTimer = null
    }
    this.currentPad = null
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    for (const v of this.liveVoices) {
      try {
        const g = v.gain.gain
        g.cancelScheduledValues(now)
        g.setTargetAtTime(0.0001, now, fade / 3)
        v.osc.stop(now + fade + 0.1)
      } catch {
        /* 已经停了就算了 */
      }
    }
    this.liveVoices = []
  }

  /** 播放章节音乐：优先 mp3，否则用合成音乐兜底 */
  playMusic(scene: Phaser.Scene, name: MusicName) {
    // 记住 SoundManager：视频播放时要靠它把所有 Phaser 音源硬静音
    this.soundManager = scene.sound
    this.lastScene = scene
    const ctx = this.ensureCtx()
    if (ctx) {
      this.ensureBuses(ctx)
      this.applyVolume()
    }
    // 每章从"标准厚度"重新开始，由场景按进度加深
    this.intensity = 1
    if (this.playingMusic) {
      try {
        this.playingMusic.stop()
      } catch {
        /* ignore */
      }
      this.playingMusic = null
    }
    const key = MUSIC_KEYS[name]
    if (this.loaded.has(key)) {
      try {
        // 上下文被挂起时 play() 会返回 null / false，这时必须走兜底，
        // 否则会出现"playingMusic 有值但其实一点声音都没有"的静音 bug。
        const snd = scene.sound.play(key, { loop: true, volume: 0.5 })
        if (snd) {
          this.pendingPad = null
          this.stopAmbient()
          this.playingMusic = snd as unknown as Phaser.Sound.BaseSound
          this.currentMusicName = name
          return
        }
      } catch {
        /* fall through to pad */
      }
    }
    this.playingMusic = null
    this.currentMusicName = null
    this.playAmbient(name)
  }

  /**
   * 这首歌是不是已经在放了。
   * 用于跨章节连续播放：终章如果发现同一首还在响，就不要再从头重播一次。
   */
  isPlayingMusic(name: MusicName) {
    if (this.playingMusic) return this.currentMusicName === name
    // 没有 mp3、走合成兜底时，用当前垫音名判断
    if (this.currentPad === name) return true
    return this.pendingPad === name && this.ambientTimer === null
  }

  stopAll() {
    if (this.voiceSound) {
      try {
        this.voiceSound.stop()
      } catch {
        /* ignore */
      }
      this.voiceSound = null
    }
    if (this.playingMusic) {
      try {
        this.playingMusic.stop()
      } catch {
        /* ignore */
      }
      this.playingMusic = null
    }
    this.currentMusicName = null
    this.stopAmbient(0.3)
    this.pendingPad = null
  }

  // ---------- 真正的配音（GPT-SoVITS 生成） ----------

  /**
   * 读配音索引。索引只列出**真实存在**的 mp3，所以没生成过的角色会自动走合成声线。
   * 拿不到（比如没跑过生成脚本、或直接开 index.html）就静默工作，绝不报错。
   */
  async loadVoiceIndex() {
    if (this.voiceIndexLoaded) return
    this.voiceIndexLoaded = true
    try {
      const res = await fetch('assets/audio/voice/index.json', { cache: 'no-cache' })
      if (!res.ok) return
      const data = (await res.json()) as Record<string, unknown>
      for (const [speaker, ids] of Object.entries(data)) {
        if (Array.isArray(ids)) this.voiceIndex[speaker] = new Set(ids.map(String))
      }
      const total = Object.values(this.voiceIndex).reduce((n, s) => n + s.size, 0)
      // 排查用：控制台会显示识别到几条配音。0 条说明还没生成，属于正常状态。
      console.info(
        total > 0
          ? `[配音] 已识别 ${total} 条真实配音（${Object.keys(this.voiceIndex).join('、')}）`
          : '[配音] 没有配音文件，全部使用合成声线'
      )
    } catch {
      /* 没有配音资源是正常状态 */
    }
  }

  /** 某人某句有没有配音文件。text 用未经改写的原文（和提取脚本一致）。 */
  hasVoiceClip(speaker: string, text: string) {
    const lineId = this.voiceLines[speaker]?.[text]
    if (!lineId) return false
    return this.voiceIndex[speaker]?.has(lineId) ?? false
  }

  /**
   * 声音自检：手机上没法看控制台，这里把关键状态一次性吐出来。
   * 只读，不会改变播放状态。
   */
  voiceDiagnostics(scene: Phaser.Scene, speaker: string, text: string) {
    const id = this.voiceIdOf(speaker, text)
    const key = `${speaker}/${id}`
    let cached = false
    try {
      cached = !!id && scene.cache.audio.exists(key)
    } catch {
      /* ignore */
    }
    return {
      ctx: this.ctx ? this.ctx.state : 'none',
      total: Object.values(this.voiceIndex).reduce((n, s) => n + s.size, 0),
      has: this.hasVoiceClip(speaker, text),
      cached,
      loading: this.voiceLoading.has(key),
      playing: !!this.voiceSound,
      muted: this.prefs.muted,
      volume: this.prefs.volume
    }
  }

  /** 正在加载中的配音 key，避免同一句被重复入队 */
  private voiceLoading = new Set<string>()

  /**
   * 正在等解码完成后补播的那一句。
   *
   * 为什么需要：mp3 要 fetch + decode，玩家刚进章节就搭话时音频往往还没好，
   * 以前这里直接返回 false —— 这句就永远静音了（表现为"某个角色没声音"，
   * 而且往往是第一个被搭话的人）。现在改成排队，解码完成立刻补播。
   */
  private pendingVoice: { scene: Phaser.Scene; key: string; volume: number } | null = null

  /** 真正把已缓存的配音播出来 */
  private playVoiceSound(scene: Phaser.Scene, key: string, volume: number) {
    try {
      if (this.voiceSound) this.voiceSound.stop()
      // 音量走 Phaser 自己的通道：音乐已经占了 musicBus，人声独立放更简单
      const snd = scene.sound.add(key, { volume: Math.max(0, Math.min(1, volume * this.prefs.volume)) })
      snd.once('complete', () => snd.destroy())
      snd.play()
      this.voiceSound = snd
      return true
    } catch {
      return false
    }
  }

  /**
   * 把配音 mp3 预加载进 Phaser 的音频缓存。
   * 已缓存直接返回 true；正在加载返回 false（调用方会排队补播）。
   */
  private ensureVoiceLoaded(scene: Phaser.Scene, key: string) {
    if (scene.cache.audio.exists(key)) return true
    if (this.voiceLoading.has(key)) return false
    this.voiceLoading.add(key)
    scene.load.audio(key, `assets/audio/voice/${key}.mp3`)
    scene.load.once(`filecomplete-audio-${key}`, () => {
      this.voiceLoading.delete(key)
      // 如果这句还在等（玩家没有立刻翻页），解码完立刻补播
      const p = this.pendingVoice
      if (p && p.key === key) {
        this.pendingVoice = null
        this.playVoiceSound(p.scene, key, p.volume)
      }
    })
    scene.load.once('loaderror', () => this.voiceLoading.delete(key))
    scene.load.start()
    return false
  }

  /** 取某句台词对应的配音 id（没有配置则返回空） */
  private voiceIdOf(speaker: string, text: string) {
    return this.voiceLines[speaker]?.[text] ?? ''
  }

  /**
   * 播放某句的真人配音。返回 false 表示这次没放出声音：
   * 这句没有配音文件，或者文件还在解码（下次调用就会播出来）。
   * 调用方不需要做任何补偿——**没有配音就保持静音**，不做合成替换。
   */
  sayVoiceLine(scene: Phaser.Scene, speaker: string, text: string, volume = 1) {
    if (!this.hasVoiceClip(speaker, text)) return false
    // 静音时直接当作"已处理"，省掉一次无意义的加载
    if (this.prefs.muted) return true

    const key = `${speaker}/${this.voiceIdOf(speaker, text)}`
    if (!this.ensureVoiceLoaded(scene, key)) {
      // 还在解码：记下来，加载完成后补播（换台词时会被覆盖，不会串音）
      this.pendingVoice = { scene, key, volume }
      return false
    }

    this.pendingVoice = null
    return this.playVoiceSound(scene, key, volume)
  }

  /** 掐掉正在播的那句配音（跳过对话、或对话结束时调用） */
  stopVoice() {
    // 取消"等加载完成再补播"的排队，避免翻页后突然冒出一句
    this.pendingVoice = null
    if (!this.voiceSound) return
    try {
      this.voiceSound.stop()
    } catch {
      /* ignore */
    }
    this.voiceSound = null
  }

  /** 章节开始时预加载该章会用到的配音，避免"第一句因为还在解码而没声音"。
   * 返回预加载了多少条。
   */
  preloadVoiceClips(scene: Phaser.Scene, lines: Array<{ who?: string; text: string }>) {
    if (!Object.keys(this.voiceIndex).length) return 0
    let queued = 0
    for (const line of lines) {
      if (!line.who) continue
      if (!this.hasVoiceClip(line.who, line.text)) continue
      const key = `${line.who}/${this.voiceIdOf(line.who, line.text)}`
      if (this.voiceLoading.has(key) || scene.cache.audio.exists(key)) continue
      this.voiceLoading.add(key)
      scene.load.audio(key, `assets/audio/voice/${key}.mp3`)
      scene.load.once(`filecomplete-audio-${key}`, () => this.voiceLoading.delete(key))
      queued++
    }
    if (queued > 0) scene.load.start()
    return queued
  }

  // ---------- 合成人声 ----------

  /** 让某位角色用她的声线唱一串音节（默认就是"生日快乐"） */
  sayAs(voiceKey: string, syllables: Syllable[] = HAPPY_BIRTHDAY, opts: { volume?: number; spread?: number } = {}) {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    singPhrase(ctx, this.voiceBus ?? ctx.destination, voiceKey, syllables, ctx.currentTime + 0.05, {
      volume: opts.volume ?? 0.5,
      spread: opts.spread ?? 0.02
    })
  }

  /**
   * 注意：这里**没有**台词合成功能。
   *
   * 曾经写过一个 sayText()：按每个字的韵母用振荡器"念"出台词。后来删掉了——
   * 那是机器合成的电子音，不是人声；没有真人配音时保持静音打字才是对的，
   * 用合成音顶替只会让人觉得出戏。台词配音一律来自 assets/audio/voice 下的真人录音。
   *
   * 合唱用的 sayChorus() 与终章那一句 sayAs() 仍然保留：它们是"唱歌"的演出效果，
   * 不是台词朗读，属于原本的玩法设计。
   */

  /** 大家一起唱（错开一点点，最后一个音一起收） */
  sayChorus(voiceKeys: string[], syllables: Syllable[] = HAPPY_BIRTHDAY, volume = 0.6) {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    singChorus(ctx, this.voiceBus ?? ctx.destination, voiceKeys, syllables, ctx.currentTime + 0.05, { volume })
  }

  // ---------- 音效 ----------

  /** 轻快的收集音 */
  playCollect() {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'triangle'
      o.frequency.value = f
      o.connect(g)
      g.connect(this.sfxBus ?? ctx.destination)
      const t = ctx.currentTime + i * 0.09
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.12, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o.start(t)
      o.stop(t + 0.6)
    })
  }

  /** 很轻的对话"啾"声，给对话推进一点反馈 */
  playBlip() {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    o.connect(g)
    g.connect(this.sfxBus ?? ctx.destination)
    const t = ctx.currentTime
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.start(t)
    o.stop(t + 0.25)
  }

  /** 敲门声 */
  playKnock() {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    for (const f of [90, 70]) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(g)
      g.connect(this.sfxBus ?? ctx.destination)
      const t = ctx.currentTime
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.25, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
      o.start(t)
      o.stop(t + 0.2)
    }
  }

  /** 惊喜音 */
  playSparkle() {
    const ctx = this.running()
    if (!ctx) return
    this.ensureBuses(ctx)
    const notes = [659.25, 783.99, 987.77, 1318.5]
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      o.connect(g)
      g.connect(this.sfxBus ?? ctx.destination)
      const t = ctx.currentTime + i * 0.08
      g.gain.setValueAtTime(0.0001, t)
      g.gain.linearRampToValueAtTime(0.09, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1)
      o.start(t)
      o.stop(t + 1.2)
    })
  }
}

export const audioManager = new AudioManager()
