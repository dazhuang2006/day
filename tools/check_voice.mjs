/**
 * 逐句测试某个角色的配音能否真正播放（读本地 voice_manifest.json 取台词）。
 * 用法：node tools\check_voice.mjs "<URL>" [角色英文名]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const URL_TO_OPEN = process.argv[2]
const SPEAKER = process.argv[3] || 'rarity'
const PORT = 9357
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!URL_TO_OPEN) { console.error('需要 URL'); process.exit(2) }

const manifest = JSON.parse(readFileSync(join(ROOT, 'voice_manifest.json'), 'utf8'))
const CASES = manifest.lines.filter((l) => l.speaker === SPEAKER).map((l) => l.text)
if (!CASES.length) { console.error('没有这个角色的台词:', SPEAKER); process.exit(2) }

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
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || 'x')
    if (m.method === 'Network.responseReceived') {
      const r = m.params.response
      if (r.url.includes('/assets/audio/voice/')) errors.push(`NET ${r.status} ${r.url.split('/voice/')[1]}`)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  return { send, errors, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-cv-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, errors } = cdp
  for (let i = 0; i < 40; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }

  let ok = 0
  const fails = []
  for (const t of CASES) {
    let r = await ev(send, `window.__say(${JSON.stringify(SPEAKER)}, ${JSON.stringify(t)})`)
    for (let i = 0; i < 12 && String(r) === 'loading'; i++) {
      await sleep(250)
      r = await ev(send, `window.__say(${JSON.stringify(SPEAKER)}, ${JSON.stringify(t)})`)
    }
    const good = String(r).includes('clip')
    if (good) ok++
    else fails.push({ text: t, result: r })
    console.log(`  ${good ? '✔' : '✘'} ${String(r).padEnd(10)} ${t}`)
  }
  console.log(`\n${ok}/${CASES.length} 句能播`)
  if (fails.length) {
    console.log('\n失败的句子:')
    for (const f of fails) console.log(`  - ${f.text}  => ${f.result}`)
  }
  const netErrs = errors.filter((e) => String(e).startsWith('NET') && !String(e).includes(' 200 '))
  if (netErrs.length) {
    console.log('\n配音请求异常:')
    for (const e of netErrs.slice(0, 10)) console.log('  ' + e)
  }
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
