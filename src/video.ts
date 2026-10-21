// 结尾视频播放：在 Phaser 画布之上叠一个原生 <video>，播完再交回游戏流程。
//
// 为什么用 DOM 而不是 Phaser 的视频播放：
//   Phaser 播视频依赖浏览器对 <video> 的解码支持，且要手动和纹理/音频同步；
//   直接用原生 <video> 最稳（mp4/H.264 兼容性最好），也能拿到原声。
//
// 设计要点：
//   - 文件缺失/解码失败时不抛错，直接当作"没有视频"，游戏流程照常继续；
//   - 播放期间静音游戏音频，结束后恢复，避免主题曲和视频原声打架；
//   - 支持点击跳过（可配置延迟出现，避免误触）；
//   - 支持提前预加载（读信时就开始缓冲），并显示"缓冲中"提示。
//
// 关于"卡顿"：视频码率必须低于实际带宽才能流畅。公网带宽往往只有几 Mbps，
// 1080p/11Mbps 的原始视频必然卡；发布用的文件建议压到 2 Mbps 以内（720p）。
// 播放器这边能做的优化是提前缓冲 + 明确的缓冲反馈。

export type VideoResult = 'ended' | 'skipped' | 'missing'

export type PlayVideoOptions = {
  /** 视频路径（相对站点根目录） */
  src: string
  /** 画布逻辑宽高，用来给视频框定比例 */
  width: number
  height: number
  /** 是否允许跳过 */
  skippable?: boolean
  /** 跳过按钮在几秒后出现；0 表示立刻可点 */
  skipAfter?: number
  /** 播放开始/结束的回调，用于静音与恢复游戏音频 */
  onStart?: () => void
  onEnd?: () => void
}

// 提前缓冲用的 <video>。
//
// 为什么需要：视频码率再低，公网带宽也只有几 Mbps，
// 点开瞬间才开始下载的话第一段必然等待（就是"卡卡的"）。
// 读信要花几十秒，这段时间正好用来缓冲——点按钮时往往已经够播了。
let preloaded: HTMLVideoElement | null = null
let preloadedSrc = ''

/** 在真正播放前就开始缓冲视频（不可见，不占布局，静音） */
export function preloadFinaleVideo(src: string) {
  if (preloaded) return
  try {
    const v = document.createElement('video')
    v.preload = 'auto'
    v.playsInline = true
    v.muted = true // 预加载阶段不要出声
    v.src = src
    v.load()
    preloaded = v
    preloadedSrc = v.src
  } catch {
    preloaded = null
  }
}

