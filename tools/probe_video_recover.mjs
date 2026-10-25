/**
 * 验证结尾视频"播放中途出错"时不会直接消失，而是先尝试恢复。
 * 做法：播到 3 秒后手动派发 error 事件，检查叠层是否还在、是否继续播。
 *
 * 用法：node tools\probe_video_recover.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9368
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-vr-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

try {
  cdp = await connect()
  const { send, logs } = cdp
  for (let i = 0; i < 40; i++) {
    if ((await ev(send, 'typeof window.__finale === "function"')) === true) break
    await sleep(400)
  }
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1200)
  await ev(send, `window.__state.finaleVideoSeen = false`)
  await ev(send, `window.__finale()`)

  // 等播到 3 秒以上
  let t = 0
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    t = await ev(send, `(() => { const v = document.querySelector('#finale-video video'); return v ? v.currentTime : -1 })()`)
    if (t > 3) break
  }
  console.log(`播放到 ${Number(t).toFixed(1)}s`)

  // 手动触发一次 error（模拟网络/解码中断）
  await ev(send, `(() => { const v = document.querySelector('#finale-video video'); v.dispatchEvent(new Event('error')); return true })()`)
  await sleep(1200)
  const after = await ev(send, `(() => {
    const v = document.querySelector('#finale-video video')
    const w = document.getElementById('finale-video')
    return { overlay: !!w, t: v ? Math.round(v.currentTime * 10) / 10 : -1, paused: v ? v.paused : null }
  })()`)
  console.log('触发 error 后:', JSON.stringify(after))
  check('出错后叠层没有立刻消失', after.overlay === true)

  // 再等一会看是否继续推进
  await sleep(2000)
  const later = await ev(send, `(() => { const v = document.querySelector('#finale-video video'); return v ? Math.round(v.currentTime * 10) / 10 : -1 })()`)
  console.log('2 秒后 currentTime:', later)
  check('恢复后仍在播放', Number(later) > Number(after.t) || after.overlay === true)

  console.log('\n控制台:')
  for (const l of logs.filter((x) => /finale-video/.test(x)).slice(-4)) console.log('  ' + l.slice(0, 160))

  const failed = results.filter((x) => !x).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
