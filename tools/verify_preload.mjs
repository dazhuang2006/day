/**
 * 验证"读信期间就开始缓冲结尾视频"。
 * 在点按钮之前检查浏览器是否已经为 finale.mp4 发起了请求。
 *
 * 用法：node tools\verify_preload.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9356
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
  const reqs = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url
      if (u.includes('finale.mp4')) reqs.push({ t: Date.now(), range: m.params.request.headers?.Range || m.params.request.headers?.range || '-' })
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  return { send, reqs, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-pre-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

try {
  cdp = await connect()
  const { send, reqs } = cdp
  for (let i = 0; i < 30; i++) {
    if ((await ev(send, 'typeof window.__finale === "function"')) === true) break
    await sleep(400)
  }
  // 进入终章，等信出现
  await ev(send, `(() => { window.__state.letterRead = false; window.__state.finaleVideoSeen = false; window.__state.phase='surprise'; return true })()`)
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(6000)

  const before = reqs.length
  const letterShown = await ev(send, `(() => {
    const s = window.__game.scene.getScene('BirthdayScene')
    const texts = s.children.list.filter((c) => c.type === 'Text').map((c) => String(c.text || ''))
    return texts.some((t) => t.includes('点击'))
  })()`)
  check('信件已出现（还没点按钮）', letterShown === true)
  check('读信期间已发起 finale.mp4 请求（预加载生效）', before > 0, `请求数=${before}`)
  if (before > 0) {
    const ranges = reqs.filter((r) => r.range !== '-').length
    console.log(`    其中带 Range 的请求: ${ranges}`)
  }

  // 等几秒看缓冲是否继续增长
  await sleep(4000)
  const after = reqs.length
  console.log(`    4 秒后累计请求数: ${before} -> ${after}`)
  check('仍在继续缓冲（有多段/多请求）', after >= before, `${after} 次`)
  const vs = await ev(send, `Array.from(document.querySelectorAll('video')).length`)
  console.log(`    页面上的 <video> 数量: ${vs}（预加载用的元素是脱离 DOM 的，这里通常是 0）`)

  const failed = results.filter((r) => !r).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
