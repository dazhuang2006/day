import Phaser from 'phaser'
import { STARBERRY } from './config'

// ============================================================
// 程序化贴图生成：所有角色、道具、粒子均由 Graphics 绘制，
// 无需任何外部美术资源，保证 npm install && npm run dev 即可运行。
//
// 关键：Graphics.generateTexture 以 (0,0) 为贴图左上角，
// 负坐标内容会被裁掉。因此所有绘制内容都使用正坐标并居中放置，
// 避免出现"只显示半截"的贴图。
// ============================================================

export type PonyPalette = {
  body: number
  mane: number
  mane2: number
  eye: number
  mark: 'starHorseshoe' | 'star' | 'butterfly' | 'apple' | 'bolt' | 'gem' | 'balloon'
  ribbon?: number
}

// 五角星（中心坐标系，调用处负责平移到正区域）
function drawStar(g: Phaser.GameObjects.Graphics, cx: number, cy: number, r: number, color: number, alpha = 1) {
  g.fillStyle(color, alpha)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad })
  }
  g.fillPoints(pts, true)
}

// 马蹄铁（中心坐标系）
function drawHorseshoe(g: Phaser.GameObjects.Graphics, cx: number, cy: number, w: number, h: number, color: number) {
  g.fillStyle(color)
  g.fillRoundedRect(cx - w / 2, cy - h * 0.55, w, h * 0.5, w * 0.3) // 上横
  g.fillRoundedRect(cx - w / 2, cy - h * 0.2, w * 0.32, h * 0.75, w * 0.16) // 左竖
  g.fillRoundedRect(cx + w / 2 - w * 0.32, cy - h * 0.2, w * 0.32, h * 0.75, w * 0.16) // 右竖
}

function drawMark(g: Phaser.GameObjects.Graphics, x: number, y: number, mark: PonyPalette['mark'], color: number) {
  switch (mark) {
    case 'starHorseshoe':
      drawStar(g, x - 5, y - 5, 6, color)
      drawHorseshoe(g, x + 6, y + 4, 9, 11, color)
      break
    case 'star':
      drawStar(g, x, y, 7, color)
      break
    case 'butterfly':
      g.fillStyle(color)
      g.fillEllipse(x - 6, y, 5, 7)
      g.fillEllipse(x + 6, y, 5, 7)
      g.fillRoundedRect(x - 1.5, y - 6, 3, 12, 1.5)
      break
    case 'apple':
      g.fillStyle(color)
      g.fillCircle(x, y, 5)
      g.fillRect(x - 0.8, y - 6, 1.6, 3)
      break
    case 'bolt':
      g.fillStyle(color)
      g.fillTriangle(x - 4, y - 6, x + 3, y - 2, x - 2, y - 1)
      g.fillTriangle(x + 4, y + 6, x - 3, y + 2, x + 2, y + 1)
      break
    case 'gem':
      g.fillStyle(color)
      g.fillPoints(
        [
          { x, y: y - 6 },
          { x: x + 4, y: y - 1 },
          { x: x, y: y + 6 },
          { x: x - 4, y: y - 1 }
        ],
        true
      )
      break
    case 'balloon':
      g.fillStyle(color)
      g.fillCircle(x, y - 1, 5)
      g.lineStyle(1, color)
      g.lineBetween(x, y + 4, x, y + 7)
      break
  }
}

