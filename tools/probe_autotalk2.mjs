/**
 * 验证自动交互的"按目标"规则：
 *   1. 站在同一个目标旁不动 -> 只触发一次
 *   2. 换到另一个目标（不用先走远）-> 立刻能触发
 *
 * 做法：把 talkTo 换成纯计数的桩（不弹对话），这样不受"对话要点一下才继续"的干扰。
 *
 * 用法：node tools\probe_autotalk2.mjs "<URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9360
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

const profile = mkdtempSync(join(tmpdir(), 'dsh-at2-'))
const proc = spawn(EDGE, ['--headless=new', '--no-proxy-server', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

/** 把玩家瞬移到某个坐标并把 talkTo 换成计数器 */
async function setup(send) {
  return ev(send, `(() => {
    const s = window.__game.scene.getScene('EveningScene')
    if (!s || !s.player) return 'no scene'
    window.__log = []
    s.talkTo = (k) => { window.__log.push(k); return Promise.resolve() }
    // 关掉开场白、清空已收礼物，让交互点都可用
    window.__state.eveningIntroSeen = true
    window.__state.received = []
    s.player.busy = false
    s.player.freezeMs = 0
    return 'ok'
  })()`)
}
async function teleport(send, x, y) {
  return ev(send, `(() => {
    const p = window.__game.scene.getScene('EveningScene').player
    p.spr.x = ${x}; p.spr.y = ${y}
    p.busy = false; p.freezeMs = 0
    p.lastAutoInteract = 0
    return [Math.round(p.spr.x), Math.round(p.spr.y)]
  })()`)
}

try {
  cdp = await connect()
  const { send } = cdp
  for (let i = 0; i < 40; i++) {
    if ((await ev(send, 'typeof window.__game === "object" && !!window.__game && window.__game.scene.getScenes(true).length > 0')) === true) break
    await sleep(500)
  }

  await ev(send, `(() => { window.__state.eveningIntroSeen = true; window.__state.received = []; window.__state.talkedTo = []; return true })()`)
  await ev(send, `window.__jump('EveningScene')`)
  await sleep(2000)

  console.log('挂载:', await setup(send))

  // 1) 柔柔（160,360）
  await teleport(send, 160, 360)
  await sleep(2000)
  const afterA = await ev(send, 'window.__log.slice()')
  console.log('站在柔柔旁 2 秒:', JSON.stringify(afterA))
  check('靠近柔柔触发一次', afterA.length === 1 && afterA[0] === 'fluttershy', JSON.stringify(afterA))

  await sleep(2500)
  const stillA = await ev(send, 'window.__log.slice()')
  console.log('再等 2.5 秒:', JSON.stringify(stillA))
  check('站着不动不重复触发', stillA.length === 1, JSON.stringify(stillA))

  // 2) 直接换到紫悦（620,170），中间不经过"空场"
  await teleport(send, 620, 170)
  await sleep(2000)
  const afterB = await ev(send, 'window.__log.slice()')
  console.log('换到紫悦旁 2 秒:', JSON.stringify(afterB))
  check('换目标立刻能触发（不必先走远）', afterB.length === 2 && afterB[1] === 'twilight', JSON.stringify(afterB))

  // 3) 再回到柔柔，应当能再次触发（因为离开了她的范围）
  await teleport(send, 160, 360)
  await sleep(2000)
  const afterC = await ev(send, 'window.__log.slice()')
  console.log('回到柔柔旁 2 秒:', JSON.stringify(afterC))
  check('回到原目标可以再次触发', afterC.length === 3 && afterC[2] === 'fluttershy', JSON.stringify(afterC))

  // 4) 用户报的场景：收到花之后，站到"放花"的光圈里（180,250）应当触发摆放
  await ev(send, `(() => {
    const s = window.__game.scene.getScene('EveningScene')
    s.place = () => { window.__log.push('place'); return Promise.resolve() }
    // 模拟"已经收了柔柔的花"：收到礼物时游戏会 reveal 对应摆件，
    // canPlace 要求 revealed=true，否则光圈是灰的（这一步不能用桩跳过）
    s.slots[1]?.reveal()
    window.__state.received = ['fluttershy']
    return true
  })()`)
  await teleport(send, 180, 250)
  await sleep(2000)
  const slotDbg = await ev(send, `(() => {
    const s = window.__game.scene.getScene('EveningScene')
    const list = s.targets().map((t, i) => ({ i, x: t.x, y: t.y, on: t.enabled ? t.enabled() : null }))
    const p = s.player
    return { list, player: [Math.round(p.spr.x), Math.round(p.spr.y)], last: p.lastAutoTarget ? [p.lastAutoTarget.x, p.lastAutoTarget.y] : null }
  })()`)
  console.log('  目标状态:', JSON.stringify(slotDbg))
  const afterD = await ev(send, 'window.__log.slice()')
  console.log('站到"放花"光圈里 2 秒:', JSON.stringify(afterD))
  check('在光圈里能触发摆放（不用先走远）', afterD[afterD.length - 1] === 'place', JSON.stringify(afterD))

  const failed = results.filter((r) => !r).length
  console.log(failed ? `\n有 ${failed} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
