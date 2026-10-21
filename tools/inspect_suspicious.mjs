/**
 * 追查两处可疑点：
 *   1. 源码里有 1 处 text: `...`（模板字符串），正则提取不到——它是不是一条台词？
 *   2. who:'...' 出现 117 次，但成对提取只有 116 条——多出来的那次是什么？
 *
 * 用法：node tools\inspect_suspicious.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

for (const f of walk(SRC)) {
  const code = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT + '\\', '').replace(ROOT + '/', '')

  code.split('\n').forEach((line, i) => {
    if (/text:\s*`/.test(line)) {
      console.log(`\n[模板字符串] ${rel}:${i + 1}`)
      console.log(`   ${line.trim().slice(0, 140)}`)
      // 往后看几行，判断是不是跨行
      for (let k = 1; k <= 4; k++) {
        const next = code.split('\n')[i + k]
        if (next && !/^\s*\}/.test(next)) console.log(`   +${k}: ${next.trim().slice(0, 140)}`)
      }
    }
    // 不带配对的 who（同一行没有 text:）
    if (/who:\s*'/.test(line) && !/text:\s*['"`]/.test(line)) {
      console.log(`\n[单独 who] ${rel}:${i + 1}`)
      console.log(`   ${line.trim().slice(0, 140)}`)
      for (let k = 1; k <= 3; k++) {
        const next = code.split('\n')[i + k]
        if (next) console.log(`   +${k}: ${next.trim().slice(0, 140)}`)
      }
    }
  })
}
