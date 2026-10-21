# 部署指南

《星莓的一天》是**纯静态网页**（Phaser + Vite），没有后端、没有数据库，
任何能托管静态文件的服务器都能跑。

---

## 快速开始（全新 Ubuntu + 只有 IP，无域名）

适用：刚买的机器，什么都没装，**用 `http://IP` 访问**（裸 IP 无法申请 HTTPS 证书）。

### 1) 本地构建

```powershell
npm run build
```

### 2) 上传到服务器

先在服务器上建目录（SSH 登录后执行一次）：

```bash
sudo mkdir -p /var/www/starberry
```

在**本地 Windows** 上传（PowerShell 直接可用，`scp` 是系统自带的）：

```powershell
scp -r dist/* root@123.56.42.98:/var/www/starberry/
```

> 文件多、体积大时用 rsync 更好（断点续传）：
> `rsync -avz --progress dist/ root@123.56.42.98:/var/www/starberry/`
> 没有 rsync 就用 WinSCP 拖拽，一样。

### 3) 服务器上一键装 nginx

把 `deploy/setup-ubuntu.sh` 传上去执行：

```powershell
scp deploy/setup-ubuntu.sh root@123.56.42.98:/root/
```

```bash
ssh root@123.56.42.98
bash /root/setup-ubuntu.sh
```

脚本会：装 nginx → 写站点配置（含视频分段请求、缓存、gzip）→ 设权限 → 重载。

### 4) 放行 80 端口

阿里云/腾讯云默认**安全组不放行 80**，这一步漏了的话浏览器会一直转圈。

控制台 → 云服务器 → 安全组 → 入方向 → 添加规则：
协议 **TCP**，端口 **80**，授权对象 **0.0.0.0/0**。
（22 端口通常已开放，否则你 SSH 也连不上。）

### 5) 访问

```
http://123.56.42.98/
```

**注意用 `http://` 不是 `https://`**。裸 IP 没有证书，HTTPS 必然打不开。
（本机服务器上可先 `curl -I http://127.0.0.1/` 确认 nginx 正常。）

---

## 0. 先构建

```bash
npm install          # 第一次需要
npm run build        # 产出 dist/
```

`npm run build` 做三件事：类型检查（tsc）→ 打包（vite build）→ **复制静态资源**（tools/copy-assets.mjs）。

> 最后那步很关键。资源放在项目根目录的 `assets/` 下（音频、配音、结尾视频），
> 而 Vite 默认只复制 `public/`，不做这一步的话 `dist` 里会**没有声音和画面**，
> 部署上去就是个空壳。

构建完成后 `dist/` 约 **193 MB**（其中结尾视频 177 MB）。

---

## 1. 只上传 `dist/`

要传的只有 `dist/` 目录。**不要**上传这些：

| 别传 | 原因 |
|---|---|
| `node_modules/` | 依赖，服务器上不需要 |
| `src/`、`index.html`、`vite.config.ts` | 源码，已经被打包进 dist |
| `refs/` | 中间产物（人声轨、转写、备份），700+ MB |
| `character_clips_v2/` | 角色片段和视频，100+ MB |
| `tools/` | 开发/生成脚本 |

```bash
# 本地打包后传上去（把 user@host 和路径换成你的）
scp -r dist/* user@your-server:/var/www/starberry/
```

体积大时用 rsync（断点续传、增量）：

```bash
rsync -avz --progress dist/ user@your-server:/var/www/starberry/
```

---

## 2. 用 nginx 托管

配置文件示例见 `deploy/nginx.conf.example`，核心几点：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    root /var/www/starberry;
    index index.html;

    # 视频要支持分段请求，否则拖动进度条会失效
    location /assets/video/ {
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=2592000";
    }

    # 配音文件多、体积小，缓存久一点
    location /assets/audio/voice/ {
        add_header Cache-Control "public, max-age=2592000";
    }

    # 索引文件别缓存，否则补了新配音客户端看不到
    location = /assets/audio/voice/index.json {
        add_header Cache-Control "no-cache";
    }

    # 文本资源开压缩（js/css/json），能省一半以上
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/javascript;

    # 静态游戏没有前端路由，找不到就老实 404。
    # 千万别写 try_files $uri /index.html —— 见下面的"白屏"说明。
    location / {
        try_files $uri $uri/ =404;
    }
}
```

### ⚠️ 最容易踩的坑：不能把缺失资源回落成 index.html

如果你习惯性写了 `try_files $uri $uri/ /index.html;`（SPA 常见写法），**游戏会白屏**。

原因：游戏启动时要加载 6 个背景音乐（`assets/audio/morning.mp3` 等），这些文件项目里本来就没有，
设计上是"缺失就退回合成音乐"。在 404 的情况下 Phaser 判定加载失败、正常继续；
但回落成 **200 的 HTML** 后，Phaser 的音频加载器拿到 HTML 解码失败，**这个文件永远不会被标记完成**，
于是 `load.isLoading()` 持续为真，`BootScene` 卡死在 LOADING，整个游戏停在白屏。

所以所有 `/assets/` 路径都要 `try_files $uri =404;`。

验证方法：

```bash
curl -o /dev/null -s -w "%{http_code}\n" http://<你的地址>/assets/audio/morning.mp3
# 必须输出 404。如果输出 200，就是回落配置又犯了。
```

放好后：

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/starberry
sudo ln -s /etc/nginx/sites-available/starberry /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**首次部署后务必检查权限**（否则 403）：

```bash
sudo chown -R www-data:www-data /var/www/starberry
sudo find /var/www/starberry -type d -exec chmod 755 {} \;
sudo find /var/www/starberry -type f -exec chmod 644 {} \;
```

---

## 3. 上 HTTPS（强烈建议）

浏览器在 HTTP 下对音频自动播放限制更严，而且有些功能（全屏 API）体验也更好。

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

---

## 4. 中国大陆服务器要注意备案

如果服务器在中国大陆（阿里云/腾讯云/华为云等）：

- **绑定域名 + 80/443 端口，需要 ICP 备案**，否则运营商会拦截，域名打不开。
- 没备案时，用 **IP + 端口**（例如 `http://1.2.3.4:8080`）通常可以直接访问，
  但部分厂商对未备案的 80 端口有额外限制。
