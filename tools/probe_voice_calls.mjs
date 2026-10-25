/**
 * 抓某个场景里"配音调用"的真实情况：记录 sayVoiceLine 的每次调用与返回。
 * 用法：node tools\probe_voice_calls.mjs "<URL>" <场景名> [等待秒数]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const SCENE = process.argv[3] || 'GardenScene'
const WAIT = Number(process.argv[4] || 10)
const PORT = 9361
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-vc-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp
  for (let i = 0; i < 40; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }

  // 包一层 sayVoiceLine，记录 谁/说了什么/返回什么
  console.log('挂载:', await ev(send, `(() => {
    const a = window.__audio
    window.__voiceLog = []
    if (!a.__origSayVoice) a.__origSayVoice = a.sayVoiceLine.bind(a)
    a.sayVoiceLine = (scene, who, text) => {
      const r = a.__origSayVoice(scene, who, text)
      window.__voiceLog.push({ who, text, r })
      return r
    }
    return 'ok'
  })()`))

  await ev(send, `window.__jump(${JSON.stringify(SCENE)})`)

  // 定期点击画布推进对话（对话需要点击才继续）
  const box = await ev(send, `(() => { const c = document.querySelector('#game-wrap canvas'); const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 } })()`)
  const clicks = Math.max(1, Math.round(WAIT / 1.5))
  for (let i = 0; i < clicks; i++) {
    await sleep(1500)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 })
  }

  const log = await ev(send, 'window.__voiceLog || []')
  console.log(`\n${SCENE} 里 ${WAIT} 秒内的配音调用：`)
  if (!Array.isArray(log) || !log.length) console.log('  （没有任何调用）')
  else for (const e of log) console.log(`  [${e.who}] ${String(e.r).padEnd(8)} ${String(e.text).slice(0, 28)}`)

  // 当前是否有语音在响
  const audioState = await ev(send, `(() => {
    const a = window.__audio
    const g = window.__game
    return {
      voiceSound: !!a.voiceSound,
      phaser: (() => { try { return g.sound.getAllPlaying().map((s) => s.key) } catch (e) { return ['err'] } })(),
      ctx: a.ctx ? a.ctx.state : 'none',
      bus: (() => { try { return Math.round(a.voiceBus.gain.value * 1000) / 1000 } catch (e) { return null } })()
    }
  })()`)
  console.log('\n音频状态:', JSON.stringify(audioState))
  if (logs.length) {
    console.log('\n控制台:')
    for (const l of logs.slice(-6)) console.log('  ' + l.slice(0, 140))
  }
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
