// 导出指定角色的台词清单（含场景、录制状态），用于重新录音。
//
// 注意：台词有两个来源——src/data/dialogue.ts（大部分）和各场景文件里内联的数组。
// 所以必须全量搜索 src 下的 .ts，只搜 dialogue.ts 会漏句。
//
// 用法：node tools/export_role_lines.mjs rarity [输出文件]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPEAKER = process.argv[2] || 'rarity'
const OUT = process.argv[3] || join(ROOT, `台词清单_${SPEAKER}.txt`)

const NAMES = {
  starberry: '星莓', twilight: '紫悦', applejack: '苹果嘉儿',
  rainbow: '云宝', pinkie: '碧琪', rarity: '珍奇', fluttershy: '柔柔'
}

// 场景文件 → 中文名
const FILE_SCENE = {
  'IntroScene.ts': '序章',
  'GardenScene.ts': '第一章 · 花园',
  'BoxScene.ts': '第二章 · 礼盒',
  'DessertScene.ts': '第三章 · 甜点',
  'EveningScene.ts': '第四章 · 傍晚小屋',
  'SurpriseScene.ts': '终章 · 惊喜',
  'BirthdayScene.ts': '终章 · 生日'
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'voice_manifest.json'), 'utf8'))
const index = JSON.parse(readFileSync(join(ROOT, 'assets/audio/voice/index.json'), 'utf8'))
const have = new Set(index[SPEAKER] || [])

// 收集所有源文件
const files = []
for (const dir of ['src/data', 'src/scenes']) {
  for (const f of readdirSync(join(ROOT, dir))) {
    if (f.endsWith('.ts')) files.push({ name: f, path: join(ROOT, dir, f) })
  }
}
const contents = new Map(files.map((f) => [f.path, readFileSync(f.path, 'utf8')]))

// dialogue.ts 的块名 → 场景：看哪个场景文件引用了这个块名
const dialogue = contents.get(join(ROOT, 'src/data/dialogue.ts')) || ''
const blockNames = [...dialogue.matchAll(/export const (\w+):\s*Line\[\]\s*=\s*\[/g)].map((m) => m[1])
const blockScene = {}
for (const f of files) {
  if (f.name === 'dialogue.ts') continue
  const c = contents.get(f.path)
  const scene = FILE_SCENE[f.name] || f.name
  for (const b of blockNames) {
    if (new RegExp('\\b' + b + '\\b').test(c)) blockScene[b] = scene
  }
}

/** 找出这句话出现的场景（对话脚本优先按块名判定，场景文件直接按文件名） */
function sceneOf(text, speaker) {
  const marker = `who: '${speaker}', text: '${text}'`
  for (const f of files) {
    const c = contents.get(f.path)
    if (!c) continue
    if (f.name === 'dialogue.ts') {
      const i = c.indexOf(marker)
      if (i < 0) continue
      const blk = [...c.slice(0, i).matchAll(/export const (\w+):\s*Line\[\]\s*=\s*\[/g)].pop()
      const b = blk ? blk[1] : ''
      return { scene: blockScene[b] || b || '主线', pos: i }
    }
    // 场景文件：直接用文件名对应的场景
    const j = c.indexOf(marker)
    if (j >= 0) return { scene: FILE_SCENE[f.name] || f.name, pos: j }
  }
  return { scene: '?', pos: Number.MAX_SAFE_INTEGER }
}

const rows = []
const seen = new Set()
for (const l of manifest.lines.filter((x) => x.speaker === SPEAKER)) {
  if (seen.has(l.text)) continue
  seen.add(l.text)
  const { scene, pos } = sceneOf(l.text, SPEAKER)
  rows.push({ text: l.text, id: l.id, scene, pos, recorded: have.has(l.id) })
}

// 按场景顺序 + 剧本内出现顺序排列，录音时上下文更连贯
const ORDER = ['序章', '第一章 · 花园', '第二章 · 礼盒', '第三章 · 甜点', '第四章 · 傍晚小屋', '终章 · 惊喜', '终章 · 生日', '?']
rows.sort((a, b) => {
  const d = ORDER.indexOf(a.scene) - ORDER.indexOf(b.scene)
  return d !== 0 ? d : a.pos - b.pos
})

const name = NAMES[SPEAKER] || SPEAKER
const total = rows.length
const done = rows.filter((r) => r.recorded).length
const missing = rows.filter((r) => !r.recorded)

const out = []
out.push(`《星莓的一天》${name} 台词清单`)
out.push(`共 ${total} 句，已录 ${done} 句，缺 ${total - done} 句`)
out.push('')
out.push('录制提示：')
out.push('  · 括号（）里是表演提示或旁白，不用念出来')
out.push('  · 一条一个文件，用序号命名（01.mp3、02.mp3…），方便批量导入')
out.push('  · 44.1k 或 48k 采样、单声道即可；环境安静、不要混响')
out.push('  · 每句开头前留 0.3 秒、结尾后留 0.5 秒静音，切分会更准')
out.push('')
out.push('='.repeat(56))

let cur = ''
let n = 0
for (const r of rows) {
  if (r.scene !== cur) {
    cur = r.scene
    out.push('')
    out.push(`【${cur}】`)
    out.push('')
  }
  n++
  out.push(`${String(n).padStart(2, '0')}. ${r.recorded ? '✔ 已录' : '✘ 缺'}  ${r.text}`)
  out.push(`     编号：${r.id}`)
}

out.push('')
out.push('='.repeat(56))
out.push('')
out.push(`【还缺的 ${missing.length} 句】`)
for (const r of missing) out.push(`  · ${r.text}    （${r.scene} / ${r.id}）`)

writeFileSync(OUT, out.join('\n'), 'utf8')
console.log(`已生成：${OUT}`)
console.log(`共 ${total} 句，已录 ${done}，缺 ${total - done}`)
for (const r of rows) console.log(`${r.recorded ? '✔' : '✘'} [${r.scene}] ${r.text}`)
