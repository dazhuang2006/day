// 结尾视频播放：在 Phaser 画布之上叠一个原生 <video>，播完再交回游戏流程。
//
// 为什么用 DOM 而不是 Phaser 的视频播放：
//   Phaser 播视频依赖浏览器对 <video> 的解码支持，且要手动和纹理/音频同步；
//   直接用原生 <video> 最稳（mp4/H.264 兼容性最好），也能拿到原声。
//
// 设计要点：
//   - 文件缺失/解码失败时不抛错，直接当作"没有视频"，游戏流程照常继续；
//   - 播放期间暂停游戏音频，结束后恢复，避免主题曲和视频原声打架；
//   - 支持点击跳过（可配置延迟出现，避免误触）。

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
  /** 播放开始/结束的回调，用于暂停与恢复游戏音频 */
  onStart?: () => void
  onEnd?: () => void
}

export function playFinaleVideo(opts: PlayVideoOptions): Promise<VideoResult> {
  const { src, width, height, skippable = true, skipAfter = 0 } = opts

  return new Promise<VideoResult>((resolve) => {
    let settled = false
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
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('error', onError)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('loadeddata', onPlaying)
      video.removeEventListener('timeupdate', onPlaying)
      window.removeEventListener('keydown', onKey)
      try {
        video.pause()
      } catch {
        /* ignore */
      }
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

    const video = document.createElement('video')
    video.src = src
    video.playsInline = true
    video.preload = 'auto'
    video.controls = false
    // 铺满可用空间并保持比例；游戏画面是 16:9，视频一般也是
    Object.assign(video.style, {
      width: '100%',
      height: '100%',
      objectFit: 'contain',
      background: '#000'
    } satisfies Partial<CSSStyleDeclaration>)

    wrap.appendChild(video)

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

    let skipTimer = 0
    if (skippable && skipAfter > 0) {
      skipTimer = window.setTimeout(() => {
        skipBtn.style.display = 'block'
      }, skipAfter * 1000)
    }

    const onKey = (e: KeyboardEvent) => {
      // Esc 跳过；空格/回车交给浏览器默认（会切换播放）
      if (e.key === 'Escape' && skippable) finish('skipped')
    }

    const onPlaying = () => {
      // 真正开始出画面时再淡入，避免黑屏闪烁
      wrap.style.opacity = '1'
      // 只触发一次：下面挂了多个事件做兜底（见下），不能重复回调
      if (started) return
      started = true
      try {
        opts.onStart?.()
      } catch {
        /* ignore */
      }
    }
    const onEnded = () => finish('ended')
    const onError = () => {
      // 文件不存在或解码失败：当作没有视频，流程继续
      console.warn(`[finale-video] 无法播放 ${src}，已跳过`)
      finish('missing')
    }

    let started = false
    // playing 是主事件；但视频可能在小文件/缓存命中时"瞬间就绪"，
    // playing 早于监听器挂载而错过，于是再挂 loadeddata / timeupdate 兜底。
    video.addEventListener('playing', onPlaying)
    video.addEventListener('loadeddata', onPlaying)
    video.addEventListener('timeupdate', onPlaying)
    video.addEventListener('ended', onEnded)
    video.addEventListener('error', onError)
    window.addEventListener('keydown', onKey)

    document.body.appendChild(wrap)

    // 开始播放（静音自动播放限制在这里不适用：这是剧情内的播放，
    // 且游戏本身要求用户点击推进，所以能拿到用户手势）
    const p = video.play()
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // 被自动播放策略拦下：显示一个"点击播放"的按钮兜底
        skipBtn.textContent = '▶ 点击播放'
        skipBtn.style.display = 'block'
        skipBtn.onclick = (e) => {
          e.stopPropagation()
          video.play().catch(() => finish('missing'))
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
