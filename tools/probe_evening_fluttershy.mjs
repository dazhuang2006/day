/**
 * 在傍晚小屋里走到柔柔旁边并推进对话，记录配音调用结果。
 * 用法：node tools\probe_evening_fluttershy.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9362
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-ef-'))
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

  console.log('挂载:', await ev(send, `(() => {
    const a = window.__audio
    window.__voiceLog = []
    if (!a.__origSayVoice) a.__origSayVoice = a.sayVoiceLine.bind(a)
    a.sayVoiceLine = (scene, who, text, vol) => {
      const r = a.__origSayVoice(scene, who, text, vol)
      window.__voiceLog.push({ who, text, r })
      return r
    }
    window.__state.eveningIntroSeen = true
    window.__state.received = []
    window.__state.talkedTo = []
    return 'ok'
  })()`))

  await ev(send, `window.__jump('EveningScene')`)
  await sleep(1500)

  // 瞬移到柔柔旁边（160,360），触发自动对话
  console.log('瞬移:', await ev(send, `(() => {
    const p = window.__game.scene.getScene('EveningScene').player
    p.spr.x = 160; p.spr.y = 360; p.busy = false; p.freezeMs = 0; p.lastAutoInteract = 0
    return [Math.round(p.spr.x), Math.round(p.spr.y)]
  })()`))

  const box = await ev(send, `(() => { const c = document.querySelector('#game-wrap canvas'); const r = c.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.8 } })()`)

  // 点 8 次推进对话
  for (let i = 0; i < 8; i++) {
    await sleep(1400)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 })
  }

  const log = await ev(send, 'window.__voiceLog || []')
  console.log('\n配音调用记录:')
  if (!Array.isArray(log) || !log.length) console.log('  （没有任何调用）')
  else for (const e of log) console.log(`  [${e.who}] ${String(e.r).padEnd(6)} ${String(e.text).slice(0, 30)}`)

  const st = await ev(send, `(() => { const a = window.__audio; return {
    muted: a.prefs.muted, volume: a.prefs.volume,
    smMute: (() => { try { return window.__game.sound.mute } catch (e) { return null } })(),
    voiceBus: (() => { try { return Math.round(a.voiceBus.gain.value * 1000) / 1000 } catch (e) { return null } })(),
    ctx: a.ctx ? a.ctx.state : 'none' } })()`)
  console.log('\n音频状态:', JSON.stringify(st))

  // 逐个检查：有没有映射 / 有没有文件 / 缓存里在不在
  const diag = await ev(send, `(() => {
    const a = window.__audio
    const texts = ['花……我帮你养了一天，它们现在最有精神。', '小动物们也想来看，我让它们在外面等着。']
    const cache = window.__game.cache.audio
    return texts.map((t) => {
      const id = a.voiceLines && a.voiceLines.fluttershy ? a.voiceLines.fluttershy[t] : undefined
      const key = id ? 'fluttershy/' + id : null
      return {
        text: t.slice(0, 12),
        id: id || null,
        has: a.hasVoiceClip('fluttershy', t),
        inCache: key ? cache.exists(key) : null,
        indexHas: id ? (a.voiceIndex.fluttershy ? a.voiceIndex.fluttershy.has(id) : null) : null,
        loading: key ? Array.from(a.voiceLoading || []).includes(key) : null
      }
    })
  })()`)
  console.log('逐句诊断:', JSON.stringify(diag, null, 1))
  if (logs.length) { console.log('\n控制台:'); for (const l of logs.slice(-4)) console.log('  ' + l.slice(0, 120)) }
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
