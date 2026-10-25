/**
 * 手机 + 慢网 环境下测配音：模拟"台词出来时音频还在下载"。
 * 用法：node tools\probe_voice_slow.mjs "<URL>"
 * 输出：首次调用是否 false、之后是否自动补播成功。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9365
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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
  return { send, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const TEXT = '亲爱的，你终于来了。'
const profile = mkdtempSync(join(tmpdir(), 'dsh-vs-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send } = cdp

  // 手机 + 慢网（约 700 kbps，接近移动网络）
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 150, downloadThroughput: 700 * 1024 / 8, uploadThroughput: 400 * 1024 / 8
  })

  for (let i = 0; i < 60; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }
  await sleep(1000)

  // 触摸解锁
  const box = await ev(send, `(() => { const c = document.querySelector('#game-wrap canvas'); const r = c.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.62) } })()`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(800)
  console.log('解锁后:', JSON.stringify(await ev(send, `(() => { const a = window.__audio
    return { ctx: a.ctx ? a.ctx.state : 'none', locked: window.__game.sound.locked } })()`)))

  // 清掉缓存，强制走"还在下载"的路径
  await ev(send, `(() => { const a = window.__audio
    const id = a.voiceLines.rarity[${JSON.stringify(TEXT)}]
    window.__game.cache.audio.remove('rarity/' + id)
    return true })()`)

  const first = await ev(send, `window.__audio.sayVoiceLine(window.__game.scene.getScenes(true)[0], 'rarity', ${JSON.stringify(TEXT)})`)
  console.log('首次调用:', first)

  let played = false
  let ms = 0
  for (let i = 0; i < 30; i++) {
    await sleep(300); ms += 300
    played = await ev(send, `!!window.__audio.voiceSound`)
    if (played) break
  }
  console.log(played ? `补播成功（约 ${ms}ms 后开始播）` : '未补播——这句会一直没声音')
  console.log('结论:', played ? 'PASS 慢网下配音仍会播' : 'FAIL 慢网下配音丢失')
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