export function playFinaleVideo(opts: PlayVideoOptions): Promise<VideoResult> {
  const { src, width, height, skippable = true, skipAfter = 0 } = opts

  return new Promise<VideoResult>((resolve) => {
    let settled = false
    let el: HTMLVideoElement | null = null
    let skipTimer = 0

    const finish = (result: VideoResult) => {
      if (settled) return
      settled = true
      try {
        opts.onEnd?.()
      } catch {
        /* ignore */
      }
      // 清掉所有挂载的监听与 DOM，避免残留
      window.clearTimeout(skipTimer)
      if (el) {
        el.removeEventListener('ended', onEnded)
        el.removeEventListener('error', onError)
        el.removeEventListener('playing', onPlaying)
        el.removeEventListener('loadeddata', onPlaying)
        el.removeEventListener('timeupdate', onPlaying)
        el.removeEventListener('waiting', onWaiting)
        try {
          el.pause()
        } catch {
          /* ignore */
        }
      }
      window.removeEventListener('keydown', onKey)
      wrap.remove()
      resolve(result)
    }

    // ---- DOM ----
    const wrap = document.createElement('div')
    wrap.id = 'finale-video'
    Object.assign(wrap.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '9999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      opacity: '0',
      transition: 'opacity 320ms ease'
    } satisfies Partial<CSSStyleDeclaration>)

    // 复用预加载过的元素：已经缓冲了一部分，能明显减少开头卡顿
    const absolute = new URL(src, window.location.href).href
    if (preloaded && preloadedSrc === absolute) {
      el = preloaded
      el.muted = false
      preloaded = null
    } else {
      el = document.createElement('video')
      el.src = src
    }
    el.playsInline = true
    el.preload = 'auto'
    el.controls = false
    // 铺满可用空间并保持比例；游戏画面是 16:9，视频一般也是
    Object.assign(el.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000'
    } satisfies Partial<CSSStyleDeclaration>)
    wrap.appendChild(el)

    // 缓冲提示：一开始就显示，开始出画面后隐藏；播放中再次等待时重新显示
    const buffering = document.createElement('div')
    buffering.textContent = '缓冲中…'
    Object.assign(buffering.style, {
      position: 'fixed',
      left: '50%',
      bottom: '64px',
      transform: 'translateX(-50%)',
      padding: '6px 16px',
      borderRadius: '999px',
      background: 'rgba(0,0,0,0.55)',
      color: '#fff',
      fontFamily: '"Microsoft YaHei", system-ui, sans-serif',
      fontSize: '13px',
      letterSpacing: '1px',
      pointerEvents: 'none'
    } satisfies Partial<CSSStyleDeclaration>)
    wrap.appendChild(buffering)

    // 跳过按钮
    const skipBtn = document.createElement('button')
    skipBtn.type = 'button'
    skipBtn.textContent = '跳过 ▸'
    Object.assign(skipBtn.style, {
      position: 'fixed',
      right: '20px',
      bottom: '20px',
      padding: '9px 18px',
      border: '1px solid rgba(255,255,255,0.5)',
      borderRadius: '999px',
      background: 'rgba(0,0,0,0.45)',
      color: '#fff',
      fontFamily: '"Microsoft YaHei", system-ui, sans-serif',
      fontSize: '14px',
      cursor: 'pointer',
      display: skippable && skipAfter <= 0 ? 'block' : 'none'
    } satisfies Partial<CSSStyleDeclaration>)
    skipBtn.onclick = (e) => {
      e.stopPropagation()
      finish('skipped')
    }
    wrap.appendChild(skipBtn)

    if (skippable && skipAfter > 0) {
      skipTimer = window.setTimeout(() => {
        skipBtn.style.display = 'block'
      }, skipAfter * 1000)
    }

    const onKey = (e: KeyboardEvent) => {
      // Esc 跳过；空格/回车交给浏览器默认（会切换播放）
      if (e.key === 'Escape' && skippable) finish('skipped')
    }

    let started = false
    const onPlaying = () => {
      // 真正开始出画面时再淡入，避免黑屏闪烁
      wrap.style.opacity = '1'
      buffering.style.display = 'none'
      // 只触发一次：下面挂了多个事件做兜底（见下），不能重复回调
      if (started) return
      started = true
      try {
        opts.onStart?.()
      } catch {
        /* ignore */
      }
    }
    const onWaiting = () => {
      // 数据没跟上，正在等缓冲——给个明确反馈，别让人以为卡死了
      buffering.style.display = 'block'
    }
    const onEnded = () => finish('ended')
    const onError = () => {
      // 文件不存在或解码失败：当作没有视频，流程继续
      console.warn(`[finale-video] 无法播放 ${src}，已跳过`)
      finish('missing')
    }

    // playing 是主事件；但视频可能在小文件/缓存命中时"瞬间就绪"，
    // playing 早于监听器挂载而错过，于是再挂 loadeddata / timeupdate 兜底。
    el.addEventListener('playing', onPlaying)
    el.addEventListener('loadeddata', onPlaying)
    el.addEventListener('timeupdate', onPlaying)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    window.addEventListener('keydown', onKey)

    document.body.appendChild(wrap)

    // 预加载过的元素可能已经缓冲到可以播放的位置，这种情况直接播会更顺
    const p = el.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 被自动播放策略拦下：显示一个"点击播放"的按钮兜底
        skipBtn.textContent = '▶ 点击播放'
        skipBtn.style.display = 'block'
        skipBtn.onclick = (e) => {
          e.stopPropagation()
          el?.play().catch(() => finish('missing'))
          skipBtn.textContent = '跳过 ▸'
          skipBtn.onclick = (ev) => {
            ev.stopPropagation()
            finish('skipped')
          }
        }
      })
    }

    void width
    void height
  })
}
