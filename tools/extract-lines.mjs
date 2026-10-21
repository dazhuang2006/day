/**
 * 从 TypeScript 源码里提取全部对话台词，生成配音清单。
 *
 * 为什么不手抄：台词会改。直接从源码提取才能保证"清单 = 游戏里真正会念的内容"，
 * 否则改了台词、配音就悄悄对不上了。
 *
 * 做法：用 esbuild（vite 自带）把 src/data/dialogue.ts 和四个场景文件打包成 CJS，
 * 期间把依赖替换成桩（Phaser / audioManager / 浏览器全局），然后在 Node 里 require 拿数据。
 * 打包后是纯数据，所以在 Node 里也能跑。
 *
 * 输出：voice_manifest.json —— 每行含 id / speaker / text，
 *       id 由 speaker + 文本内容哈希决定，台词不改则 id 稳定。
 */
import { createRequire } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const esbuild = require(resolve(ROOT, 'node_modules/esbuild'))

// 打包时替换掉的模块：只要它们不真的执行浏览器代码就行
const STUB_AUDIO = resolve(ROOT, 'tools/.stub-phaser.js')
const STUB_PREFS = resolve(ROOT, 'tools/.stub-prefs.js')

mkdirSync(resolve(ROOT, 'tools'), { recursive: true })

// esbuild 的 alias 不接受相对路径，用 onResolve 把浏览器相关模块重定向到桩
const stubPlugin = {
  name: 'stub',
  setup(b) {
    b.onResolve({ filter: /^(phaser|\.\.\/audio|\.\/audio|\.\.\/prefs|\.\/prefs)$/ }, (args) => {
      if (args.path === 'phaser') return { path: STUB_AUDIO }
      if (args.path.endsWith('prefs')) return { path: STUB_PREFS }
      return { path: STUB_AUDIO }
    })
  }
}

const ENTRIES = [
  'src/data/dialogue.ts',
  'src/scenes/BirthdayScene.ts',
  'src/scenes/GardenScene.ts',
  'src/scenes/EveningScene.ts',
  'src/scenes/DessertScene.ts',
  'src/scenes/BoxScene.ts'
]

// 多入口必须给 outdir，所以逐个入口单独打包，省掉临时目录
const build = { outputFiles: [] }
for (const entry of ENTRIES) {
  const one = await esbuild.build({
    entryPoints: [resolve(ROOT, entry)],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    // 关键：默认 esbuild 会把中文转成 \uXXXX 转义，正则会全部匹配不到
    charset: 'utf8',
    plugins: [stubPlugin]
  })
  build.outputFiles.push(...one.outputFiles)
}

/** 从打包产物里取出所有形如 { who, text } 的对象（esbuild 产物用双引号） */
function collectLines(code) {
  const out = []
  const re = /\{\s*["']?who["']?\s*:\s*(?:'([^']*)'|"([^"]*)")\s*,\s*["']?text["']?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  let m
  while ((m = re.exec(code)) !== null) {
    const raw = m[3] ?? m[4] ?? ''
    out.push({
      speaker: m[1] || m[2],
      text: raw.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    })
  }
  return out
}

const seen = new Map()
for (const file of build.outputFiles) {
  for (const line of collectLines(file.text)) {
    // 同一句话可能同时出现在数据文件和场景文件里（引用同一个数组），去重
    const id = `${line.speaker}_${createHash('sha1').update(line.text).digest('hex').slice(0, 10)}`
    if (!seen.has(id)) seen.set(id, { id, ...line })
  }
}

const lines = [...seen.values()].sort((a, b) =>
  a.speaker === b.speaker ? a.id.localeCompare(b.id) : a.speaker.localeCompare(b.speaker)
)

// 旁白（没有 who 的）不在上面正则范围里，单独再扫一遍纯 text 行
const narrator = []
for (const file of build.outputFiles) {
  const re = /text["']?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g
  let m
  while ((m = re.exec(file.text)) !== null) {
    const t = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'").replace(/\\"/g, '"')
    if (/^[（(]/.test(t) && t.length > 4) narrator.push(t)
  }
}

const bySpeaker = {}
for (const l of lines) (bySpeaker[l.speaker] ??= []).push(l)

const manifest = {
  generatedAt: new Date().toISOString(),
  note: '由 tools/extract-lines.mjs 自动生成；id = speaker + 文本哈希，台词不变则 id 不变',
  counts: {
    total: lines.length,
    bySpeaker: Object.fromEntries(Object.entries(bySpeaker).map(([k, v]) => [k, v.length])),
    narratorCandidates: [...new Set(narrator)].length
  },
  lines
}

writeFileSync(resolve(ROOT, 'voice_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

// 游戏运行时要用的映射：speaker 原文 -> 配音 id。
// 由这里生成而不是让浏览器端自己算哈希，是为了避免两端算法重复实现、悄悄漂移。
// 放在 src/data 下，vite 会直接把它打进包里，运行时不额外发请求。
const linesMap = {}
for (const l of lines) {
  ;(linesMap[l.speaker] ??= {})[l.text] = l.id
}
writeFileSync(
  resolve(ROOT, 'src/data/voiceLines.json'),
  JSON.stringify(linesMap, null, 2) + '\n',
  'utf8'
)

console.log('提取到台词', manifest.counts.total, '条')
console.log('按角色:', JSON.stringify(manifest.counts.bySpeaker, null, 0))
console.log('旁白候选（括号动作描写）:', manifest.counts.narratorCandidates, '条')
console.log('已写入 voice_manifest.json 与 src/data/voiceLines.json')
