import type { Line } from '../scenes/dialogue'
import { audioManager } from '../audio'

// ============================================================
// 各章节对话脚本（数据与逻辑分离，方便后续改写剧情）
// 注意：前 80% 剧情刻意避开“生日/礼物/蛋糕/派对”等关键词，
// 只用“今天 / 她 / 秘密 / 特别的准备 / 她应该会喜欢”等模糊表达。
// ============================================================

export const introLines: Line[] = [
  { text: '……今天的阳光，好像有一点不一样。' },
  { who: 'starberry', text: '嗯……' },
  { who: 'starberry', text: '时间，刚刚好。' },
  { who: 'starberry', text: '今天，好像有点重要。' },
  { who: 'starberry', text: '先把这个藏起来。' },
  { text: '（星莓悄悄把小盒子藏到了枕头下。）' },
  { who: 'starberry', text: '紫悦说过，东西要先藏好，计划才不会露馅。' },
  { who: 'starberry', text: '……先看看日历，确认一下时间吧。' },
  { text: '（桌上的日历被翻了过去，只露出一个小小的、圆圆的记号。）' }
]

export const introBoxProbe: Line[] = [
  { text: '（你：这个盒子是什么？）' },
  { who: 'starberry', text: '秘密。' },
  { text: '（你：不能看看？）' },
  { who: 'starberry', text: '现在还不行。' },
  { who: 'starberry', text: '走吧，我们去花园。' }
]

export const introCalendar: Line[] = [
  { text: '（日历被翻了过去，只露出一个小小的、圆圆的记号。）' },
  { who: 'starberry', text: '唔……还差一点时间。' },
  { who: 'starberry', text: '刚刚好，来得及。' }
]

// —— 第一章 花园 ——
export const gardenIntro: Line[] = [
  { text: '清晨的花园，露珠闪闪发光。' },
  { text: '柔柔正在花丛边，轻轻和一只小蝴蝶说话。' },
  { who: 'starberry', text: '要找到几朵特别的花……' },
  { who: 'starberry', text: '这个颜色，应该很适合。' },
  { text: '（先去找柔柔吧——她最懂花了。）' }
]

// 第一章剧情门槛：柔柔交代三朵花的用意（对应三位朋友）
export const fluttershyBrief: Line[] = [
  { who: 'fluttershy', text: '啊……星莓，早、早上好。' },
  { who: 'fluttershy', text: '你、你今天要采花吗？我帮你吧……' },
  { who: 'starberry', text: '好呀，谢谢你，柔柔。' },
  { who: 'fluttershy', text: '粉色是给温柔的，紫色是给安静的，白色……是给最干净的那份心意的。' },
  { who: 'fluttershy', text: '三朵就够了哦。多了，收花的人会不好意思的。' },
  { who: 'starberry', text: '嗯。那我认真地挑三朵。' },
  { who: 'fluttershy', text: '（小声）她一定会喜欢的……' }
]

export const flowerHints: Record<string, string> = {
  pink: '这个颜色，粉粉的，很温柔。',
  purple: '紫色……像傍晚的天空。',
  white: '白色，干干净净的，刚刚好。'
}

export const gardenDone: Line[] = [
  { who: 'fluttershy', text: '花都齐啦……好漂亮。' },
  { who: 'starberry', text: '嗯，谢谢你，柔柔。' },
  { who: 'fluttershy', text: '希望她今天，会开心。' },
  { text: '（“她”是谁？星莓没有说。）' },
  { who: 'starberry', text: '我们回小屋吧。' }
]

// —— 第二章 神秘盒子 ——
export const boxIntro: Line[] = [
  { text: '星莓的小屋。桌上放着一个盒子。' },
  { text: '盒子上有星星、丝带，还有一个小小的马蹄铁。' },
  { who: 'starberry', text: '这个，现在不能打开。' },
  { text: '玩家：为什么？' },
  { who: 'starberry', text: '因为还没到时候。' },
  { who: 'starberry', text: '先把包装要用的东西找齐吧……' }
]

