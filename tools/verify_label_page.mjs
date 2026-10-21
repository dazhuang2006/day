/**
 * 用 CDP 验证标注页：音频能加载、JS 无异常、下拉框与快捷键逻辑正确。
 *
 * 用法：node tools/verify_label_page.mjs "<label.html 的 file:// URL>"
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL_TO_OPEN = process.argv[2]
const DEBUG_PORT = 9334
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!URL_TO_OPEN) {
  console.error('需要传入 label.html 的 file:// URL')
  process.exit(2)
}

async function connect() {
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

async function evaluate(send, expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'evaluate 抛异常')
  return r.result.value
}

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'dsh-label-'))
  const proc = spawn(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-first-run',
      '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
      URL_TO_OPEN,
    ],
    { stdio: 'ignore' }
  )

  let cdp
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`)
  }

  try {
    cdp = await connect()
    const { send, errors } = cdp

    let rows = 0
    for (let i = 0; i < 30; i++) {
      rows = await evaluate(send, `document.querySelectorAll('select').length`)
      if (rows > 0) break
      await sleep(400)
    }
    check('页面渲染出 60 个下拉框', rows === 60, `实际 ${rows}`)

    // 中文角色名与排除项是否都在选项里
    const optsText = await evaluate(
      send,
      `[...document.querySelector('select').options].map(o => o.textContent).join('|')`
    )
    const need = ['星莓', '紫悦', '柔柔', '苹果嘉儿', '云宝', '珍奇', '碧琪', '非主角（不要）', '唱歌/听不清']
    const missing = need.filter((n) => !optsText.includes(n))
    check('选项含全部中文角色名与排除项', missing.length === 0, missing.length ? '缺 ' + missing.join('、') : '')

    // 音频全部可加载
    const probe = await evaluate(
      send,
      `(async () => {
         const els = [...document.querySelectorAll('audio')];
         const out = [];
         for (const a of els) {
           a.preload = 'metadata';
           const r = await new Promise((resolve) => {
             let s = false;
             const done = (st, ex) => { if (!s) { s = true; resolve({ st, ex: ex || '' }); } };
             a.addEventListener('loadedmetadata', () => done('ok', a.duration.toFixed(2)));
             a.addEventListener('error', () => done('error', String(a.error && a.error.code)));
             setTimeout(() => done('timeout'), 6000);
             a.load();
           });
           out.push(r);
         }
         return out;
       })()`
    )
    const okCount = probe.filter((r) => r.st === 'ok').length
    check('60 个片段音频全部可加载', okCount === probe.length && probe.length === 60,
      `可加载 ${okCount}/${probe.length}`)

    // 下拉选择 + 颜色类
    const selectWorks = await evaluate(
      send,
      `(() => {
         const s = document.querySelectorAll('select')[0];
         s.value = 'starberry';
         s.dispatchEvent(new Event('change'));
         const row = s.closest('.row');
         return { val: s.value, cls: row.className, cnt: document.getElementById('cnt').textContent };
       })()`
    )
    check('下拉选角色生效并计数', selectWorks.val === 'starberry' && selectWorks.cls.includes('st-starberry'),
      JSON.stringify(selectWorks))

    // 排除项 other
    const otherWorks = await evaluate(
      send,
      `(() => {
         const s = document.querySelectorAll('select')[1];
         s.value = 'other';
         s.dispatchEvent(new Event('change'));
         return { cls: s.closest('.row').className };
       })()`
    )
    check('「非主角」选项可用', otherWorks.cls.includes('st-other'), otherWorks.cls)

    // 键盘快捷键：按 '3' 应把当前焦点行设为柔柔
    const keyWorks = await evaluate(
      send,
      `(() => {
         const s = document.querySelectorAll('select')[2];
         s.focus();
         document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }));
         return { val: s.value, focused: document.activeElement === document.querySelectorAll('select')[3] };
       })()`
    )
    check('数字键 3 = 柔柔，且自动跳到下一条',
      keyWorks.val === 'fluttershy' && keyWorks.focused, JSON.stringify(keyWorks))

    // 导出 JSON 结构与内容
    const exported = await evaluate(
      send,
      `(() => {
         exportJson();
         const t = document.getElementById('out').value;
         const arr = JSON.parse(t);
         return { n: arr.length, sample: arr[0], keys: Object.keys(arr[0]).slice(0, 6) };
       })()`
    )
    check('导出 JSON 可解析且含 speaker 字段',
      exported.n >= 2 && typeof exported.sample.speaker === 'string',
      `导出 ${exported.n} 条，首条 speaker=${exported.sample && exported.sample.speaker}`)

    const realErrors = errors.filter((e) => !/decode audio data/i.test(e))
    check('无未捕获 JS 异常', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))

    const failed = results.filter((r) => !r.ok)
    console.log(failed.length ? `\nVERIFY FAIL（${failed.length} 项）` : '\nVERIFY PASS')
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
