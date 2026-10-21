// ============================================================
// 回忆碎片 —— 终章自由互动模式里，散落在小屋各处的小回忆。
// 点击星星 / 花朵等，会浮现一句“记忆”。
// ============================================================

export type Memory = {
  key: string
  label: string
  icon: string // 使用的贴图 key
  text: string
}

export const MEMORIES: Memory[] = [
  {
    key: 'memory_star',
    label: '一颗星星',
    icon: 'star_gold',
    text: '“你以前说，喜欢看星星，因为每一颗都很安静。”'
  },
  {
    key: 'memory_flower',
    label: '一朵花',
    icon: 'flower_pink',
    text: '“那天你随手拍下的花，后来我看了很久。”'
  },
  {
    key: 'memory_letter',
    label: '一封信',
    icon: 'wrapPaper',
    text: '“有些话当面说不出口，写下来就好多了。”'
  },
  {
    key: 'memory_cake',
    label: '一块甜点',
    icon: 'cake_base',
    text: '“你喜欢甜甜的东西，我都记着呢。”'
  },
  {
    key: 'memory_ribbon',
    label: '一条丝带',
    icon: 'ribbon',
    text: '“朱红色，是我悄悄给你的颜色。”'
  }
]
