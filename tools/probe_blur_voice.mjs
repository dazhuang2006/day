/**
 * 验证"失焦不该让配音静音"。
 * 模拟手机全屏时的 blur：修好后 Phaser 的 AudioContext 应保持 running，配音仍能播。
 *
 * 用法：node tools\probe_blur_voice.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9367
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!URL_TO_OPEN) { console.error('需要 URL'); process.exit(2) }

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  return { send, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const STATE = `(() => {
  const g = window.__game
  const a = window.__audio
  const sm = g.sound
  return {
    pauseOnBlur: sm.pauseOnBlur,
    phaserCtx: sm.context ? sm.context.state : 'none',
    ourCtx: a.ctx ? a.ctx.state : 'none',
    lostFocus: sm.gameLostFocus,
    playing: !!a.voiceSound
  }
})()`

const TEXT = '亲爱的，你终于来了。'
const profile = mkdtempSync(join(tmpdir(), 'dsh-bv-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

try {
  cdp = await connect()
  const { send } = cdp
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })

  for (let i = 0; i < 60; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }
  await sleep(800)

  // 触摸解锁
  const c = await ev(send, `(() => { const e = document.querySelector('#game-wrap canvas'); const r = e.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.62) } })()`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(1200)
  console.log('解锁后:', JSON.stringify(await ev(send, STATE)))
  check('pauseOnBlur 已关闭', (await ev(send, 'window.__game.sound.pauseOnBlur')) === false)

  // 模拟失焦（手机进全屏会触发）
  await ev(send, `window.dispatchEvent(new Event('blur'))`)
  await sleep(600)
  const afterBlur = await ev(send, STATE)
  console.log('失焦后:', JSON.stringify(afterBlur))
  check('失焦后 Phaser 上下文仍 running', afterBlur.phaserCtx === 'running', String(afterBlur.phaserCtx))

  // 失焦状态下试播配音
  const r = await ev(send, `window.__audio.sayVoiceLine(window.__game.scene.getScenes(true)[0], 'rarity', ${JSON.stringify(TEXT)})`)
  let played = false
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    played = await ev(send, `!!window.__audio.voiceSound`)
    if (played) break
  }
  console.log(`失焦下试播: sayVoiceLine=${r}, 在播=${played}`)
  check('失焦状态下配音仍能播', played === true)

  await ev(send, `window.dispatchEvent(new Event('focus'))`)
  await sleep(400)
  console.log('恢复焦点后:', JSON.stringify(await ev(send, STATE)))

  const failed = results.filter((x) => !x).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
