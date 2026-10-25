/**
 * 验证"配音还在加载时排队补播"：先把缓存里的某句删掉，再调用 sayVoiceLine，
 * 应当先返回 false，随后（解码完成）自动补播。
 *
 * 用法：node tools\probe_voice_queue.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9363
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
  await send('Runtime.enable'); await send('Page.enable')
  return { send, close: () => ws.close() }
}
async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

const profile = mkdtempSync(join(tmpdir(), 'dsh-vq-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

try {
  cdp = await connect()
  const { send } = cdp
  for (let i = 0; i < 40; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }

  const TEXT = '花……我帮你养了一天，它们现在最有精神。'
  // 从缓存移除，模拟"还没加载好"
  const cleared = await ev(send, `(() => {
    const a = window.__audio
    const id = a.voiceLines.fluttershy[${JSON.stringify(TEXT)}]
    const key = 'fluttershy/' + id
    window.__game.cache.audio.remove(key)
    window.__k = key
    return { key, exists: window.__game.cache.audio.exists(key) }
  })()`)
  console.log('清掉缓存:', JSON.stringify(cleared))

  // 第一次调用：应当是 false（进入排队）
  const first = await ev(send, `window.__audio.sayVoiceLine(window.__game.scene.getScenes(true)[0], 'fluttershy', ${JSON.stringify(TEXT)})`)
  console.log('首次调用返回:', first)
  check('未就绪时首次调用返回 false（不静音崩塌，先排队）', first === false)

  // 等解码完成，检查是否补播了
  let playing = false
  for (let i = 0; i < 20; i++) {
    await sleep(400)
    playing = await ev(send, `(() => { const a = window.__audio; return !!a.voiceSound })()`)
    if (playing) break
  }
  check('加载完成后自动补播', playing === true, 'voiceSound ' + (playing ? '存在' : '仍为空'))

  // 换句时应当取消排队，不会串音
  const cancel = await ev(send, `(() => {
    const a = window.__audio
    a.stopVoice()
    return { pending: a.pendingVoice, sound: !!a.voiceSound }
  })()`)
  console.log('stopVoice 后:', JSON.stringify(cancel))
  check('stopVoice 能清掉排队', cancel.pending === null)

  const failed = results.filter((r) => !r).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
