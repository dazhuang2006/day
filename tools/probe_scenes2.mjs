/**
 * 深挖部署站点：为什么场景没有启动。
 * 检查帧数、各场景 status、并尝试手动 start 看是否恢复。
 *
 * 用法：node tools\probe_scenes2.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9351
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

async function ev(send, expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const STATUS_NAMES = `{0:'PENDING',1:'INIT',2:'START',3:'LOADING',4:'CREATING',5:'RUNNING',6:'PAUSED',7:'SLEEPING',8:'SHUTDOWN',9:'DESTROYED'}`

const profile = mkdtempSync(join(tmpdir(), 'dsh-scn2-'))
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
  await sleep(2500)

  const st = await ev(send, `(() => {
    const g = window.__game
    const S = ${STATUS_NAMES}
    const scenes = g.scene.scenes.map((s) => ({ key: s.scene.key, status: S[s.sys.settings.status] || s.sys.settings.status }))
    return {
      frames: g.loop ? g.loop.frame : null,
      running: g.loop ? g.loop.running : null,
      pending: g.scene._pending ? g.scene._pending.length : null,
      scenes,
      isReady: g.isBooted, docReady: document.readyState
    }
  })()`)
  console.log('状态:', JSON.stringify(st, null, 1))

  // 等 2 秒看帧数是否还在增加（游戏循环是否真的在跑）
  const f1 = await ev(send, 'window.__game.loop.frame')
  await sleep(2000)
  const f2 = await ev(send, 'window.__game.loop.frame')
  console.log(`帧数: ${f1} -> ${f2}  (${f2 > f1 ? '循环在跑' : '循环停着'})`)

  // 手动启动 TitleScene
  console.log('\n尝试手动启动 TitleScene …')
  await ev(send, `window.__game.scene.start('TitleScene')`)
  await sleep(1500)
  const after = await ev(send, `(() => {
    const S = ${STATUS_NAMES}
    const g = window.__game
    return {
      active: g.scene.getScenes(true).map((s) => s.scene.key),
      titleStatus: S[g.scene.keys.TitleScene.sys.settings.status]
    }
  })()`)
  console.log('手动启动后:', JSON.stringify(after))

  console.log('\n控制台日志:')
  for (const l of logs.slice(-15)) console.log('  ' + l.slice(0, 200))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