- 服务器在境外（香港/海外）则不需要备案，但访问速度取决于线路。

---

## 5. 后续更新（GitHub 流程）

思路：**源码走 Git，大文件留在服务器**。

### 为什么视频不能进 Git

- 结尾视频 177 MB，**GitHub 单文件硬上限 100 MB**，推不上去
- 仓库体积膨胀后克隆会非常慢

所以 `.gitignore` 已经把 `assets/video/*.mp4`、`dist/`、`refs/`、`character_clips_v2/`、
`applejack_voice/`、`clips/`、`node_modules/` 全部排除。仓库只有约 **13 MB**
（源码 + 配音音频 + 文档），视频单独放服务器。

### 一次性准备

**① 本地建仓库并推送**（仓库请设为 **private**，里面有商业歌曲/MV）

```powershell
# 第一次需要登录（浏览器授权）
gh auth login

# 创建私有仓库并推送
gh repo create starberry --private --source=. --remote=origin --push
```

不用 gh 的话，先在网页上建空仓库，然后：

```powershell
git remote add origin https://github.com/<你的用户名>/starberry.git
git push -u origin main
```

**② 服务器装 git 和 Node**

```bash
sudo apt-get update -qq && sudo apt-get install -y git nodejs npm
node -v && npm -v
```

> 构建只需要 Node 18+。Ubuntu 24.04 自带的就够。

**③ 服务器克隆仓库**

```bash
cd ~
git clone https://github.com/<你的用户名>/starberry.git
cd starberry
```

**④ 把视频放到仓库目录里**（不进 Git，但构建时要能读到）

```bash
mkdir -p ~/starberry/assets/video
cp /var/www/starberry/assets/video/finale.mp4 ~/starberry/assets/video/
```

**⑤ 首次构建发布**

```bash
bash deploy/update.sh
```

### 以后每次更新

```powershell
# 本地改完
git add -A
git commit -m "改了某某内容"
git push
```

```bash
# 服务器上
cd ~/starberry
bash deploy/update.sh
```

`deploy/update.sh` 会依次：`git pull` → `npm ci` → `npm run build` → `rsync` 到
`/var/www/starberry` → 修权限 → `nginx -t` → `reload`。

### 不想在服务器装 Node 的备选方案

本地构建好，只同步产物（视频用 `--exclude` 跳过，避免重复上传 177 MB）：

```powershell
npm run build
rsync -avz --delete --exclude 'assets/video' dist/ root@123.56.42.98:/var/www/starberry/
```

然后服务器上修一次权限：

```bash
sudo chown -R www-data:www-data /var/www/starberry
sudo find /var/www/starberry -type f -exec chmod 644 {} \;
```

### 注意

- **`.gitattributes` 已锁定换行符**：`*.sh` 强制 LF。否则 Windows 提交的脚本到 Linux 上会报
  `bad interpreter: /bin/bash^M`。
- 配音是**内容**不是产物，已经提交进仓库（`assets/audio/voice/`，约 15 MB），
  所以服务器 `git pull` 就能拿到新配音。
- 改完台词如果重新生成了配音，记得把新的 `assets/audio/voice/index.json` 一起提交。

---

## 6. 想让链接私密一些

这是一份生日礼物，可能不想被搜索引擎或陌生人翻到：

