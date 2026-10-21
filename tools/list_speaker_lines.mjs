/**
 * 打印源码里某位角色的所有台词，并标注是否已进入清单。
 * 用于定位"清单少了一条"的情况。
 *
 * 用法：node tools\list_speaker_lines.mjs rarity
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const WHO = process.argv[2] || 'rarity'

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
const inManifest = (t) => manifest.lines.some((l) => l.speaker === WHO && l.text === t)

let n = 0
const re = new RegExp(`who:\\s*'${WHO}'\\s*,\\s*text:\\s*'((?:[^'\\\\]|\\\\.)*)'`)
for (const f of walk(SRC)) {
  const rel = f.replace(ROOT, '').replace(/^[\\/]/, '')
  const code = readFileSync(f, 'utf8')
  code.split('\n').forEach((line, i) => {
    const m = line.match(re)
    if (!m) return
    n++
    const text = m[1].replace(/\\'/g, "'")
    const mark = inManifest(text) ? '  OK ' : '  ★缺失'
    console.log(`${mark} ${rel}:${i + 1}  ${text}`)
  })
}
console.log(`\n源码里 ${WHO} 共 ${n} 条，清单里 ${manifest.lines.filter((l) => l.speaker === WHO).length} 条`)
