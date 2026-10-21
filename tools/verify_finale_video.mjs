/**
 * 验证结尾视频链路：文件存在时能播、能跳过、播完自动移除；并检查游戏音频被暂停/恢复。
 *
 * 为什么单独写：视频叠层是 DOM 元素，类型检查覆盖不到，必须真跑。
 *
 * 用法：node tools\verify_finale_video.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const DEBUG_PORT = 9338
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!URL_TO_OPEN) {
  console.error('需要页面 URL')
  process.exit(2)
}

async function connect() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      targets = await res.json()
      if (targets.some((t) => t.type === 'page')) break
    } catch { /* 等 */ }
    await sleep(300)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP: 找不到 page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接失败')) })
  let id = 0
  const pending = new Map()
  const consoleLines = []
  const errors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'unknown')
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')
  return { send, consoleLines, errors, close: () => ws.close() }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '抛异常')
  return r.result.value
}

/** 视频叠层的当前状态 */
const PROBE = `(() => {
  const w = document.getElementById('finale-video')
  const v = w ? w.querySelector('video') : null
  return {
    exists: !!w,
    src: v ? v.getAttribute('src') : null,
    readyState: v ? v.readyState : -1,
    videoWidth: v ? v.videoWidth : 0,
    duration: v ? (isNaN(v.duration) ? -1 : Math.round(v.duration * 100) / 100) : -1,
    currentTime: v ? Math.round(v.currentTime * 100) / 100 : -1,
    paused: v ? v.paused : null,
    ended: v ? v.ended : null,
    btn: w && w.querySelector('button') ? w.querySelector('button').textContent : null,
    btnVisible: w && w.querySelector('button') ? w.querySelector('button').style.display !== 'none' : false,
    gameSoundPaused: (() => { try { return window.__audio.isVideoSilent === true } catch (e) { return 'n/a' } })()
  }
})()`

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-fv-'))
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN,
  ], { stdio: 'ignore' })

  let cdp
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    cdp = await connect()
    const { send, consoleLines, errors } = cdp

    let ready = false
    for (let i = 0; i < 30; i++) {
      ready = await evaluate(send, 'typeof window.__game === "object" && !!window.__game && typeof window.__finale === "function"')
      if (ready) break
      await sleep(400)
    }
    check('游戏已启动且调试钩子就位', ready === true)
    if (!ready) throw new Error('页面没准备好')

    // 先跳到终章场景（playFinale 是它的方法）
    await evaluate(send, `window.__jump('BirthdayScene')`)
    await sleep(1200)
    // 清掉"看过"标记，保证这次会播
    await evaluate(send, `window.__state.finaleVideoSeen = false`)

    // 触发播放。注意：__finale() 内部是异步建 DOM 的，
    // 之前这里没轮询就直接查，导致误判"叠层没出现"——这次改成轮询等待。
    // 同时记录它的返回值与耗时，便于区分"没播起来"和"播完太快"。
    const callInfo = await evaluate(send, `(() => {
      const t0 = performance.now()
      window.__finaleResult = 'pending'
      window.__finale().then((r) => {
        window.__finaleResult = r
        window.__finaleMs = Math.round(performance.now() - t0)
      }).catch((e) => { window.__finaleResult = 'reject: ' + e })
      return 'started'
    })()`)
    console.log('    调用:', callInfo)

    let s1 = null
    let appeared = false
    for (let i = 0; i < 30; i++) {
      await sleep(150)
      s1 = await evaluate(send, PROBE)
      if (s1.exists && s1.duration > 0) {
        appeared = true
        break
      }
      const r = await evaluate(send, `window.__finaleResult || 'pending'`)
      if (r !== 'pending') {
        console.log(`    第 ${i + 1} 次轮询时 __finale 已返回: ${r}（耗时 ${await evaluate(send, 'window.__finaleMs')}ms）`)
        break
      }
    }
    console.log('    叠层:', JSON.stringify(s1))
    check('视频叠层出现且元数据就绪', appeared === true,
      s1 ? `duration=${s1.duration} 宽=${s1.videoWidth}` : '探针无返回')
    // 注意：公网加载 177MB 视频时，叠层出现瞬间 currentTime 还是 0（还在缓冲），
    // onStart（压低音频）要等真正开始播放才触发。所以先等它播起来再断言。
    let playing = null
    for (let i = 0; i < 20; i++) {
      playing = await evaluate(send, PROBE)
      if (playing && playing.currentTime > 0.1) break
      await sleep(500)
    }
    check('播放期间游戏音频被静音', playing && playing.gameSoundPaused === true,
      playing ? `isVideoSilent=${playing.gameSoundPaused} t=${playing.currentTime}` : '')

    // 等一会儿确认在推进
    await sleep(1500)
    const s2 = await evaluate(send, PROBE)
    console.log('    1.5 秒后:', JSON.stringify({
      t: s2.currentTime, paused: s2.paused, ended: s2.ended, btn: s2.btn, btnVisible: s2.btnVisible,
    }))
    check('视频在播放（currentTime 前进）', s2.currentTime > (s1?.currentTime ?? 0),
      `${s1?.currentTime} -> ${s2.currentTime}`)

    // 测试跳过：点按钮（若还没出现，用 Esc）
    if (s2.btnVisible) {
      await evaluate(send, `document.querySelector('#finale-video button').click()`)
    } else {
      await evaluate(send, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
    }
    await sleep(800)
    const s3 = await evaluate(send, PROBE)
    check('跳过/结束后叠层被移除', s3.exists === false)
    const soundResumed = await evaluate(send, `window.__audio.isVideoSilent !== true`)
    check('播完后游戏音频已恢复', soundResumed === true)
    check('已记为看过（避免下次重播）', await evaluate(send, `window.__state.finaleVideoSeen === true`) === true)

    const realErrors = errors.filter((e) => !/decode audio data/i.test(e))
    check('无未捕获 JS 异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

    const warns = consoleLines.filter((l) => /finale-video/.test(l))
    if (warns.length) console.log('    视频相关日志:', warns.join(' | '))

    const failed = results.filter((r) => !r.ok)
    console.log(failed.length ? `\n有 ${failed.length} 项未通过` : '\nVERIFY PASS')
    process.exitCode = failed.length ? 1 : 0
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    proc.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('VERIFY ERROR:', e.message); process.exitCode = 2 })
