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
    let retryTimer = 0

    const finish = (result: VideoResult) => {
      if (settled) return
      settled = true
      try {
        opts.onEnd?.()
      } catch {
        /* ignore */
      }
      // 清掉所有挂载的监听与 DOM，避免残留
      disposed = true
      window.clearInterval(watchdog)
      window.clearTimeout(skipTimer)
      window.clearTimeout(retryTimer)
      // Blob 播放用的临时 URL 要释放，否则整份视频会一直占着内存
      if (blobUrl) {
        try {
          URL.revokeObjectURL(blobUrl)
        } catch {
          /* ignore */
        }
        blobUrl = ''
      }
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
    let playedAtLeastOnce = false
    const onPlaying = () => {
      // 真正开始出画面时再淡入，避免黑屏闪烁
      wrap.style.opacity = '1'
      buffering.textContent = '缓冲中…'
      buffering.style.display = 'none'
      playedAtLeastOnce = true
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

    // 出错处理：只要视频已经出过画面，就**绝不自动退出**——那会让人觉得
    // "看到一半被踢回游戏"。改成保留画面、显示提示、自动重连。
    // 只有"从头到尾一帧都没播出来"（文件缺失/解码不了）才真正跳过。
    let recoveries = 0
    let blobTried = false
    let blobUrl = ''

    /**
     * 最后手段：绕过浏览器的 HTTP 缓存，整份下载后用 Blob 播放。
     * 手机上常见"每次都停在同一秒"其实是缓存里躺着一份坏副本，
     * 这条路径能彻底绕开缓存与流式分段的坑（代价是要等下载完）。
     */
    const playFromBlob = async (at: number) => {
      if (blobTried) return false
      blobTried = true
      buffering.textContent = '正在完整下载视频…'
      buffering.style.display = 'block'
      try {
        const res = await fetch(src, { cache: 'reload' })
        if (!res.ok) return false
        const blob = await res.blob()
        if (blob.size < 1024) return false
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        blobUrl = URL.createObjectURL(blob)
        el.src = blobUrl
        el.currentTime = at
        await el.play()
        buffering.textContent = '缓冲中…'
        return true
      } catch (e) {
        console.warn('[finale-video] 整份下载失败', e)
        return false
      }
    }

    const recover = () => {
      const at = el.currentTime
      recoveries++
      // 同一位置连续失败多次 -> 说明不是网络抖动，换整份下载
      if (recoveries > 3 && !blobTried) {
        void playFromBlob(at).then((ok) => {
          if (!ok) recover()
        })
        return
      }
      const delay = Math.min(4000, 600 * recoveries)
      buffering.textContent = '网络有点慢，正在重连…'
      buffering.style.display = 'block'
      window.clearTimeout(retryTimer)
      retryTimer = window.setTimeout(() => {
        try {
          // 先试继续播；不行再重新加载并跳回原位置
          void el
            .play()
            .then(() => {
              buffering.textContent = '缓冲中…'
            })
            .catch(() => {
              el.load()
              el.currentTime = at
              void el.play().catch(() => recover())
            })
        } catch {
          recover()
        }
      }, delay)
    }

    const onError = () => {
      const code = el.error ? el.error.code : 0
      const at = el.currentTime
      if (at > 1 || playedAtLeastOnce) {
        console.warn(`[finale-video] 播放中断（code=${code}，${at.toFixed(1)}s），自动重连（第 ${recoveries + 1} 次）`)
        recover()
        return
      }
      // 一帧都没播出来：文件不存在或无法解码，当作没有视频
      console.warn(`[finale-video] 无法播放 ${src}（code=${code}），已跳过`)
      finish('missing')
    }
    // 长时间卡住（不是报错）也要有提示
    const onStalled = () => {
      buffering.style.display = 'block'
    }

    // ---- 卡死看门狗 ----
    // 有些手机解码器会"静默卡住"：不报错、也不推进 currentTime，画面就停住了。
    // 这里每秒检查一次，连续卡住就依次尝试：继续播 -> 轻推一下 -> 重载并跳回原位置。
    let lastT = -1
    let stuck = 0
    let disposed = false
    const watchdog = window.setInterval(() => {
      if (disposed || settled) return
      const t = el.currentTime
      if (!el.paused && Math.abs(t - lastT) < 0.01) {
        stuck++
        buffering.style.display = 'block'
        buffering.textContent = '缓冲中…'
        if (stuck === 3) {
          void el.play().catch(() => {})
        } else if (stuck === 6) {
          console.warn(`[finale-video] 画面卡在 ${t.toFixed(1)}s，尝试轻推`)
          try {
            el.currentTime = Math.min((el.duration || 0) - 0.5, t + 0.2)
            void el.play().catch(() => {})
          } catch {
            /* ignore */
          }
        } else if (stuck >= 10) {
          console.warn(`[finale-video] 仍卡在 ${t.toFixed(1)}s，重载并跳回`)
          stuck = 0
          try {
            el.load()
            el.currentTime = t
            void el.play().catch(() => recover())
          } catch {
            recover()
          }
        }
      } else {
        stuck = 0
        lastT = t
      }
      updateDebug(t)
    }, 1000)
    window.setTimeout(() => {}, 0)

    // ---- 可选调试信息：URL 带 ?debug=1 才显示 ----
    const DEBUG = (() => {
      try {
        return new URLSearchParams(window.location.search).has('debug')
      } catch {
        return false
      }
    })()
    const dbg = document.createElement('div')
    Object.assign(dbg.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      padding: '4px 10px',
      borderRadius: '8px',
      background: 'rgba(0,0,0,0.6)',
      color: '#9fe3ff',
      fontFamily: 'monospace',
      fontSize: '12px',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      display: DEBUG ? 'block' : 'none'
    } satisfies Partial<CSSStyleDeclaration>)
    wrap.appendChild(dbg)
    function updateDebug(t: number) {
      if (!DEBUG) return
      let buffered = ''
      try {
        if (el.buffered.length) {
          const ranges: string[] = []
          for (let i = 0; i < el.buffered.length; i++) {
            ranges.push(`${el.buffered.start(i).toFixed(0)}-${el.buffered.end(i).toFixed(0)}`)
          }
          buffered = ranges.join(',')
        }
      } catch {
        /* ignore */
      }
      const err = el.error ? `err${el.error.code}` : ''
      dbg.textContent = `t=${t.toFixed(1)}/${(el.duration || 0).toFixed(0)}s  buf=${buffered || '0'}  paused=${el.paused ? 1 : 0}  rs=${el.readyState} ${err}`
    }

    // playing 是主事件；但视频可能在小文件/缓存命中时"瞬间就绪"，
    // playing 早于监听器挂载而错过，于是再挂 loadeddata / timeupdate 兜底。
    el.addEventListener('playing', onPlaying)
    el.addEventListener('loadeddata', onPlaying)
    el.addEventListener('timeupdate', onPlaying)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('stalled', onStalled)
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