// ============ 小马角色（Q版，正面） ============
// 内容以 (0,0) 为中心设计，绘制时整体缩放 s 并平移到 (ox, oy)，
// 保证完整落在 [0,size] 内、居中不裁剪。
function drawPonyFrame(
  g: Phaser.GameObjects.Graphics,
  p: PonyPalette,
  opts: { bob: number; legFrame: number; showMark: boolean; blink: boolean },
  ox: number,
  oy: number,
  s: number
) {
  const X = (v: number) => ox + s * v
  const Y = (v: number) => oy + s * v
  const R = (v: number) => s * v

  const bob = opts.bob
  const bodyW = 40
  const bodyH = 30
  const headR = 17
  const baseY = 62
  const bodyY = baseY - bodyH + bob
  const headY = bodyY - bodyH * 0.35 - 2 + bob

  // 四条腿
  const legH = 13
  const legColor = p.body
  const legW = 8
  const legs: [number, number, number][] = [
    [-14, 0, opts.legFrame === 1 ? 3 : 0],
    [14, 0, opts.legFrame === 3 ? 3 : 0],
    [-6, 0, opts.legFrame === 2 ? 3 : 0],
    [6, 0, opts.legFrame === 0 ? 3 : 0]
  ]
  const legXs = [-14, 14, -7, 7]
  legs.forEach((leg, i) => {
    const lx = bodyY + bodyH - 2
    g.fillStyle(legColor)
    g.fillRoundedRect(X(legXs[i] - legW / 2), Y(lx + leg[2] * 0.35), R(legW), R(legH), R(legW / 2))
    g.fillStyle(0xffffff, 0.5)
    g.fillCircle(X(legXs[i]), Y(lx + legH * 0.4), R(1.6))
  })

  // 身体
  g.fillStyle(p.body)
  g.fillRoundedRect(X(-bodyW / 2), Y(bodyY), R(bodyW), R(bodyH), R(15))

  // 尾巴
  g.fillStyle(p.mane)
  g.fillEllipse(X(bodyW / 2 - 2), Y(bodyY + bodyH * 0.45), R(10), R(22))
  g.fillStyle(p.mane2)
  g.fillEllipse(X(bodyW / 2 + 2), Y(bodyY + bodyH * 0.55), R(6), R(14))

  // 可爱标记
  if (opts.showMark) {
    drawMark(g, X(-bodyW / 2 + 10), Y(bodyY + bodyH * 0.5), p.mark, 0xffffff)
  }

  // 头
  g.fillStyle(p.body)
  g.fillCircle(X(0), Y(headY), R(headR))

  // 耳朵
  g.fillStyle(p.body)
  g.fillEllipse(X(-headR + 6), Y(headY - headR + 5), R(7), R(12))
  g.fillEllipse(X(headR - 6), Y(headY - headR + 5), R(7), R(12))
  g.fillStyle(p.mane)
  g.fillEllipse(X(-headR + 6), Y(headY - headR + 6), R(4), R(7))
  g.fillEllipse(X(headR - 6), Y(headY - headR + 6), R(4), R(7))

  // 前刘海
  g.fillStyle(p.mane)
  g.fillEllipse(X(-headR * 0.55), Y(headY - headR * 0.6), R(8), R(12))
  g.fillEllipse(X(headR * 0.55), Y(headY - headR * 0.6), R(8), R(12))
  g.fillEllipse(X(0), Y(headY - headR * 0.8), R(10), R(8))

  // 眼睛
  const eyeY = headY + 2
  g.fillStyle(0xffffff)
  g.fillCircle(X(-8), Y(eyeY), R(5.4))
  g.fillCircle(X(8), Y(eyeY), R(5.4))
  if (!opts.blink) {
    g.fillStyle(p.eye)
    g.fillCircle(X(-8), Y(eyeY), R(3.8))
    g.fillCircle(X(8), Y(eyeY), R(3.8))
    g.fillStyle(0x26203a)
    g.fillCircle(X(-8), Y(eyeY), R(1.9))
    g.fillCircle(X(8), Y(eyeY), R(1.9))
    g.fillStyle(0xffffff, 0.9)
    g.fillCircle(X(-6.6), Y(eyeY - 1.4), R(1.2))
    g.fillCircle(X(9.4), Y(eyeY - 1.4), R(1.2))
  } else {
    g.lineStyle(R(1.6), 0x26203a)
    g.lineBetween(X(-10), Y(eyeY), X(-6), Y(eyeY))
    g.lineBetween(X(6), Y(eyeY), X(10), Y(eyeY))
  }

  // 腮红
  g.fillStyle(0xff7a9c, 0.35)
  g.fillCircle(X(-13), Y(headY + 7), R(2.6))
  g.fillCircle(X(13), Y(headY + 7), R(2.6))

  // 微笑
  g.lineStyle(R(1.6), 0xd55a86)
  g.beginPath()
  g.arc(X(0), Y(headY + 3), R(5), 0.15 * Math.PI, 0.85 * Math.PI)
  g.strokePath()

  // 朱红色丝带
  if (p.ribbon) {
    g.fillStyle(p.ribbon)
    g.fillEllipse(X(0), Y(headY - headR * 0.15), R(16), R(4.4))
    g.fillTriangle(X(-10), Y(headY - headR * 0.12), X(-6), Y(headY - headR * 0.12), X(-8), Y(headY - headR * 0.12 + 6))
    g.fillTriangle(X(10), Y(headY - headR * 0.12), X(6), Y(headY - headR * 0.12), X(8), Y(headY - headR * 0.12 + 6))
  }
}

