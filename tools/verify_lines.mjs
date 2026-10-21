/**
 * 核对 角色台词表.md / voice_manifest.json 是否与游戏源码一致。
 *
 * 为什么要核对：台词表是正则从源码里提取的，"自动提取"不等于"准确"。
 * 这里做三件事：
 *   1. 统计源码里 who:'x' / text:'...' 的出现次数，与清单对比；
 *   2. 找出清单里没有、但源码里存在的台词（漏提取）；
 *   3. 找出清单里有、但源码里找不到的台词（错提取）。
 *
 * 用法：node tools/verify_lines.mjs
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

const files = walk(SRC)
const manifest = JSON.parse(readFileSync(join(ROOT, 'voice_manifest.json'), 'utf8'))
const md = readFileSync(join(ROOT, '角色台词表.md'), 'utf8')

// --- 1. 源码里的原始出现次数 ---
let srcWhoCount = 0
let srcTextCount = 0
let templateText = 0
const srcPairs = new Set()
for (const f of files) {
  const code = readFileSync(f, 'utf8')
  const whoMatches = [...code.matchAll(/who:\s*'([^']+)'/g)]
  srcWhoCount += whoMatches.length
  srcTextCount += [...code.matchAll(/text:\s*'/g)].length
  templateText += [...code.matchAll(/text:\s*`/g)].length
  // 抓成对出现的 { who: 'x', text: '...' }
  for (const m of code.matchAll(/\{\s*who:\s*'([^']+)'\s*,\s*text:\s*'((?:[^'\\]|\\.)*)'/g)) {
    srcPairs.add(`${m[1]}\u0000${m[2]}`)
  }
}

console.log('=== 源码统计 ===')
console.log(`  文件数 ${files.length}`)
console.log(`  who:'...' 出现 ${srcWhoCount} 次`)
console.log(`  text:'...' 出现 ${srcTextCount} 次`)
console.log(`  text:\`...\` 模板写法 ${templateText} 次（正则提取不到，需确认是否有台词）`)
console.log(`  成对 {who,text} 去重后 ${srcPairs.size} 条`)

console.log('\n=== 清单统计 ===')
console.log(`  voice_manifest.json 台词 ${manifest.lines.length} 条`)
const mdRows = [...md.matchAll(/^\| \d+ \| `([^`]+)` \| (.+) \|$/gm)]
console.log(`  角色台词表.md 表格行 ${mdRows.length} 条`)

// --- 2. 清单 vs 源码 ---
const byId = new Map(manifest.lines.map((l) => [l.id, l]))
const srcPairsNorm = new Map()
for (const key of srcPairs) {
  const [who, text] = key.split('\u0000')
  srcPairsNorm.set(`${who}\u0000${text}`, { who, text })
}

let missing = []   // 源码有、清单无
let extra = []     // 清单有、源码无
for (const [key, v] of srcPairsNorm) {
  const hit = manifest.lines.find((l) => l.speaker === v.who && l.text === v.text)
  if (!hit) missing.push(v)
}
for (const l of manifest.lines) {
  if (!srcPairsNorm.has(`${l.speaker}\u0000${l.text}`)) extra.push(l)
}

console.log('\n=== 差异 ===')
console.log(`  源码有但清单缺: ${missing.length}`)
missing.slice(0, 8).forEach((m) => console.log(`     ${m.who}: ${m.text}`))
console.log(`  清单有但源码找不到: ${extra.length}`)
extra.slice(0, 8).forEach((m) => console.log(`     ${m.speaker}: ${m.text}`))

// --- 3. Markdown 表格与 manifest 是否一致 ---
const mdIdSet = new Set(mdRows.map((m) => m[1]))
const manIdSet = new Set(manifest.lines.map((l) => l.id))
const mdOnly = [...mdIdSet].filter((i) => !manIdSet.has(i))
const manOnly = [...manIdSet].filter((i) => !mdIdSet.has(i))
console.log('\n=== 表格与 JSON 一致性 ===')
console.log(`  md 独有: ${mdOnly.length}   json 独有: ${manOnly.length}`)

// --- 4. 文本一致性（md 里那条是不是真的对应这个 id）---
let mismatched = 0
for (const m of mdRows) {
  const line = byId.get(m[1])
  if (!line) continue
  const mdText = m[2].replace(/\s*\|$/, '').trim()
  if (mdText !== line.text) {
    mismatched++
    if (mismatched <= 5) console.log(`     文本不符 ${m[1]}\n       md: ${mdText}\n     json: ${line.text}`)
  }
}
console.log(`  md 与 json 文本不符: ${mismatched}`)

const ok = missing.length === 0 && extra.length === 0 && mdOnly.length === 0 &&
           manOnly.length === 0 && mismatched === 0 && templateText === 0
console.log('\n' + (ok ? 'VERIFY PASS：台词表与源码一致' : 'VERIFY 有差异，见上'))
process.exitCode = ok ? 0 : 1
