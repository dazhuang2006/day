// 校验：Node 端（extract-lines.mjs 用的 crypto）与 Python 端（voice_gen.py 用的 hashlib）
// 对同一段文本算出的 id 必须完全一致，否则游戏找文件会全部落空。
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const samples = [
  '碧琪。',
  '我们回小屋吧。',
  '紫悦，我准备得怎么样？',
  '东西都给你备齐了——苹果、草莓、奶油、巧克力、糖霜。',
  '（气声）三下之后我就不客气了！',
  'a',
  '',
  '😀 emoji 也要一致'
]

const nodeIds = samples.map((t) => createHash('sha1').update(t).digest('hex').slice(0, 10))

const py = execFileSync(
  'C:\\Users\\23201\\.conda\\envs\\GPTSoVits\\python.exe',
  ['-c', `
import hashlib, json, sys
samples = json.loads(sys.stdin.read())
print(json.dumps([hashlib.sha1(t.encode("utf-8")).hexdigest()[:10] for t in samples]))
`],
  { input: JSON.stringify(samples), encoding: 'utf8' }
).trim()

const pyIds = JSON.parse(py)
let bad = 0
samples.forEach((t, i) => {
  const ok = nodeIds[i] === pyIds[i]
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${JSON.stringify(t).slice(0, 40)}  node=${nodeIds[i]} py=${pyIds[i]}`)
})
console.log(bad === 0 ? 'ALGORITHM MATCH' : `MISMATCH ${bad}`)
process.exit(bad === 0 ? 0 : 1)
