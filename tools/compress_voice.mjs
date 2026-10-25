// 压缩配音文件（人声用 320kbps 是浪费，手机加载会明显变慢）。
//
// 做法：把 assets/audio/voice/<角色>/*.mp3 重新编码成单声道 96kbps。
//   - 原文件先备份到 refs/_backup/voice_orig_320k/（只备份一次，不覆盖已有备份）
//   - 文件名/目录结构不变，所以 index.json 和运行时映射都不用动
//   - 会校验时长没有明显变化，避免编码出错
//
// 用法：node tools/compress_voice.mjs [--dry-run]
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VOICE = join(ROOT, 'assets/audio/voice')
const BACKUP = join(ROOT, 'refs/_backup/voice_orig_320k')
const TMP = join(ROOT, 'refs/_tmp_voice')
const FFMPEG = process.env.FFMPEG || 'D:/program/GPT-SoVITS-main/ffmpeg.exe'
const FFPROBE = process.env.FFPROBE || 'D:/program/GPT-SoVITS-main/ffprobe.exe'
const DRY = process.argv.includes('--dry-run')

const SPK = ['starberry', 'twilight', 'applejack', 'rainbow', 'pinkie', 'rarity', 'fluttershy']

function duration(file) {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  return Number((r.stdout || '0').trim()) || 0
}

mkdirSync(TMP, { recursive: true })
let count = 0
let before = 0
let after = 0
const problems = []

for (const sp of SPK) {
  const dir = join(VOICE, sp)
  if (!existsSync(dir)) continue
  const files = readdirSync(dir).filter((f) => f.endsWith('.mp3'))
  for (const f of files) {
    const src = join(dir, f)
    const sizeBefore = statSync(src).size
    const durBefore = duration(src)
    before += sizeBefore

    if (DRY) { after += Math.round(sizeBefore * 0.3); count++; continue }

    // 备份（保留角色子目录，避免同名冲突）
    const bakDir = join(BACKUP, sp)
    mkdirSync(bakDir, { recursive: true })
    const bak = join(bakDir, f)
    if (!existsSync(bak)) copyFileSync(src, bak)

    const out = join(TMP, `${sp}_${f}`)
    const r = spawnSync(FFMPEG, [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', src,
      '-ac', '1', '-ar', '44100', '-codec:a', 'libmp3lame', '-b:a', '96k',
      out
    ], { encoding: 'utf8' })

    if (!existsSync(out)) {
      problems.push(`${sp}/${f}: ffmpeg 失败 ${(r.stderr || '').slice(0, 80)}`)
      continue
    }
    const durAfter = duration(out)
    if (durBefore > 0 && Math.abs(durAfter - durBefore) > 0.15) {
      problems.push(`${sp}/${f}: 时长异常 ${durBefore.toFixed(2)}s -> ${durAfter.toFixed(2)}s`)
      continue
    }
    const sizeAfter = statSync(out).size
    if (sizeAfter > sizeBefore) {
      problems.push(`${sp}/${f}: 压缩后反而变大，跳过`)
      continue
    }
    copyFileSync(out, src)
    after += sizeAfter
    count++
  }
}

console.log(DRY ? '（--dry-run，未修改文件）' : `已处理 ${count} 个文件`)
console.log(`原始合计 ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB（约 ${Math.round((1 - after / before) * 100)}% 更小）`)
if (!DRY) console.log(`原文件备份在 ${BACKUP.replace(ROOT + '\\', '')}`)
if (problems.length) {
  console.log('\n需要注意：')
  for (const p of problems) console.log('  - ' + p)
}
writeFileSync(join(ROOT, 'refs/_tmp_voice/.done'), 'ok')
