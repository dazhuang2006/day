/**
 * 测"全屏模式下配音失效"：
 *   触摸解锁 -> 进全屏 -> 试播配音 -> 退出全屏 -> 再试播
 * 每一步都记录 ctx / locked / voiceSound / 是否真的在播。
 *
 * 用法：node tools\probe_fullscreen_voice.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9366
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
  const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      logs.push('[' + m.params.type + '] ' + (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails?.exception?.description || 'x'))
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  return { send, logs, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}
async function tap(send, x, y) {
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

const STATE = `(() => {
  const a = window.__audio
  const g = window.__game
  return {
    fs: !!document.fullscreenElement,
    ctx: a.ctx ? a.ctx.state : 'none',
    locked: (() => { try { return g.sound.locked } catch (e) { return null } })(),
    playing: !!a.voiceSound,
    phaser: (() => { try { return g.sound.getAllPlaying().map((s) => s.key) } catch (e) { return ['err'] } })(),
    voiceBus: (() => { try { return Math.round(a.voiceBus.gain.value * 1000) / 1000 } catch (e) { return null } })()
  }
})()`

const TEXT = '亲爱的，你终于来了。'
const profile = mkdtempSync(join(tmpdir(), 'dsh-fv2-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })

  for (let i = 0; i < 60; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }
  await sleep(800)

  const canvas = await ev(send, `(() => { const c = document.querySelector('#game-wrap canvas'); const r = c.getBoundingClientRect()
    return { cx: Math.round(r.left + r.width / 2), cyMid: Math.round(r.top + r.height * 0.62) } })()`)
  await tap(send, canvas.cx, canvas.cyMid)   // 解锁音频
  await sleep(1200)
  console.log('解锁后:', JSON.stringify(await ev(send, STATE)))

  // 点全屏按钮
  const fsBox = await ev(send, `(() => { const b = document.getElementById('fs-btn'); const r = b.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
  console.log('全屏按钮位置:', JSON.stringify(fsBox))
  await tap(send, fsBox.x, fsBox.y)
  await sleep(1500)
  console.log('进全屏后:', JSON.stringify(await ev(send, STATE)))

  // 全屏下试播配音
  const r1 = await ev(send, `window.__audio.sayVoiceLine(window.__game.scene.getScenes(true)[0], 'rarity', ${JSON.stringify(TEXT)})`)
  let played1 = false
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    played1 = await ev(send, `!!window.__audio.voiceSound`)
    if (played1) break
  }
  console.log(`全屏下试播: sayVoiceLine=${r1}, 在播=${played1}`)
  console.log('全屏下状态:', JSON.stringify(await ev(send, STATE)))

  // 退出全屏
  await ev(send, `document.exitFullscreen && document.exitFullscreen()`)
  await sleep(1500)
  console.log('退出全屏后:', JSON.stringify(await ev(send, STATE)))

  // 再试一次
  const r2 = await ev(send, `window.__audio.sayVoiceLine(window.__game.scene.getScenes(true)[0], 'rarity', ${JSON.stringify(TEXT)})`)
  let played2 = false
  for (let i = 0; i < 15; i++) {
    await sleep(400)
    played2 = await ev(send, `!!window.__audio.voiceSound`)
    if (played2) break
  }
  console.log(`退出后试播: sayVoiceLine=${r2}, 在播=${played2}`)

  if (logs.length) { console.log('\n控制台:'); for (const l of logs.slice(-6)) console.log('  ' + l.slice(0, 140)) }
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