// 第二章剧情门槛：紫悦来对计划（顺便给"保密"这件事一个理由）
export const twilightBrief: Line[] = [
  { text: '（门铃响了。紫悦抱着一卷纸站在门口。）' },
  { who: 'twilight', text: '星莓，我核对过时间表了。' },
  { who: 'twilight', text: '花园的花、苹果园的甜点、还有晚上那间小屋……顺序都对得上。' },
  { who: 'starberry', text: '紫悦，你、你小声一点啦。' },
  { who: 'twilight', text: '放心。这个计划只有我们几个知道。' },
  { who: 'starberry', text: '那……那个盒子呢？' },
  { who: 'twilight', text: '先找个稳妥的地方放好。' },
  { who: 'twilight', text: '至于包装要用的小东西——彩带、星星、包装纸、挂件，一样都不能少。' },
  { who: 'starberry', text: '嗯，交给我吧。' },
  { who: 'twilight', text: '（紫悦笑了一下，把那张时间表折好收进鞍包。）' }
]

export const boxItemHints: Record<string, string> = {
  ribbon: '（一条柔软的彩带。）',
  starDeco: '（一颗亮晶晶的小星星。）',
  wrapPaper: '（一张香香的花纹包装纸。）',
  hanging: '（一个可爱的小挂件。）'
}

export const rarityWrap: Line[] = [
  { who: 'rarity', text: '亲爱的，你终于来了。' },
  { who: 'rarity', text: '包装这种事，当然要交给我。' },
  { who: 'rarity', text: '这个颜色不行……再换一个。' },
  { who: 'rarity', text: '嗯……这个，才适合。' },
  { who: 'starberry', text: '你觉得她会喜欢吗？' },
  { who: 'rarity', text: '亲爱的，这是秘密。' },
  { who: 'rarity', text: '有些惊喜，如果提前知道了，就不能叫惊喜了。' },
  { who: 'rarity', text: '（说完，珍奇优雅地转身走开。）' },
  { text: '……她到底在给谁准备？' }
]

// —— 第三章 特别甜点 ——
export const dessertIntro: Line[] = [
  { text: '苹果嘉儿的苹果园。果实红扑扑的。' },
  { text: '篮子里堆满了刚摘下来的材料，碧琪在旁边蹦来蹦去。' },
  { who: 'applejack', text: '嘿，你可算来了。' },
  { who: 'applejack', text: '东西都给你备齐了——苹果、草莓、奶油、巧克力、糖霜。' },
  { who: 'starberry', text: '谢谢你，苹果嘉儿。' },
  { text: '（先去找苹果嘉儿吧。）' }
]

// 第三章剧情门槛：苹果嘉儿交代材料，碧琪差点说漏嘴
export const orchardBrief: Line[] = [
  { who: 'applejack', text: '材料是我一样一样挑的，五样，一样都不能少。' },
  { who: 'pinkie', text: '星莓星莓！我闻到甜甜的味道啦！' },
  { who: 'pinkie', text: '是不是要做那个——那个给她准备的——' },
  { who: 'applejack', text: '碧琪。' },
  { who: 'pinkie', text: '……普通的小甜点！对，普通的小甜点！' },
  { who: 'starberry', text: '（小声）谢谢你，碧琪。' },
  { who: 'applejack', text: '好了好了，先去把材料收齐。' },
  { who: 'applejack', text: '这可是特别准备的，可不能马虎。' }
]

export const dessertItemHints: Record<string, string> = {
  apple: '（一个饱满的红苹果。）',
  strawberry: '（一颗甜甜的草莓。）',
  cream: '（一罐香香的奶油。）',
  chocolate: '（一块融化的巧克力。）',
  icing: '（一小碗糖霜。）'
}

export const dessertCook: Line[] = [
  { who: 'applejack', text: '材料齐了，来吧。' },
  { who: 'applejack', text: '星莓的特别甜点，开工！' }
]

