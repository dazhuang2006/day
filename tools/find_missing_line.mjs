/**
 * 逐行找出"源码里有 who+text、但清单里没有"的那一条台词。
 *
 * 用法：node tools\find_missing_line.mjs
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

const manifest = JSON.parse(readFileSync(join(ROOT, 'voice_manifest.json'), 'utf8'))
const has = (who, text) => manifest.lines.some((l) => l.speaker === who && l.text === text)

let found = 0
for (const f of walk(SRC)) {
  const code = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT, '').replace(/^[\\/]/, '')
  const lines = code.split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\{\s*who:\s*'([^']+)'\s*,\s*text:\s*'((?:[^'\\]|\\.)*)'/g)) {
      const who = m[1]
      const text = m[2].replace(/\\'/g, "'")
      if (!has(who, text)) {
        found++
        console.log(`\n[未进入清单] ${rel}:${i + 1}`)
        console.log(`   who  = ${who}`)
        console.log(`   text = ${text}`)
        console.log(`   源码: ${line.trim().slice(0, 160)}`)
      }
    }
  })
}

// 也检查跨行写法（{ 换行 who: ... }）
console.log('\n--- 检查跨行写法 ---')
for (const f of walk(SRC)) {
  const code = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT, '').replace(/^[\\/]/, '')
  for (const m of code.matchAll(/\{\s*\n\s*who:\s*'([^']+)'\s*,\s*\n\s*text:\s*'((?:[^'\\]|\\.)*)'/g)) {
    const who = m[1]
    const text = m[2].replace(/\\'/g, "'")
    console.log(`\n[跨行] ${rel}`)
    console.log(`   who=${who}  text=${text}  → 在清单里: ${has(who, text)}`)
  }
}

console.log(`\n共找到 ${found} 条未进入清单的同行写法台词`)