// 为角色生成 站立 + 走路 动画帧；贴图 72x72，内容缩放 0.9 并居中
// 四个朝向各一套贴图：down/up 用正面稿，left/right 用正面稿镜像（左侧带尾巴），
// 这样角色终于会"转身"，而不像以前永远只有一张正面图。
export const DIRECTIONS = ['down', 'up', 'left', 'right'] as const
export type Direction = (typeof DIRECTIONS)[number]

export function makePony(scene: Phaser.Scene, key: string, p: PonyPalette, size = 72) {
  const ox = 36
  const oy = 33
  const s = 0.9

  const draw = (opts: { bob: number; legFrame: number }, mirror: boolean, suffix: string) => {
    const g = scene.make.graphics({ x: 0, y: 0 }, false)
    if (mirror) {
      g.translateCanvas(size, 0)
      g.scaleCanvas(-1, 1)
    }
    drawPonyFrame(g, p, { ...opts, showMark: true, blink: false }, ox, oy, s)
    g.generateTexture(`${key}${suffix}`, size, size)
    g.destroy()
  }

  const makeAnim = (animKey: string, names: string[]) => {
    if (scene.anims.exists(animKey)) return
    scene.anims.create({
      key: animKey,
      frames: names.map((n) => ({ key: n })),
      frameRate: 8,
      repeat: -1
    })
  }

  for (const d of DIRECTIONS) {
    const mirror = d === 'left'
    draw({ bob: 0, legFrame: 0 }, mirror, `_stand_${d}`)
    const walkNames: string[] = []
    for (let i = 0; i < 4; i++) {
      const bob = i % 2 === 0 ? -2 : 2
      const name = `${key}_walk${i}_${d}`
      draw({ bob, legFrame: (i + 1) % 4 }, mirror, `_walk${i}_${d}`)
      walkNames.push(name)
    }
    makeAnim(`${key}_walk_${d}`, walkNames)
  }

  // 兼容：仍然生成 _stand / _walk 这一组"正面"旧名字
  draw({ bob: 0, legFrame: 0 }, false, '_stand')
  const legacyWalk: string[] = []
  for (let i = 0; i < 4; i++) {
    const name = `${key}_walk${i}`
    draw({ bob: i % 2 === 0 ? -2 : 2, legFrame: (i + 1) % 4 }, false, `_walk${i}`)
    legacyWalk.push(name)
  }
  makeAnim(`${key}_walk`, legacyWalk)
}

// 渐变背景
export function makeGradient(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  colors: string[],
  vertical = true
) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const grad = vertical ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, 0)
  colors.forEach((c, i) => grad.addColorStop(i / Math.max(1, colors.length - 1), c))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)
  scene.textures.addCanvas(key, canvas)
}

