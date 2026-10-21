/**
 * 全屏布局诊断：进入全屏前后各截一张图，并打印画布与容器的实际尺寸。
 *
 * 上一版验证只看了 isFullscreen 标志，没看布局，所以漏掉了"全屏后画面没铺满"这类问题。
 * 这里用 Page.captureScreenshot 拿到真实画面，并把 DOM 尺寸打出来。
 *
 * 用法：node tools\diag_fullscreen.mjs "<页面URL>" [宽x高]
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const SIZE = (process.argv[3] || '1280x800').split('x').map(Number)
const DEBUG_PORT = 9337
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const OUT = 'D:\\python\\xiangmu\\youxi1\\refs\\fs_diag'

if (!URL_TO_OPEN) {
  console.error('需要页面 URL')
  process.exit(2)
}

async function connect() {
  let targets = null
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      targets = await res.json()
      if (targets.some((t) => t.type === 'page')) break
    } catch { /* 等 */ }
    await sleep(300)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP: 找不到 page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('连接失败')) })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id
      pending.set(mid, { resolve, reject })
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  await send('Runtime.enable')
  await send('Page.enable')
  return { send, close: () => ws.close() }
}

async function evaluate(send, expression, userGesture = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '抛异常')
  return r.result.value
}

const LAYOUT = `(() => {
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) }
  }
  const c = document.querySelector('#game-wrap canvas')
  return {
    win: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    app: box(document.getElementById('app')),
    wrap: box(document.getElementById('game-wrap')),
    canvas: box(c),
    // canvas 的"内部分辨率"（游戏逻辑尺寸）与实际显示尺寸可能不同
    canvasInternal: c ? [c.width, c.height] : null,
    canvasCss: c ? [c.style.width, c.style.height] : null,
    isFs: window.__game ? window.__game.scale.isFullscreen : null,
    fullscreenEl: document.fullscreenElement
      ? (document.fullscreenElement.id || document.fullscreenElement.tagName)
      : null,
    // 全屏元素完整信息 + 它的实际盒尺寸，用来确认 CSS 选择器该写哪个元素
    fsDetail: (() => {
      const el = document.fullscreenElement
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName, id: el.id || '', cls: el.className || '',
        w: Math.round(r.width), h: Math.round(r.height),
        matchesApp: el.matches('#app'),
        matchesWrap: el.matches('#game-wrap'),
      }
    })(),
    // 补两个关键 ID：全屏元素到底是谁，直接决定 CSS 选择器该写哪个
    parentId: window.__game && window.__game.scale.parent ? (window.__game.scale.parent.id || '(no id)') : null,
    wrapStyle: (() => { const w = document.getElementById('game-wrap')
      return w ? w.getAttribute('style') : null })(),
    bodyScroll: [document.body.scrollWidth, document.body.scrollHeight]
  }
})()`

async function shot(send, name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(OUT, name), Buffer.from(r.data, 'base64'))
  return name
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-fsdiag-'))
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--window-size=${SIZE[0]},${SIZE[1]}`,
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN,
  ], { stdio: 'ignore' })

  let cdp
  try {
    cdp = await connect()
    const { send } = cdp
    for (let i = 0; i < 30; i++) {
      if (await evaluate(send, 'typeof window.__game === "object" && !!window.__game')) break
      await sleep(400)
    }
    await send('Emulation.setDeviceMetricsOverride', {
      width: SIZE[0], height: SIZE[1], deviceScaleFactor: 1, mobile: false,
    })
    await sleep(600)
    await shot(send, '1_before.png')
    console.log('=== 全屏前 ===')
    console.log(JSON.stringify(await evaluate(send, LAYOUT), null, 1))

    // 点按钮进全屏
    const btn = await evaluate(send, `(() => { const b = document.getElementById('fs-btn');
      if (!b) return null; const r = b.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 } })()`)
    if (btn) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
    }
    await sleep(1500)
    await shot(send, '2_fullscreen.png')
    console.log('\n=== 全屏后 ===')
    console.log(JSON.stringify(await evaluate(send, LAYOUT), null, 1))

    // 再模拟一个非 16:9 的"全屏"窗口尺寸，看看会不会变形/留白
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
    })
    await sleep(900)
    await shot(send, '3_fullscreen_16x9.png')
    console.log('\n=== 全屏 + 16:9 窗口 ===')
    console.log(JSON.stringify(await evaluate(send, LAYOUT), null, 1))

    console.log(`\n截图已写入 ${OUT}`)
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    proc.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error('DIAG ERROR:', e.message); process.exitCode = 2 })