**方案 A：Basic 认证**（简单可靠）

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd guest
```

nginx 里加：

```nginx
auth_basic "Private";
auth_basic_user_file /etc/nginx/.htpasswd;
```

**方案 B：随机路径**
把文件放到 `/var/www/starberry-x7k2m9/` 这种难猜的目录，只把链接发给对方。
（注意：这只是隐藏，不是权限控制。）

**方案 C：加 `robots.txt`**
```
User-agent: *
Disallow: /
```

---

## 7. 结尾视频：码率必须低于服务器带宽

**这是最容易忽略、也最影响体验的一点。**

视频能否流畅播放，取决于**码率 vs 实际带宽**，不是文件大小。实测这台服务器的
公网带宽只有约 **3.3 Mbps**，而原始视频码率 **11.3 Mbps** —— 是带宽的 3 倍多，
播放器只能播一下等一下，就是"卡卡的"。

先测带宽（在本地执行，数字换成你的地址）：

```powershell
$ip='<你的IP>'
$req=[System.Net.HttpWebRequest]::Create("http://$ip/assets/index.js")
$req.AddRange(0, 4194303)   # 取 4MB
$sw=[System.Diagnostics.Stopwatch]::StartNew()
$r=$req.GetResponse(); $ms=New-Object System.IO.MemoryStream
$r.GetResponseStream().CopyTo($ms); $sw.Stop()
"Mbps = {0:N1}" -f ($ms.Length*8/1e6/$sw.Elapsed.TotalSeconds)
```

**视频码率要压到带宽的 50~60% 以下**，留出余量应对波动。

`refs/_web_video/` 里备好的版本：

| 文件 | 分辨率 | 码率 | 体积 | 占 3.3Mbps 带宽 | 说明 |
|---|---|---|---|---|---|
| `原片_1080p.mp4` | 1080p | 11.3 Mbps | 177 MB | 343% | ❌ 必然卡 |
| `A_1080p.mp4` | 1080p | 6.4 Mbps | 100.7 MB | 194% | ❌ 仍卡 |
| `B_720p.mp4` | 720p | 2.7 Mbps | 43.7 MB | 82% | ⚠ 偏紧 |
| `D_720p.mp4` | 720p | 1.77 Mbps | 28.9 MB | **54%** | ✅ **当前在用** |
| `C_720p_small.mp4` | 720p | 1.56 Mbps | 25.6 MB | 47% | ✅ 更省 |
| `E_540p.mp4` | 540p | 1.18 Mbps | 19.7 MB | 36% | ✅ 带宽很低时用 |

换法：

```bash
cp refs/_web_video/D_720p.mp4 assets/video/finale.mp4
npm run build
```

帧率、音轨（AAC）、`faststart`（可边下边播）都已处理好，直接换文件名即可。

重新压一版的命令（改 `-maxrate` 即可控制上限）：

```bash
ffmpeg -i 原片.mp4 -vf "scale=1280:720:flags=lanczos" \
  -c:v h264_nvenc -preset medium -rc vbr -cq 29 -b:v 0 -maxrate 2200k -bufsize 4400k \
  -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart finale.mp4
```

> 没有 NVIDIA 显卡就把 `h264_nvenc -preset medium -rc vbr -cq 29` 换成
> `libx264 -preset slow -crf 23`。

### 播放器这边也做了优化

- **读信时就开始预加载**（`preloadFinaleVideo()`），点按钮时往往已经缓冲好了
- 缓冲期间显示「缓冲中…」提示，不会让人以为卡死
- 视频元素复用同一个 `<video>`，避免重新建元素导致重新请求

---

## 8. 常见问题

**一直白屏 / 卡在"正在点亮小屋"**
最常见的原因是缺失资源被回落成了 HTML（状态 200），导致 `BootScene` 卡在 LOADING。
按上面的"最容易踩的坑"检查，确认返回 404：

```bash
curl -o /dev/null -s -w "%{http_code}\n" http://<你的地址>/assets/audio/morning.mp3
```

**首屏要等 5 秒左右才出现**
部署环境下 `BootScene` 要发 6 个音频请求（其中 5 个是预期失败的）并生成全部纹理，
比本地慢属于正常。若明显更久，看 Network 面板是否有请求一直 pending。

**画面出来了但没声音**
`assets/audio/` 没传上去，或路径不对。检查
`http://你的地址/assets/audio/voice/index.json` 能否打开（应返回 JSON）。

**结尾视频不播放**
`assets/video/finale.mp4` 404，或服务器没配 mp4 的 MIME（`video/mp4`）。
用浏览器开发者工具的 Network 面板看那个请求的状态码。

**视频能播但拖不了进度**
服务器没返回 `Accept-Ranges: bytes`，按上面配置加上。

**改了网页但对方看到的还是旧版**
浏览器缓存。`index.html` 建议不要缓存；带哈希的 `assets/index-*.js` 可以永久缓存。

**更新了配音但游戏里没生效**
`index.json` 被缓存了，按上面的配置给它加 `no-cache`；或者强制刷新（Ctrl+F5）。

---

## 9. 关于版权

游戏里有**商业歌曲和 MV**（结尾视频、背景音乐）。自己玩、送给朋友没有问题；
但**部署到公网就等于向他人提供这些内容的分发**。

如果只是把链接给寿星一个人、服务器不公开，实际风险很低；
如果打算长期公开或传播，建议把结尾视频和背景音乐换成无版权素材
（换成无版权音乐只需替换 `assets/audio/birthday.mp3`）。
