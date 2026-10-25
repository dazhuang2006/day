/**
 * 验证"站在朋友旁边不会反复触发对话"。
 *
 * 做法：进小屋 → 把星莓瞬移到某位朋友旁边（不移动）→
 * 统计 talkTo 被调用的次数。修好后应该只有 1 次；
 * 修复前，冷却(900ms)一到会不断重复。
 *
 * 用法：node tools\probe_autotalk.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9359
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-at-'))
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
    if ((await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')) === true) break
    await sleep(500)
  }

  // 跳过开场白（否则 busy 一直为 true，自动交互永远不会触发），
  // 同时清空"已收到礼物"，让角色交互点可用
  await ev(send, `(() => {
    window.__state.eveningIntroSeen = true
    window.__state.received = []
    window.__state.talkedTo = []
    return true
  })()`)
  await ev(send, `window.__jump('EveningScene')`)
  // 等开场白结束（player.busy 变回 false）
  for (let i = 0; i < 30; i++) {
    const busy = await ev(send, `(() => { const s = window.__game.scene.getScene('EveningScene'); return s && s.player ? s.player.busy : true })()`)
    if (busy === false) break
    await sleep(500)
  }

  // 计数器：包装 talkTo
  const hooked = await ev(send, `(() => {
    const s = window.__game.scene.getScene('EveningScene')
    if (!s || !s.player) return 'no scene'
    window.__talkCount = 0
    const p = s.player
    p.__origSay = p.__origSay || p.say.bind(p)
    p.say = (...a) => { window.__talkCount++; return p.__origSay(...a) }
    // 瞬移到"柔柔"旁边（160,360），不移动、不按键
    p.spr.x = 160
    p.spr.y = 360
    p.lastAutoInteract = 0
    return 'ok'
  })()`)
  console.log('挂载:', hooked)

  // 观察 6 秒：修复后应只在最开始触发 1 次
  const dbg = await ev(
    send,
    `(() => { const s = window.__game.scene.getScene('EveningScene'); const p = s.player
       return { busy: p.busy, freeze: p.freezeMs, armed: p.autoArmed, near: p.nearIndex,
                x: Math.round(p.spr.x), y: Math.round(p.spr.y), targets: p.targets.length,
                active: s.scene.isActive() } })()`
  )
  console.log('瞬移后状态:', JSON.stringify(dbg))

  const samples = []
  for (let i = 0; i < 6; i++) {
    await sleep(1000)
    samples.push(await ev(send, 'window.__talkCount'))
  }
  console.log('每秒累计触发次数:', samples.join(' → '))

  const final = samples[samples.length - 1]
  check('站着不动只触发 1 次对话', final === 1, `实际 ${final} 次`)
  check('没有出现反复触发', new Set(samples.slice(1)).size === 1, `后 5 秒计数 ${samples.slice(1).join(',')}`)

  const failed = results.filter((r) => !r).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
