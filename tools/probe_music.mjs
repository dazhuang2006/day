/**
 * 复现"播放结尾视频时小屋背景音乐还在响"。
 * 流程尽量贴近真实：先在小屋放音乐，再进终章播视频，播放期间读音频状态。
 *
 * 用法：node tools\probe_music.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9358
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

const STATE = `(() => {
  const a = window.__audio
  const g = window.__game
  let playing = []
  try { playing = g.sound.getAllPlaying().map((s) => ({ key: s.key, vol: s.volume, mute: s.mute, gain: (s.gainNode ? Math.round(s.gainNode.gain.value*1000)/1000 : null), loop: s.loop })) } catch (e) { playing = ['err'] }
  const bus = (() => { try { return Math.round(a.musicBus.gain.value * 1000) / 1000 } catch (e) { return null } })()
  return {
    silent: a.isVideoSilent,
    smMute: (() => { try { return g.sound.mute } catch (e) { return null } })(),
    music: a.currentMusicName,
    playingMusic: !!a.playingMusic,
    musicBusGain: bus,
    phaserPlaying: playing,
    overlay: !!document.getElementById('finale-video')
  }
})()`

const profile = mkdtempSync(join(tmpdir(), 'dsh-mus-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send, logs } = cdp
  for (let i = 0; i < 40; i++) {
    if ((await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')) === true) break
    await sleep(500)
  }

  // 1) 进小屋（第四章），音乐会开始
  await ev(send, `window.__jump('EveningScene')`)
  await sleep(2500)
  console.log('小屋:', JSON.stringify(await ev(send, STATE)))

  // 2) 进终章并播视频（模拟真实：音乐已在放）
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1200)
  console.log('终章:', JSON.stringify(await ev(send, STATE)))

  await ev(send, `window.__state.finaleVideoSeen = false`)
  await ev(send, `window.__finale()`)
  for (const ms of [800, 1500, 3000]) {
    await sleep(ms)
    console.log(`视频中 +${ms}ms:`, JSON.stringify(await ev(send, STATE)))
  }

  // 跳过视频 -> onEnd -> 音乐应该回来
  await ev(send, `document.querySelector('#finale-video button')?.click()`)
  await sleep(1500)
  console.log('结束后 +1.5s:', JSON.stringify(await ev(send, STATE)))
  await sleep(1500)
  console.log('结束后 +3.0s:', JSON.stringify(await ev(send, STATE)))

  console.log('\n控制台（最后 8 条）:')
  for (const l of logs.slice(-8)) console.log('  ' + l.slice(0, 150))
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
