/**
 * 检查指定角色的若干句配音是否真的能播放（__say 返回 clip）。
 * 用法：node tools\check_voice.mjs "<URL>" rarity
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const SPEAKER = process.argv[3] || 'rarity'
const PORT = 9357
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-cv-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
try {
  cdp = await connect()
  const { send } = cdp
  for (let i = 0; i < 40; i++) {
    const ready = await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')
    if (ready === true) break
    await sleep(500)
  }
  // 逐句测试：__say 返回 clip 表示真的有音频并已在播放
  const CASES = [
    '亲爱的，你终于来了。',
    '包装这种事，当然要交给我。',
    '这个颜色不行……再换一个。',
    '嗯……这个，才适合。',
    '有些惊喜，如果提前知道了，就不能叫惊喜了。',
    '嘘——我懂。交给我吧。',
    '彩带我挑了很久。朱红配粉色，才对得上这间屋子。',
    '记住，左边高一点，右边低一点。这叫层次。',
    '这里，还需要一点装饰。',
    '把那串彩灯往左移一点点……完美。',
    '（压低声音）彩带左边高了半指。罢了……来不及了，就这样。'
  ]
  let ok = 0
  for (const t of CASES) {
    let r = await ev(send, `window.__say(${JSON.stringify(SPEAKER)}, ${JSON.stringify(t)})`)
    // 首次播放要先 fetch 音频，会先返回 loading，轮询到定局为止
    for (let i = 0; i < 12 && String(r) === 'loading'; i++) {
      await sleep(250)
      r = await ev(send, `window.__say(${JSON.stringify(SPEAKER)}, ${JSON.stringify(t)})`)
    }
    const good = String(r).includes('clip')
    if (good) ok++
    console.log(`  ${good ? '✔' : '✘'} ${String(r).padEnd(24)} ${t}`)
  }
  console.log(`\n${ok}/${CASES.length} 句能播`)
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
