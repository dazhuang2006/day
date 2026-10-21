/**
 * 验证全屏功能：按钮存在、点击后进入全屏、再点退出、无 JS 异常。
 *
 * 注意：浏览器要求全屏由用户手势触发。CDP 里用 Input.dispatchMouseEvent 模拟真实点击，
 * 比直接调 JS 更接近真实场景（headless 下部分环境仍可能拒绝，此时报告为"受限"而非失败）。
 *
 * 用法：node tools\verify_fullscreen.mjs "<页面URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const DEBUG_PORT = 9336
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    } catch { /* 还没起来 */ }
    await sleep(300)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP: 找不到 page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP: 连接失败'))
  })
  let id = 0
  const pending = new Map()
  const consoleLines = []
  const errors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push((msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description || 'unknown')
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
  return { send, consoleLines, errors, close: () => ws.close() }
}

async function evaluate(send, expression, userGesture = false) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || '抛异常')
  return r.result.value
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-fs-'))
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, URL_TO_OPEN,
  ], { stdio: 'ignore' })

  let cdp
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    cdp = await connect()
    const { send, errors } = cdp

    let ready = false
    for (let i = 0; i < 30; i++) {
      ready = await evaluate(send, 'typeof window.__game === "object" && !!window.__game')
      if (ready) break
      await sleep(400)
    }
    check('游戏已启动', ready === true)

    const btn = await evaluate(send, `(() => {
      const b = document.getElementById('fs-btn')
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { visible: r.width > 0 && r.height > 0, x: r.left + r.width/2, y: r.top + r.height/2,
               text: b.textContent, pressed: b.getAttribute('aria-pressed') }
    })()`)
    check('全屏按钮存在且可见', !!btn && btn.visible, btn ? `位置 ${Math.round(btn.x)},${Math.round(btn.y)} 图标 ${btn.text}` : '找不到')

    // 用 CDP 发真实鼠标点击（带用户手势）
    if (btn) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: btn.x, y: btn.y, button: 'left', clickCount: 1 })
      await sleep(1200)
    }

    const afterClick = await evaluate(send, `(() => ({
      isFs: window.__game.scale.isFullscreen,
      docFs: !!document.fullscreenElement,
      btn: (document.getElementById('fs-btn')||{}).textContent
    }))()`)
    const entered = afterClick.isFs || afterClick.docFs
    console.log(`    进入全屏: Phaser=${afterClick.isFs} 原生=${afterClick.docFs} 图标=${afterClick.btn}`)

    // headless 下可能被拒绝：那不算功能错误，但要如实报告
    const canvasSize = await evaluate(send, `(() => {
      const c = document.querySelector('#game-wrap canvas')
      return c ? { w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height),
                   inner: [window.innerWidth, window.innerHeight] } : null
    })()`)
    console.log(`    画布尺寸: ${canvasSize ? canvasSize.w + 'x' + canvasSize.h : 'n/a'}  窗口 ${canvasSize ? canvasSize.inner.join('x') : ''}`)

    if (entered) {
      check('点击按钮进入全屏', true)
      if (afterClick.btn !== '⤡') console.log(`    提示：进入全屏后图标是 ${afterClick.btn}（期望 ⤡）`)
      // 退出
      await evaluate(send, `window.__game.scale.stopFullscreen()`, true)
      await sleep(900)
      const exited = await evaluate(send, `window.__game.scale.isFullscreen === false && !document.fullscreenElement`)
      check('可以退出全屏', exited === true)
    } else {
      check('点击按钮进入全屏', false, 'headless 环境拒绝了全屏请求（真实浏览器里可用）；按钮与逻辑本身已就位')
    }

    const realErrors = errors.filter((e) => !/decode audio data/i.test(e))
    check('无未捕获 JS 异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

    const failed = results.filter((r) => !r.ok)
    console.log(failed.length ? `\n有 ${failed.length} 项未通过` : '\nVERIFY PASS')
    process.exitCode = failed.length ? 1 : 0
  } finally {
    try { cdp?.close() } catch { /* ignore */ }
    proc.kill()
    await sleep(300)
    try { rmSync(profile, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('VERIFY ERROR:', e.message)
  process.exitCode = 2
})