// 花朵（居中，花心在上部、茎向下）
export function makeFlower(scene: Phaser.Scene, colorKey: string, color: number) {
  const key = `flower_${colorKey}`
  const size = 40
  const cx = size / 2
  const cy = 12
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.lineStyle(3, 0x63c96f)
  g.lineBetween(cx, cy + 4, cx, size - 2) // 茎
  g.fillStyle(0x63c96f)
  g.fillEllipse(cx - 4, cy + 10, 8, 4) // 叶
  g.fillEllipse(cx + 4, cy + 14, 8, 4)
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3
    g.fillStyle(color)
    g.fillEllipse(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 7, 7) // 花瓣
  }
  g.fillStyle(0xffe066)
  g.fillCircle(cx, cy, 4) // 花芯
  g.generateTexture(key, size, size)
  g.destroy()
}

// 神秘盒子（居中）
export function makeBox(scene: Phaser.Scene) {
  const size = 72
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(0xff9ec7)
  g.fillRoundedRect(c - 24, c - 18, 48, 40, 6)
  g.fillStyle(0xff7fb1)
  g.fillRect(c - 24, c - 10, 48, 4)
  drawStar(g, c, c + 2, 8, 0xfff0b0)
  g.fillStyle(0xfff3e0)
  g.fillRect(c - 2, c - 14, 4, 34)
  drawHorseshoe(g, c + 14, c + 8, 9, 11, 0xffe066)
  g.fillStyle(0xffe066)
  g.fillRoundedRect(c - 3, c - 6, 6, 6, 2) // 锁
  g.fillStyle(0xffb040)
  g.fillCircle(c, c - 3, 1.6)
  g.generateTexture('mystery_box', size, size)
  g.destroy()
}

// 圆形道具（居中）
function makeRoundProp(scene: Phaser.Scene, key: string, color: number, r: number, accent?: { c: number; r: number }) {
  const size = r * 2 + 8
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(color)
  g.fillCircle(c, c, r)
  if (accent) {
    g.fillStyle(accent.c)
    g.fillCircle(c, c, accent.r)
  }
  g.generateTexture(key, size, size)
  g.destroy()
}

export function makeCollectibleTextures(scene: Phaser.Scene) {
  makeFlower(scene, 'pink', 0xff8fb4)
  makeFlower(scene, 'purple', 0xb98bff)
  makeFlower(scene, 'white', 0xffffff)
  makeBox(scene)
  makeRoundProp(scene, 'ribbon', 0xff6f9f, 12)
  makeRoundProp(scene, 'starDeco', 0xffd94d, 12)
  makeRoundProp(scene, 'wrapPaper', 0x9ad7ff, 12)
  makeRoundProp(scene, 'hanging', 0xc9a3ff, 12)
  makeRoundProp(scene, 'apple', 0xff5a5a, 13, { c: 0x7fd34f, r: 4 })
  makeRoundProp(scene, 'strawberry', 0xff5a78, 12)
  makeRoundProp(scene, 'cream', 0xfff3e0, 12)
  makeRoundProp(scene, 'chocolate', 0x8a5a44, 12)
  makeRoundProp(scene, 'icing', 0xf3b8ff, 12)
  makeRoundProp(scene, 'sparkle', 0xffe79a, 6)
}

// 星星（居中）
export function makeStarTexture(scene: Phaser.Scene, key = 'star_spark', size = 26, color = 0xffe79a) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  drawStar(g, size / 2, size / 2, size / 2 - 1, color, 0.9)
  g.generateTexture(key, size, size)
  g.destroy()
}

// 蝴蝶（居中）
export function makeButterfly(scene: Phaser.Scene, key = 'butterfly') {
  const size = 36
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(0xff9ad5, 0.95)
  g.fillEllipse(c - 8, c, 10, 8)
  g.fillEllipse(c + 8, c, 10, 8)
  g.fillStyle(0xff6fb0, 0.95)
  g.fillEllipse(c - 8, c, 5, 4)
  g.fillEllipse(c + 8, c, 5, 4)
  g.fillStyle(0xffe0ef)
  g.fillRoundedRect(c - 1.5, c - 7, 3, 14, 1.5)
  g.generateTexture(key, size, size)
  g.destroy()
}

