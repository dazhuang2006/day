/**
 * 验证结尾流程（干净版）：
 *   A) 视频播放时游戏音频彻底静音
 *   B) 信读完后先出现按钮；不点按钮视频不播；点按钮后视频才出现
 *
 * 关键教训：画布是 960x560 等比缩放后**居中**显示的，
 * window 坐标 ≠ 画布坐标。必须按 canvas.getBoundingClientRect() 换算，
 * 否则点击落在画布外，表现为"点了没反应"（我在这上面白试了两轮）。
 *
 * 用法：node tools\verify_finale_flow2.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const PORT = 9344
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
if (!URL_TO_OPEN) { console.error('需要页面 URL'); process.exit(2) }

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
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id; pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await send('Runtime.enable'); await send('Page.enable')
  return { send, errors, close: () => ws.close() }
}

async function ev(send, expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || 'exception' }
  return r.result.value
}

async function clickAt(send, x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}

const LABELS = `(() => {
  const s = window.__game.scene.getScene('BirthdayScene')
  if (!s) return { noScene: true }
  const texts = s.children.list.filter((c) => c.type === 'Text')
  const strs = texts.map((c) => String(c.text ?? ''))
  const btn = texts.find((c) => String(c.text ?? '').includes('把回忆拼好'))
  return {
    overlay: !!document.getElementById('finale-video'),
    hint: strs.find((t) => t.includes('点击')) || null,
    button: btn ? String(btn.text) : null,
    buttonGameXY: btn ? [Math.round(btn.x), Math.round(btn.y)] : null,
    probe: window.__letterBtnProbe || null
  }
})()`

const profile = mkdtempSync(join(tmpdir(), 'dsh-ff2-'))
const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN], { stdio: 'ignore' })

let cdp
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
}

try {
  cdp = await connect()
  const { send, errors } = cdp
  for (let i = 0; i < 30; i++) {
    if ((await ev(send, 'typeof window.__finale === "function"')) === true) break
    await sleep(400)
  }

  // 画布几何 + 坐标换算（必须在任何点击之前准备好）
  const box = await ev(send, `(() => {
    const c = document.querySelector('#game-wrap canvas')
    const r = c.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height,
             gw: window.__game.scale.width, gh: window.__game.scale.height }
  })()`)
  const toPage = (gx, gy) => [
    Math.round(box.x + (gx / box.gw) * box.w),
    Math.round(box.y + (gy / box.gh) * box.h)
  ]
  console.log(`画布 ${Math.round(box.w)}x${Math.round(box.h)} @ (${Math.round(box.x)},${Math.round(box.y)})  游戏 ${box.gw}x${box.gh}`)

  // ---------- A) 视频时音频静音 ----------
  console.log('\n[A] 视频播放时的音频')
  await ev(send, `window.__jump('BirthdayScene')`)
  await sleep(1400)
  await ev(send, `window.__state.finaleVideoSeen = false`)
  await ev(send, `window.__finale()`)
  await sleep(1600)
  const during = await ev(send, `({
    silent: window.__audio.isVideoSilent,
    playingMusic: !!window.__audio.playingMusic,
    phaserPlaying: (() => { try { return window.__game.sound.getAllPlaying().length } catch(e) { return 'n/a' } })(),
    overlay: !!document.getElementById('finale-video')
  })`)
  console.log('    播放中:', JSON.stringify(during))
  check('视频播放时标记为静音', during.silent === true)
  check('游戏音乐已停止', during.playingMusic === false)
  check('Phaser 无仍在播放的音源', during.phaserPlaying === 0, `getAllPlaying=${during.phaserPlaying}`)
  check('视频叠层存在', during.overlay === true)
  await ev(send, `document.querySelector('#finale-video button')?.click()`)
  await sleep(700)

  // ---------- B) 信件按钮 ----------
  console.log('\n[B] 信读完 → 按钮 → 视频')
  await ev(send, `(() => {
    window.__state.letterRead = false
    window.__state.finaleVideoSeen = false
    window.__state.phase = 'surprise'
    return true
  })()`)
  await ev(send, `window.__jump('BirthdayScene')`)

  let st = null
  for (let i = 0; i < 30; i++) {
    await sleep(500)
    st = await ev(send, LABELS)
    if (st && (st.hint || st.button)) break
  }
  check('信件面板/提示出现', !!(st && (st.hint || st.button)), st ? String(st.hint || '') : '')

  let sawButton = false
  let overlayEarly = false
  let rounds = 0
  for (let i = 0; i < 12; i++) {
    rounds++
    const [px, py] = toPage(box.gw / 2, box.gh * 0.9)
    await clickAt(send, px, py)
    await sleep(850)
    st = await ev(send, LABELS)
    if (st && st.overlay) overlayEarly = true
    if (st && st.button) { sawButton = true; break }
  }
  console.log(`    ${rounds} 轮后:`, JSON.stringify({ button: st && st.button, overlay: st && st.overlay, probe: st && st.probe }))
  check('出现按钮', sawButton === true, sawButton ? `「${st.button}」` : '未出现')
  check('按钮出现前视频未自动播放', overlayEarly === false)
  check('按钮文字正确', !!(st && st.button && st.button.includes('把回忆拼好')), st ? String(st.button) : '')

  await sleep(2000)
  check('等待 2 秒视频仍未自动播放', (await ev(send, `!!document.getElementById('finale-video')`)) === false)

  const gXY = (st && st.buttonGameXY) || [Math.round(box.gw / 2), box.gh - 118]
  const [bx, by] = toPage(gXY[0], gXY[1])
  console.log(`    点按钮 游戏(${gXY}) → 页面(${bx},${by})`)
  await clickAt(send, bx, by)
  await sleep(300)
  await sleep(1500)
  const after = await ev(send, `({
    overlay: !!document.getElementById('finale-video'),
    silent: window.__audio.isVideoSilent
  })`)
  console.log('    点按钮后:', JSON.stringify(after))
  check('点按钮后视频出现', after.overlay === true)
  check('点按钮后游戏音频静音', after.silent === true)

  const realErrors = errors.filter((e) => !/decode audio data/i.test(e))
  check('无未捕获 JS 异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

  const failed = results.filter((r) => !r.ok)
  console.log(failed.length ? `\n有 ${failed.length} 项未通过` : '\nVERIFY PASS')
  process.exitCode = failed.length ? 1 : 0
} finally {
  try { cdp?.close() } catch { /* ignore */ }
  proc.kill(); await sleep(300)
  try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
}
