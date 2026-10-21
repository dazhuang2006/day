// 提取台词时的桩模块：替换 phaser 与 audioManager，避免把浏览器代码拖进 Node。
// 只提供被引用到的字段，行为为空。
export const audioManager = new Proxy(
  {},
  {
    get: () =>
      new Proxy(() => undefined, {
        get: () => () => undefined,
        apply: () => undefined
      })
  }
)

export default new Proxy(
  {},
  {
    get: () => () => undefined
  }
)
