/**
 * 专测：部署站点上手动启动 TitleScene 能否恢复。
 *
 * 用法：node tools\probe_start.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9353
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-st-'))
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
  await sleep(5000)

  const before = await ev(send, `(() => {
    const g = window.__game
    const t = g.scene.keys.TitleScene
    return {
      activeScenes: g.scene.getScenes(true).map((s) => s.scene.key),
      titleStatus: t ? t.sys.settings.status : null,
      titleChildren: t && t.children ? t.children.list.length : null,
      bootStatus: g.scene.keys.BootScene ? g.scene.keys.BootScene.sys.settings.status : null
    }
  })()`)
  console.log('启动前:', JSON.stringify(before))

  console.log('\n调用 game.scene.start("TitleScene") …')
  const r = await ev(send, `(() => {
    try {
      window.__game.scene.start('TitleScene')
      return 'called'
    } catch (e) { return 'threw: ' + e }
  })()`)
  console.log('  返回值:', r)
  await sleep(2000)

  const after = await ev(send, `(() => {
    const g = window.__game
    const t = g.scene.keys.TitleScene
    return {
      activeScenes: g.scene.getScenes(true).map((s) => s.scene.key),
      titleStatus: t ? t.sys.settings.status : null,
      titleChildren: t && t.children ? t.children.list.length : null,
      canvas: !!g.canvas
    }
  })()`)
  console.log('启动后:', JSON.stringify(after))

  console.log('\n控制台（最后 12 条）:')
  for (const l of logs.slice(-12)) console.log('  ' + l.slice(0, 190))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
