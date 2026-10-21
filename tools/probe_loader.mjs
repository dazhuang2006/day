/**
 * 抓部署站点的网络请求 + BootScene 加载器内部状态，定位为什么一直 LOADING。
 *
 * 用法：node tools\probe_loader.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9352
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
  const reqs = new Map()
  const logs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    if (m.method === 'Network.requestWillBeSent') {
      reqs.set(m.params.requestId, { url: m.params.request.url, status: null, type: m.params.type })
    }
    if (m.method === 'Network.responseReceived') {
      const r = reqs.get(m.params.requestId)
      if (r) { r.status = m.params.response.status; r.mime = m.params.response.mimeType }
    }
    if (m.method === 'Network.loadingFailed') {
      const r = reqs.get(m.params.requestId)
      if (r) { r.status = 'FAILED:' + m.params.errorText }
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
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  return { send, logs, reqs, close: () => ws.close() }
}

async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-ldr-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs, reqs } = cdp
  for (let i = 0; i < 30; i++) {
    if ((await ev(send, 'typeof window.__game === "object" && !!window.__game')) === true) break
    await sleep(400)
  }
  await sleep(5000)

  const st = await ev(send, `(() => {
    const g = window.__game
    const boot = g.scene.keys.BootScene
    const L = boot && boot.load
    const files = L && L.list ? Object.keys(L.list).map((k) => {
      const f = L.list[k]
      return { key: k, state: f.state, url: f.url }
    }) : null
    return {
      isLoading: L ? L.isLoading() : null,
      totalToLoad: L ? L.totalToLoad : null,
      totalComplete: L ? L.totalComplete : null,
      totalFailed: L ? L.totalFailed : null,
      bootStatus: boot ? boot.sys.settings.status : null,
      files
    }
  })()`)
  console.log(JSON.stringify(st, null, 1))

  console.log('\n=== /assets/ 相关请求 ===')
  for (const r of [...reqs.values()]) {
    if (r.url.includes('/assets/')) {
      console.log(`  ${r.status}  ${r.mime || ''}  ${r.url.replace(/^https?:\/\/[^/]+/, '')}`)
    }
  }

  console.log('\n控制台:')
  for (const l of logs.slice(-10)) console.log('  ' + l.slice(0, 180))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
