/**
 * 验证结尾两件事：
 *   A) 视频播放时游戏音频真的静了（不再和视频原声打架）
 *   B) 信读完后先出现按钮，而且**不点按钮视频不会自己出来**
 *
 * 用法：node tools\verify_finale_flow.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9343
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!URL_TO_OPEN) {
  console.error('需要页面 URL')
  process.exit(2)
}

async function connect() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      if (targets.some((t) => t.type === 'page')) break } catch { /* 等 */ }
    await sleep(300)
  }
  const page = targets?.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接失败')) })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description || 'unknown')
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  return { send, errors, close: () => ws.close() }
}

async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

/** 点画布中心（Phaser 的 pointerdown 来自 canvas） */
async function clickCanvas(send, w, h) {
  const x = Math.round(w / 2), y = Math.round(h * 0.9)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 })
  }
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-ff-'))
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

try {
  cdp = await connect()
  const { send, errors } = cdp

  for (let i = 0; i < 30; i++) {
    if (typeof (await ev(send, 'typeof window.__finale === "function"')) === 'boolean' &&
        (await ev(send, 'typeof window.__finale === "function"')) === true) break
    await sleep(400)
  }

  const size = await ev(send, `[window.innerWidth, window.innerHeight]`)
  console.log(`窗口 ${size[0]}x${size[1]}`)

  // ---------- A) 视频时音频静音 ----------
  console.log('\n[A] 视频播放时的音频状态')
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1400)
  // 确认此刻游戏音乐在放（这是前提）
  const before = await ev(send, `({
    playingMusic: !!window.__audio.playingMusic,
    silent: window.__audio.isVideoSilent
  })`)
  console.log('    播放前:', JSON.stringify(before))

  await ev(send, `window.__state.finaleVideoSeen = false`)
  await ev(send, `window.__finale()`)
  await sleep(1600)

  const during = await ev(send, `({
    silent: window.__audio.isVideoSilent,
    playingMusic: !!window.__audio.playingMusic,
    overlay: !!document.getElementById('finale-video'),
    soundPlaying: (() => { try { return window.__game.sound.getAllPlaying().length } catch(e) { return 'n/a' } })()
  })`)
  console.log('    播放中:', JSON.stringify(during))
  check('视频播放时标记为静音', during.silent === true)
  check('游戏音乐已停止（playingMusic 为空）', during.playingMusic === false)
  if (typeof during.soundPlaying === 'number') {
    check('Phaser 中没有仍在播放的音源', during.soundPlaying === 0, `getAllPlaying=${during.soundPlaying}`)
  }
  check('视频叠层存在', during.overlay === true)

  // 收尾：跳过视频，恢复正常状态
  await ev(send, `document.querySelector('#finale-video button')?.click()`)
  await sleep(600)

  // ---------- B) 信件按钮 ----------
  console.log('\n[B] 信读完后先出按钮，不点不播')
  // 重置到"还没读信"的状态，重新进终章
  await ev(send, `(() => {
    window.__state.letterRead = false
    window.__state.finaleVideoSeen = false
    window.__state.phase = 'surprise'
    return true
  })()`)
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1500)

  // 把信推到最后一页：3 页 → 需要若干次点击。多打几次，但不要触发最后一次"读完"
  for (let i = 0; i < 3; i++) {
    await clickCanvas(send, size[0], size[1])
    await sleep(900)
  }
  const midState = await ev(send, `(() => {
    const r = []
    window.__game.scene.getScene('BirthdayScene').children.list.forEach((c) => {
      if (c.type === 'Text' && c.text) r.push(c.text)
    })
    return { texts: r.map((t) => String(t).slice(0, 24)), overlay: !!document.getElementById('finale-video') }
  })()`)
  console.log('    3 次点击后屏幕文字:', JSON.stringify(midState.texts))
  console.log('    叠层存在?', midState.overlay)
  check('此时视频还没出现（信还没读完按钮）', midState.overlay === false)

  // 再点一次 = 读完信 → 应出现按钮，但仍不播视频
  await clickCanvas(send, size[0], size[1])
  await sleep(1000)
  const afterRead = await ev(send, `(() => {
    const s = window.__game.scene.getScene('BirthdayScene')
    const btns = s.children.list.filter((c) => c.type === 'Text' && c.input && c.input.enabled)
      .map((c) => c.text)
    return { clickableTexts: btns, overlay: !!document.getElementById('finale-video') }
  })()`)
  console.log('    读完信后:', JSON.stringify(afterRead))
  check('信读完后出现可点按钮', afterRead.clickableTexts.length > 0, `按钮文字=${JSON.stringify(afterRead.clickableTexts)}`)
  check('未点按钮时视频不出现', afterRead.overlay === false)

  // 等 2 秒确认它不会自己冒出来
  await sleep(2000)
  check('等待 2 秒视频仍未自动播放', (await ev(send, `!!document.getElementById('finale-video')`)) === false)

  const realErrors = errors.filter((e) => !/decode audio data/i.test(e))
  check('无未捕获 JS 异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\n有 ${failed.length} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed.length ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
