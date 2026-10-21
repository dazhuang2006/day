// 构建后把游戏运行时需要的静态资源复制进 dist。
//
// 为什么需要这一步：游戏运行时会请求 assets/audio/...、assets/video/finale.mp4，
// 但这些文件在项目根目录的 assets/ 下，而 Vite 构建默认只复制 public/，
// 于是 dist 里根本没有资源 —— 部署上去会变成"没声音、没画面"的空壳。
//
// 为什么不把 assets 挪进 public/：那样运行时路径虽然不变，但生成配音的脚本
// （voice_gen.py / import_recorded_voice.py 等）都硬编码了 assets/ 这个位置，
// 挪动会牵连一片。用构建后复制更省事，也不影响开发流程。
//
// 用法：node tools/copy-assets.mjs（npm run build 会自动调用）
import { cpSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'assets')
const DST = join(ROOT, 'dist', 'assets')

// 这些文件不会在运行时被加载，别浪费上传体积
const SKIP = new Set(['README.md', '.gitignore', '.DS_Store'])

function measure(dir, acc = { files: 0, bytes: 0 }) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) measure(p, acc)
    else {
      acc.files += 1
      acc.bytes += st.size
    }
  }
  return acc
}

if (!existsSync(SRC)) {
  console.error(`找不到资源目录：${SRC}`)
  process.exit(1)
}

// 直接覆盖式复制（Vite 自己的 JS 也在 dist/assets 下，文件名不同，不会冲突）
cpSync(SRC, DST, {
  recursive: true,
  force: true,
  filter: (p) => !SKIP.has(p.split(/[\\/]/).pop() || '')
})

const m = measure(DST)
const biggest = []
for (const sub of ['audio', 'video']) {
  const p = join(DST, sub)
  if (existsSync(p)) biggest.push(`${sub} ${(measure(p).bytes / 1048576).toFixed(1)} MB`)
}
console.log(`已复制资源到 dist/assets：${m.files} 个文件，${(m.bytes / 1048576).toFixed(1)} MB`)
if (biggest.length) console.log(`  ${biggest.join('  |  ')}`)
