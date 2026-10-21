import { defineConfig } from 'vite'

// 对外分享（ngrok / cloudflared 等隧道）时的注意事项：
//   1. host: true —— 必须监听 0.0.0.0，否则只能本机访问；
//   2. allowedHosts —— Vite 6 默认校验 Host 头，隧道域名会被拒（报 Blocked request）；
//   3. open: false —— 服务器环境里自动开浏览器没意义，还容易卡住启动。
// 这里用 allowedHosts 允许所有域名（本地小项目够用）；
// 想更严格就换成具体域名，例如 ['.ngrok-free.app', '.ngrok.app', '.trycloudflare.com']。
const tunnelFriendly = {
  host: true,
  open: false,
  allowedHosts: true as const
}

export default defineConfig({
  base: './',
  server: {
    ...tunnelFriendly,
    port: 5173
  },
  // vite preview 的配置在 preview 字段下
  preview: {
    ...tunnelFriendly,
    port: 4173
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2020'
  }
})
