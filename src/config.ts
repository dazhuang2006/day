// 全局共享配置与进度状态

export const GAME = {
  width: 960,
  height: 560,
  title: '星莓的一天',
  subtitle: '“今天，好像有点不一样。”'
}

// 生日信读完之后的收尾视频。
// 把文件放到 assets/video/ 下并按下面命名即可自动播放；文件缺失会被安全跳过。
// 想换视频：改这里的 src，或直接替换同名文件。
export const FINALE_VIDEO = {
  /** 视频文件路径（相对站点根目录）。留空则跳过播放。 */
  src: 'assets/video/finale.mp4',
  /** 'wait'  播完再进入自由互动（推荐；读档重进时不会重播）
   *  'replace' 用视频代替自由互动，播完就停在场景里
   *  'always' 每次都播（读档重进也会再播一遍） */
  mode: 'wait' as 'wait' | 'replace' | 'always',
  /** 允许点击跳过 */
  skippable: true,
  /** 跳过按钮出现前的等待秒数（避免刚开播就被手快点掉） */
  skipAfter: 3,
  /** 信读完后那个按钮上的文字（点它才播放视频） */
  letterButtonText: '把回忆拼好送你 ▸'
}

// 存档版本：数据结构不兼容时递增，旧存档会被安全忽略
export const SAVE_VERSION = 3
export const SAVE_KEY = 'starberry-day.save'

// 章节进度：continue 时用来决定从哪一幕继续
export type Phase = 'intro' | 'garden' | 'box' | 'dessert' | 'evening' | 'surprise' | 'done'
export const PHASE_ORDER: Phase[] = ['intro', 'garden', 'box', 'dessert', 'evening', 'surprise', 'done']
export const PHASE_LABEL: Record<Phase, string> = {
  intro: '序章 · 清晨的房间',
  garden: '第一章 · 梦幻花园',
  box: '第二章 · 小屋与神秘盒子',
  dessert: '第三章 · 苹果园与特别甜点',
  evening: '第四章 · 傍晚小屋',
  surprise: '第五章 · 她来了',
  done: '终章 · 已读完生日信'
}
// 继续游戏时各章节的出生点
export const PHASE_START: Record<Phase, { scene: string; x: number; y: number }> = {
  intro: { scene: 'IntroScene', x: 480, y: 430 },
  garden: { scene: 'GardenScene', x: 480, y: 430 },
  box: { scene: 'BoxScene', x: 480, y: 440 },
  dessert: { scene: 'DessertScene', x: 480, y: 470 },
  evening: { scene: 'EveningScene', x: 480, y: 470 },
  surprise: { scene: 'SurpriseScene', x: 480, y: 280 },
  done: { scene: 'BirthdayScene', x: 480, y: 280 }
}

// 星莓（原创主角）
export const STARBERRY = {
  id: 'starberry',
  name: '星莓',
  body: 0xffb7d5, // 蜜桃粉
  mane: 0xb98bff, // 薰衣草紫
  mane2: 0xffc9e0, // 浅粉
  eye: 0x53d8d0, // 湖水绿
  mark: 'starHorseshoe', // 星星 + 马蹄铁
  ribbon: 0xc6285c // 朱红色丝带（马年元素）
}

// 全局游戏进度（跨场景共享）
export class GameState {
  phase: Phase = 'intro'
  flowers: string[] = [] // 已收集花朵
  items: string[] = [] // 已收集物品（彩带/星星/包装纸/挂件…）
  giftWrapped = false // 礼物是否已包装（跨场景保留）
  toppings: string[] = [] // 甜点装饰
  dessertMaterials: string[] = [] // 甜点材料
  dessertDone = false
  decorations: string[] = [] // 已完成布置
  surprised = false
  letterRead = false
  /** 本章已触发过的剧情对话（key 见各场景的 gate） */
  talkedTo: string[] = []
  /** 每个角色在本章送给星莓的那件布置物（key = 角色） */
  received: string[] = []
  // 读档继续时用来跳过已经看过的开场动画
  introSeen = false
  boxIntroSeen = false
  wrapSeen = false
  dessertIntroSeen = false
  eveningIntroSeen = false
  /** 生日信读完后的收尾视频是否已经看过（避免读档重进又播一遍） */
  finaleVideoSeen = false
}

export const state = new GameState()

// 开始新游戏：就地重置（保持引用不变，各场景 import 的 state 依然指向同一对象）
export function resetState() {
  state.phase = 'intro'
  state.flowers = []
  state.items = []
  state.giftWrapped = false
  state.toppings = []
  state.dessertMaterials = []
  state.dessertDone = false
  state.decorations = []
  state.surprised = false
  state.letterRead = false
  state.introSeen = false
  state.boxIntroSeen = false
  state.wrapSeen = false
  state.dessertIntroSeen = false
  state.eveningIntroSeen = false
  state.finaleVideoSeen = false
  state.talkedTo = []
  state.received = []
}

export const FLOWERS = ['pink', 'purple', 'white']
export const FLOWER_LABEL: Record<string, string> = {
  pink: '粉色花',
  purple: '紫色花',
  white: '白色花'
}

// 第二章需要寻找的物品
export const BOX_ITEMS = ['ribbon', 'starDeco', 'wrapPaper', 'hanging']
export const BOX_ITEM_LABEL: Record<string, string> = {
  ribbon: '彩带',
  starDeco: '小星星装饰',
  wrapPaper: '包装纸',
  hanging: '小挂件'
}

// 第三章食材
export const DESSERT_ITEMS = ['apple', 'strawberry', 'cream', 'chocolate', 'icing']
export const DESSERT_ITEM_LABEL: Record<string, string> = {
  apple: '苹果',
  strawberry: '草莓',
  cream: '奶油',
  chocolate: '巧克力',
  icing: '糖霜'
}

// 甜点装饰选项
export const TOPPINGS = [
  { key: 'strawberry', label: '草莓', icon: 0xff5a78 },
  { key: 'star', label: '星星', icon: 0xffd94d },
  { key: 'cream', label: '奶油', icon: 0xfff3e0 },
  { key: 'icing', label: '糖霜', icon: 0xf3b8ff },
  { key: 'horseshoe', label: '小马蹄铁', icon: 0x53d8d0 }
]

// 第四章布置任务
export const DECOR_TASKS = ['lights', 'flowers', 'table', 'gift', 'dessert', 'stars', 'ribbons']
export const DECOR_LABEL: Record<string, string> = {
  lights: '挂灯',
  flowers: '放花',
  table: '摆桌子',
  gift: '放礼物',
  dessert: '放甜点',
  stars: '放星星装饰',
  ribbons: '放彩带'
}
