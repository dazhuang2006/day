/**
 * 精确核对 who 的出现：源码里 117 次 who:'...'，成对提取只有 116 条。
 * 找出多出来的那一次到底是什么（是不是漏了一条台词）。
 *
 * 用法：node tools\audit_who.mjs
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

let all = 0
const unpaired = []
for (const f of walk(SRC)) {
  const code = readFileSync(f, 'utf8')
  const rel = f.replace(ROOT, '').replace(/^[\\/]/, '')
  code.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/who:\s*'([^']+)'/g)) {
      all++
      // 同一行是否也带 text
      const hasText = /text:\s*['"`]/.test(line)
      if (!hasText) unpaired.push({ file: rel, line: i + 1, who: m[1], src: line.trim() })
    }
  })
}

console.log(`who:'...' 总出现 ${all} 次`)

// 按"对象写法 { who:" 统计，这才是真正的台词条目数
let objWho = 0
const perSpeaker = {}
for (const f of walk(SRC)) {
  const code = readFileSync(f, 'utf8')
  objWho += [...code.matchAll(/\{\s*who:/g)].length
  for (const m of code.matchAll(/who:\s*'([^']+)'/g)) {
    perSpeaker[m[1]] = (perSpeaker[m[1]] || 0) + 1
  }
}
console.log(`按对象写法 { who: 统计 = ${objWho} 次`)
console.log(`按 who:'x' 统计 = ${all} 次，分布 ${JSON.stringify(perSpeaker)}`)
console.log(`同一行不带 text 的 ${unpaired.length} 处：`)
for (const u of unpaired) {
  console.log(`  ${u.file}:${u.line}  who=${u.who}`)
  console.log(`     ${u.src.slice(0, 150)}`)
}

// 清单里各角色条数，与源码统计对比
const bySpeakers = {}
for (const l of manifest.lines) bySpeakers[l.speaker] = (bySpeakers[l.speaker] || 0) + 1
console.log('\n清单各角色条数：', JSON.stringify(bySpeakers))
const sum = Object.values(bySpeakers).reduce((a, b) => a + b, 0)
console.log(`合计 ${sum}；源码 who 出现 ${all}；差值 ${all - sum}`)