export const dessertDone: Line[] = [
  { who: 'starberry', text: '希望她喜欢……' },
  { text: '（玩家：今天到底是什么日子？）' },
  { who: 'applejack', text: '嘿嘿，快到了。' },
  { text: '（玩家：快到什么？）' },
  { who: 'applejack', text: '秘密。' },
  { who: 'applejack', text: '时间不早啦，去小屋看看吧。' }
]

// —— 第四章 傍晚小屋 ——
export const eveningIntro: Line[] = [
  { text: '傍晚，一间原本空荡荡的小屋。' },
  { text: '朋友们说过：布置的东西，她们各自都会带一份来。' },
  { who: 'starberry', text: '还差一点点……就能准备好了。' },
  { who: 'starberry', text: '先跟大家打个招呼，把东西收齐吧。' }
]

// 和每位朋友打招呼：她们各自把准备好的东西交给星莓
export const eveningGreet: Record<string, Line[]> = {
  twilight: [
    { who: 'twilight', text: '灯串我按图纸算过长度了，刚好绕一圈；桌布也带来了。' },
    { who: 'twilight', text: '交给你布置——你比我更清楚哪里好看。' }
  ],
  rainbow: [
    { who: 'rainbow', text: '星星装饰，我飞了三趟才挑到最亮的一批！' },
    { who: 'rainbow', text: '……顺便，我去门口看了两回，她还没来。放心。' }
  ],
  pinkie: [
    { who: 'pinkie', text: '甜点在这里！我一路小跑过来的，一点都没歪！' },
    { who: 'pinkie', text: '我发誓我没有偷吃……好吧，只尝了一小口。' },
    { who: 'pinkie', text: '对了，彩带也在我这儿！珍奇说配色只能她来定，让我先保管。' }
  ],
  rarity: [
    { who: 'rarity', text: '彩带我挑了很久。朱红配粉色，才对得上这间屋子。' },
    { who: 'rarity', text: '记住，左边高一点，右边低一点。这叫层次。' }
  ],
  fluttershy: [
    { who: 'fluttershy', text: '花……我帮你养了一天，它们现在最有精神。' },
    { who: 'fluttershy', text: '小动物们也想来看，我让它们在外面等着。' }
  ],
  applejack: [
    { who: 'applejack', text: '礼物我先替你摆在桌上了，别一直抱着。' },
    { who: 'applejack', text: '包得真好看。珍奇那双手，啥都包得漂亮。' }
  ]
}

// —— 第五章 她来了 ——
export const knockLines: Line[] = [
  { text: '夜晚。小屋外，星光安静。' },
  { text: '窗帘拉得严严实实，屋里只留了一盏最小的灯。' },
  { who: 'rainbow', text: '（从门缝探进头来，气声）她到街口了！我数过，就她一个！' },
  { who: 'starberry', text: '……她来了。' },
  { text: '（玩家：谁？）' },
  { who: 'starberry', text: '你，马上就知道了。' },
  { who: 'pinkie', text: '（把脸埋进抱枕里，小声）我、我现在可以喊了吗？' },
  { who: 'applejack', text: '（小声）还没到。再等一下下。' },
  { text: '（星莓笑了。她伸手，把灯拧到最暗。）' }
]

// 门前的最后两次心跳：珍奇检查，紫悦数拍子
export const doorCheckLines: Line[] = [
  { who: 'rarity', text: '（压低声音）彩带左边高了半指。罢了……来不及了，就这样。' },
  { who: 'twilight', text: '（气声）都听好。门一开，我数三下。' },
  { who: 'rainbow', text: '（气声）三下之后我就不客气了！' },
  { who: 'pinkie', text: '（气声，破音）好——' },
  { who: 'applejack', text: '（气声）碧琪！' },
  { text: '（房间里安静下来。只剩心跳，和门外的脚步声。）' }
]

