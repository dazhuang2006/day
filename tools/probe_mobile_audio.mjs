/**
 * 模拟手机环境（触摸 + 真实自动播放策略）测试音频是否出声。
 * 关键：不加 --autoplay-policy=no-user-gesture-required，才和真机一致。
 *
 * 用法：node tools\probe_mobile_audio.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9364
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

const STATE = `(() => {
  const a = window.__audio
  const g = window.__game
  return {
    ctx: a.ctx ? a.ctx.state : 'none',
    music: a.currentMusicName,
    pad: a.currentPad,
    playingMusic: !!a.playingMusic,
    phaser: (() => { try { return g.sound.getAllPlaying().map((s) => s.key) } catch (e) { return ['err'] } })(),
    smMute: (() => { try { return g.sound.mute } catch (e) { return null } })(),
    locked: (() => { try { return g.sound.locked } catch (e) { return null } })(),
    musicBus: (() => { try { return Math.round(a.musicBus.gain.value * 1000) / 1000 } catch (e) { return null } })(),
    volume: a.prefs.volume,
    muted: a.prefs.muted
  }
})()`

const profile = mkdtempSync(join(tmpdir(), 'dsh-ma-'))
// 注意：故意不加 --autoplay-policy=no-user-gesture-required
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp

  // 手机模拟：尺寸 + 触摸
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })

  for (let i = 0; i < 40; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }
  await sleep(1500)
  console.log('解锁前:', JSON.stringify(await ev(send, STATE)))

  // 用真实触摸点一下画布（模拟手指点"新的一天"）
  const box = await ev(send, `(() => { const c = document.querySelector('#game-wrap canvas'); const r = c.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.62) } })()`)
  console.log('触摸位置:', JSON.stringify(box))
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(2000)
  console.log('触摸后 +2s:', JSON.stringify(await ev(send, STATE)))

  await sleep(2000)
  console.log('触摸后 +4s:', JSON.stringify(await ev(send, STATE)))

  // 再点几次推进
  for (let i = 0; i < 3; i++) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] })
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(1200)
  }
  console.log('多次触摸后:', JSON.stringify(await ev(send, STATE)))

  // 语音测试：__say 之后 Phaser 音源有没有真的播
  const sayRes = await ev(send, "window.__say('rarity', '亲爱的，你终于来了。')")
  await sleep(1500)
  console.log('语音测试 __say ->', sayRes)
  console.log('语音后状态:', JSON.stringify(await ev(send, STATE)))

  console.log('\n控制台:')
  for (const l of logs.slice(-8)) console.log('  ' + l.slice(0, 150))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
