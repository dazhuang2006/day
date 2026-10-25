/**
 * 用 Chrome DevTools 协议驱动无头 Edge 跑一次页面，验证配音两条分支。
 *
 * 为什么需要它：配音的加载/播放分支（hasVoiceClip、异步解码、缺文件时的静音）
 * 只有在真实浏览器里才能验证，光靠类型检查证明不了它不抛异常。这里直接在页面里调 window.__say 并读返回值。
 *
 * 用法：node tools/verify-browser.mjs <页面URL>
 * 依赖：只用 Node 内置模块（Node 22+ 自带 WebSocket）。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2] || 'http://127.0.0.1:5199/'
const DEBUG_PORT = 9333
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 连上 CDP，返回一个 send 函数和一个日志收集器 */
async function connect() {
  // 等调试端口起来
  let targets = null
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)
      targets = await res.json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {
      /* 还没起来 */
    }
    await sleep(300)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) throw new Error('CDP: 找不到 page target')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP: WebSocket 连接失败'))
  })

  let id = 0
  const pending = new Map()
  const consoleLines = []
  const exceptions = []

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      consoleLines.push(
        (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
      )
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      exceptions.push(msg.params.exceptionDetails?.exception?.description || 'unknown exception')
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
  return { send, consoleLines, exceptions, close: () => ws.close() }
}

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || 'evaluate 抛异常')
  }
  return r.result.value
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-cdp-'))
  const proc = spawn(
    EDGE,
    [
      '--headless=new', '--no-proxy-server',
      '--disable-gpu',
      '--no-first-run',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      URL_TO_OPEN
    ],
    { stdio: 'ignore' }
  )

  let cdp
  try {
    cdp = await connect()
    const { send, consoleLines, exceptions } = cdp

    // 等游戏初始化完成（main.ts 里会挂 __game）
    let ready = false
    for (let i = 0; i < 40; i++) {
      ready = await evaluate(send, 'typeof window.__game === "object" && !!window.__game')
      if (ready) break
      await sleep(500)
    }
    if (!ready) throw new Error('页面里等不到 __game，游戏没起来')

    // 等场景真正激活：部署环境下 BootScene 要处理若干失败请求 + 生成纹理，
    // 大约 5 秒才进 TitleScene。只等 __game 存在会太早，导致 __say 拿到空场景。
    let sceneReady = false
    for (let i = 0; i < 40; i++) {
      sceneReady = await evaluate(send, 'window.__game.scene.getScenes(true).length > 0')
      if (sceneReady) break
      await sleep(500)
    }
    if (!sceneReady) throw new Error('场景迟迟没有激活（BootScene 可能卡住了）')
    console.log('游戏已启动')

    // 等配音索引加载（main.ts 启动时就请求了）
    await sleep(1500)
    const idxInfo = await evaluate(
      send,
      `(() => { const a = window.__audio; return a ? Object.keys(a.voiceIndex || {}).length : -1 })()`
    )
    console.log('索引里的角色数:', idxInfo)

    // 有真人配音的句子：第一次调用触发异步解码 -> 'loading'，
    // 等解码完再调应当返回 'clip'。这条同时验证加载-回调链路。
    // 注意：星莓的配音已按需求移除，所以这里改用珍奇/紫悦的句子。
    const pollSay = async (speaker, text) => {
      let r = await evaluate(send, `window.__say(${JSON.stringify(speaker)}, ${JSON.stringify(text)})`)
      const first = r
      for (let i = 0; i < 20 && r === 'loading'; i++) {
        await sleep(400)
        r = await evaluate(send, `window.__say(${JSON.stringify(speaker)}, ${JSON.stringify(text)})`)
      }
      return { first, final: r }
    }

    const line1 = await pollSay('rarity', '亲爱的，你终于来了。')
    console.log(`有真人配音的句子 -> 首次=${line1.first} 最终=${line1.final}`)

    const line2 = await pollSay('twilight', '星莓，你来了。')
    console.log(`索引里第二句 -> 首次=${line2.first} 最终=${line2.final}`)

    // 星莓配音已移除：她的台词必须是 missing（只有文字、没有声音）
    const starberry = await pollSay('starberry', '我们回小屋吧。')
    console.log(`星莓（已移除配音）-> 首次=${starberry.first} 最终=${starberry.final}`)

    const withClip = line1.final
    const secondLine = line2.final
    const starberryState = starberry.final

    // 没有这句配音时：必须是 missing，且不能发出任何合成声音
    const noClip = await evaluate(send, `window.__say('twilight', '这句话肯定没有配音。')`)
    console.log('无配音台词 ->', noClip)

    // 空串边界
    const empty = await evaluate(send, `window.__say('starberry', '')`)
    console.log('空文本 ->', empty)

    // 关键回归：确认合成朗读的入口已经彻底移除
    const hasSayText = await evaluate(send, `typeof window.__audio.sayText === 'function'`)
    console.log('sayText 是否仍存在（应为 false）->', hasSayText)

    await sleep(800)
    const audioState = await evaluate(
      send,
      `(() => { const c = window.__audio; return { muted: !!c.prefs.muted, ctx: c.ctx ? c.ctx.state : 'none' } })()`
    )
    console.log('音频上下文:', JSON.stringify(audioState))

    console.log('--- 页面 console 摘要 ---')
    for (const l of consoleLines.filter((l) => /配音|Error|error/.test(l)).slice(0, 12)) {
      console.log('  ' + l.slice(0, 160))
    }
    const realExceptions = exceptions.filter((e) => !/decode audio data/i.test(e))
    console.log('--- 未捕获异常（已排除音频解码失败，那是缺音乐文件的既有噪音）---')
    console.log(realExceptions.length ? realExceptions.map((e) => '  ' + e.split('\n')[0]).join('\n') : '  无')

    const pass =
      withClip === 'clip' &&
      secondLine === 'clip' &&
      starberryState === 'missing' &&
      noClip === 'missing' &&
      (empty === 'missing' || empty === 'clip') &&
      hasSayText === false &&
      realExceptions.length === 0
    console.log(pass ? 'VERIFY PASS' : 'VERIFY FAIL')
    process.exitCode = pass ? 0 : 1
  } finally {
    try {
      cdp?.close()
    } catch {
      /* ignore */
    }
    proc.kill()
  }
}

main().catch((e) => {
  console.error('VERIFY ERROR:', e.message)
  process.exitCode = 2
})
