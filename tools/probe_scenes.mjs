/**
 * 探查部署站点里 Phaser 的场景状态（为什么 __say 返回 none）。
 *
 * 用法：node tools\probe_scenes.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9350
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
      logs.push((m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-scn-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp

  for (let i = 0; i < 30; i++) {
    if ((await ev(send, 'typeof window.__game === "object" && !!window.__game')) === true) break
    await sleep(400)
  }
  console.log('__game 已存在，等待 3 秒让场景启动…')
  await sleep(3000)

  const st = await ev(send, `(() => {
    const g = window.__game
    const all = []
    try { g.scene.scenes.forEach((s) => all.push({ key: s.scene.key, active: s.scene.isActive(), sleeping: s.scene.isSleeping(), visible: s.scene.isVisible() })) } catch (e) { all.push('err:' + e) }
    return {
      isBooted: g.isBooted, isRunning: g.isRunning, isPaused: g.isPaused,
      hasCanvas: !!g.canvas, canvasSize: g.canvas ? [g.canvas.width, g.canvas.height] : null,
      sceneKeys: Object.keys(g.scene.keys || {}),
      getScenesTrue: (() => { try { return g.scene.getScenes(true).map((s) => s.scene.key) } catch (e) { return 'err:' + e } })(),
      detail: all
    }
  })()`)
  console.log(JSON.stringify(st, null, 1))

  console.log('\n控制台日志:')
  for (const l of logs.slice(-12)) console.log('  ' + l.slice(0, 160))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