// 彩灯（居中）
export function makeLight(scene: Phaser.Scene, key = 'fairy_light', color = 0xffe79a) {
  const size = 20
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(color)
  g.fillCircle(c, c, 5)
  g.fillStyle(0xffffff, 0.8)
  g.fillCircle(c + 1, c - 1, 1.8)
  g.generateTexture(key, size, size)
  g.destroy()
}

// 甜点（蛋糕，居中）
export function makeCake(scene: Phaser.Scene) {
  const size = 76
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(0xffc9e0)
  g.fillRoundedRect(c - 30, c - 1, 60, 16, 6) // 底层
  g.fillStyle(0xffffff)
  g.fillRoundedRect(c - 24, c - 13, 48, 16, 6) // 中层
  g.fillStyle(0xfff3e0)
  g.fillRoundedRect(c - 17, c - 25, 34, 14, 6) // 顶层
  g.fillStyle(0xffe066)
  g.fillRoundedRect(c - 3, c - 39, 5, 14, 2) // 蜡烛
  g.fillStyle(0xff6f9f)
  g.fillCircle(c - 0.5, c - 40, 3)
  g.generateTexture('cake_base', size, size)
  g.destroy()
}

// 云朵（居中）
export function makeCloud(scene: Phaser.Scene, key = 'cloud') {
  const size = 64
  const c = size / 2
  const g = scene.make.graphics({ x: 0, y: 0 }, false)
  g.fillStyle(0xffffff, 0.9)
  g.fillCircle(c - 14, c, 10)
  g.fillCircle(c, c - 6, 14)
  g.fillCircle(c + 14, c, 11)
  g.fillCircle(c, c + 4, 11)
  g.generateTexture(key, size, size)
  g.destroy()
}

// 一次性生成全部贴图
export function generateAllTextures(scene: Phaser.Scene) {
  makePony(scene, 'starberry', {
    body: STARBERRY.body,
    mane: STARBERRY.mane,
    mane2: STARBERRY.mane2,
    eye: STARBERRY.eye,
    mark: 'starHorseshoe',
    ribbon: STARBERRY.ribbon
  })
  makePony(scene, 'twilight', { body: 0xc9a3ff, mane: 0x7a4bb0, mane2: 0xff9ad5, eye: 0x7a5cff, mark: 'star' })
  makePony(scene, 'fluttershy', { body: 0xffe9a0, mane: 0xff9ad5, mane2: 0xffc9e0, eye: 0x3fa0e0, mark: 'butterfly' })
  makePony(scene, 'applejack', { body: 0xffc26b, mane: 0xffb040, mane2: 0xffe066, eye: 0x7fbf3f, mark: 'apple' })
  makePony(scene, 'rainbow', { body: 0x9ad7ff, mane: 0xff5a78, mane2: 0x53d8d0, eye: 0xff5a9c, mark: 'bolt' })
  makePony(scene, 'rarity', { body: 0xffffff, mane: 0xc9a3ff, mane2: 0x9ad7ff, eye: 0x3fb0e0, mark: 'gem' })
  makePony(scene, 'pinkie', { body: 0xff9ad5, mane: 0xff6fb0, mane2: 0xffc9e0, eye: 0x3fb0e0, mark: 'balloon' })

  makeCollectibleTextures(scene)
  makeStarTexture(scene)
  makeButterfly(scene)
  makeLight(scene)
  makeCake(scene)
  makeCloud(scene)

  // 额外星星颜色
  makeStarTexture(scene, 'star_gold', 26, 0xffd94d)
  makeStarTexture(scene, 'star_pink', 26, 0xff9ad5)
  makeStarTexture(scene, 'star_white', 26, 0xffffff)
  makeLight(scene, 'fairy_light_pink', 0xff9ad5)
  makeLight(scene, 'fairy_light_blue', 0x9ad7ff)
  makeLight(scene, 'fairy_light_green', 0x9fffcb)
}
