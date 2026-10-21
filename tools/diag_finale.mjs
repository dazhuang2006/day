/**
 * 结尾视频时序诊断：调用 __finale() 后按时间点采样叠层状态并截图。
 * 目的：定位"返回 played 但叠层很快消失"是 ended、error 还是被跳过。
 *
 * 用法：node tools\diag_finale.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9341
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const OUT = 'D:\\python\\xiangmu\\youxi1\\refs\\fs_diag'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
      logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  return { send, logs, close: () => ws.close() }
}

async function ev(send, expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const PROBE = `(() => {
  const w = document.getElementById('finale-video')
  if (!w) return { exists: false }
  const v = w.querySelector('video')
  const b = w.querySelector('button')
  return {
    exists: true,
    paused: v.paused, ended: v.ended, t: Math.round(v.currentTime * 100) / 100,
    ready: v.readyState, err: v.error ? v.error.code : null,
    dur: isNaN(v.duration) ? -1 : v.duration,
    opacity: w.style.opacity,
    btn: b ? b.textContent : null, btnVisible: b ? b.style.display !== 'none' : false,
    soundPaused: (() => { try { return window.__game.sound._paused } catch (e) { return 'n/a' } })()
  }
})()`

async function shot(send, name) {
  try {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  } catch { /* ignore */ }
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-df-'))
mkdirSync(OUT, { recursive: true })
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp
  for (let i = 0; i < 30; i++) {
    if (await ev(send, 'typeof window.__finale === "function"')) break
    await sleep(400)
  }
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1200)
  // 清掉"看过"标记，保证这次会播
  await ev(send, `window.__state.finaleVideoSeen = false`)

  console.log('调用 __finale()（不等待）…')
  await ev(send, `window.__finale().then(r => console.log('__finale resolved:', r))`)

  for (const ms of [120, 400, 900, 1600, 2600, 4000]) {
    await sleep(ms === 120 ? 120 : 0)
    if (ms > 120) await sleep(0)
    const s = await ev(send, PROBE)
    console.log(`  t≈${ms}ms:`, JSON.stringify(s))
    if (ms === 900 || ms === 2600) await shot(send, `finale_${ms}.png`)
    if (ms !== 120) await sleep(ms - (ms === 400 ? 120 : ms === 900 ? 400 : ms === 1600 ? 900 : ms === 2600 ? 1600 : 2600))
  }

  console.log('\n最终:', JSON.stringify(await ev(send, PROBE)))
  console.log('\n控制台（含 __finale 结果）:')
  for (const l of logs.slice(-8)) console.log('   ' + l.slice(0, 160))
  console.log(`\n截图: ${OUT}\\finale_900.png / finale_2600.png`)
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