// 她推门之前
export const quietLines: Line[] = [
  { text: '（三下敲门声之后，脚步声停在门口。）' },
  { who: 'starberry', text: '（声音很轻）……这一次，换我为你准备。' }
]

export const twilightHelper: Line[] = [
  { who: 'twilight', text: '星莓，你来了。' },
  { who: 'starberry', text: '紫悦，我准备得怎么样？' },
  { who: 'twilight', text: '按照计划，一切顺利。' },
  { text: '（玩家：什么计划？）' },
  { who: 'twilight', text: '嗯……这个嘛……' },
  { who: 'twilight', text: '（紫悦笑着，用魔法轻轻消失了。）' }
]

export const rainbowHelper: Line[] = [
  { who: 'rainbow', text: '放心！这种事情交给我！' },
  { text: '（云宝“咻——”地飞走了。）' },
  { text: '（几秒后，她又飞了回来。）' },
  { who: 'rainbow', text: '差点忘了，不能让她发现！' },
  { who: 'rainbow', text: '嘘——我什么都没说！' }
]

export const pinkieHelper: Line[] = [
  { who: 'pinkie', text: '星莓！碧琪来帮忙啦！' },
  { who: 'starberry', text: '碧琪，你一定不能说出去。' },
  { who: 'pinkie', text: '放心！我绝对不会告诉她今天是她的——' },
  { who: 'twilight', text: '碧琪。' },
  { who: 'applejack', text: '碧琪！！' },
  { who: 'pinkie', text: '……她的普通的一天。' },
  { who: 'pinkie', text: '（深吸一口气）我、我什么都没说！' }
]

export const rarityHelper: Line[] = [
  { who: 'rarity', text: '这里，还需要一点装饰。' },
  { who: 'rarity', text: '把那串彩灯往左移一点点……完美。' }
]

export const fluttershyHelper: Line[] = [
  { who: 'fluttershy', text: '小动物们也准备好了。' },
  { who: 'fluttershy', text: '它们都很期待呢。' }
]

export const applejackHelper: Line[] = [
  { who: 'applejack', text: '甜点也完成了。' },
  { who: 'applejack', text: '就等今晚了。' }
]

export const eveningMonologue: Line[] = [
  { text: '（房间里渐渐亮起来。音乐安静下来。）' },
  { who: 'starberry', text: '终于，准备好了。' },
  { text: '（停顿。）' },
  { who: 'starberry', text: '认识她这么久……其实有好多话，一直没有认真说过。' },
  { text: '（房间里，是你今天帮忙准备的一切——花、礼物、甜点、星星。）' }
]

// —— 终章 惊喜 ——
export const surpriseLines: Line[] = [
  { text: '咚。' },
  { text: '咚。' },
  { text: '吱呀——门被推开了。' },
  { text: '（屏幕骤然亮起。彩灯、星星、花朵，全都亮了起来。）' }
]

// 终章合唱：每位小马用自己的声线说一句"生日快乐"，最后所有人一起唱。
// who 决定头像与名字；onShown 里触发那一声合成人声（见 audio.sayAs）。
const BIRTHDAY_CAST = ['twilight', 'rainbow', 'pinkie', 'fluttershy', 'applejack', 'rarity', 'starberry'] as const

const birthdayLine = (who: string): Line =>
  who === 'starberry'
    ? { who, text: '生日快乐。', onShown: () => audioManager.sayAs(who) }
    : { who, text: '生日快乐！', onShown: () => audioManager.sayAs(who) }

export const birthdayShout: Line[] = [
  { who: 'twilight', text: '准备好了！' },
  { who: 'rainbow', text: '一、二、三——' },
  // 每个人各说一次
  ...BIRTHDAY_CAST.map(birthdayLine),
  // 然后所有人一起唱（这句之后不再重复"生日快乐"四个字，避免观感上说了三遍）
  {
    text: '所有人：生日快乐——！',
    onShown: () => audioManager.sayChorus([...BIRTHDAY_CAST])
  },
  { text: '新的一岁，也要开开心心。' }
]
