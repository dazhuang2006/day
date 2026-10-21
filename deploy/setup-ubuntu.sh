#!/usr/bin/env bash
# 全新 Ubuntu 上一键装好 nginx 并配好《星莓的一天》的站点。
#
# 用法（在服务器上，root 身份）：
#   bash setup-ubuntu.sh
#
# 前提：游戏文件已经放到 /var/www/starberry（脚本会检查，没有就提示你上传）。
# 只监听 80 端口（用 IP 访问；裸 IP 无法申请 HTTPS 证书）。
set -euo pipefail

SITE_DIR="${SITE_DIR:-/var/www/starberry}"
SITE_NAME="${SITE_NAME:-starberry}"

echo "==> 1/5 安装 nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx >/dev/null

echo "==> 2/5 检查站点目录 ${SITE_DIR}"
mkdir -p "${SITE_DIR}"
if [ ! -f "${SITE_DIR}/index.html" ]; then
  echo "!! ${SITE_DIR}/index.html 不存在。"
  echo "   请先在本地执行 npm run build，然后把 dist/ 里的内容传到 ${SITE_DIR}："
  echo "   scp -r dist/* root@<服务器IP>:${SITE_DIR}/"
  echo "   （传完再重新运行本脚本）"
  exit 1
fi

echo "==> 3/5 写入 nginx 站点配置"
cat > "/etc/nginx/sites-available/${SITE_NAME}" <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /var/www/starberry;
    index index.html;
    charset utf-8;

    # ------------------------------------------------------------------
    # 关键：资源路径缺失时必须返回 404，**绝不能回落到 index.html**。
    # 踩过的坑：最初写了 try_files $uri /index.html，结果游戏启动时要加载的
    # 6 个背景音乐（项目里本就没有，设计为"缺失则退回合成音乐"）被回落成
    # 200 的 HTML，Phaser 的音频加载器解码失败且永不标记完成，
    # BootScene 一直卡在 LOADING，整个游戏白屏。
    # ------------------------------------------------------------------

    # 结尾视频：必须支持分段请求，否则拖不了进度条、Safari 可能不播
    location /assets/video/ {
        try_files $uri =404;
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=2592000";
    }

    # 索引不能缓存，否则补了新配音客户端看不到
    location = /assets/audio/voice/index.json {
        try_files $uri =404;
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # 配音：文件名带内容哈希，可以长缓存
    location /assets/audio/voice/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=2592000";
    }

    location /assets/audio/ {
        try_files $uri =404;
        add_header Accept-Ranges bytes;
        add_header Cache-Control "public, max-age=604800";
    }

    # Vite 产物带哈希，永久缓存
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/javascript application/javascript
               application/json application/xml image/svg+xml;

    # 这是纯静态单页游戏，没有前端路由，找不到就老老实实 404
    location / {
        try_files $uri $uri/ =404;
    }
}
NGINX

echo "==> 4/5 启用站点并设置权限"
ln -sf "/etc/nginx/sites-available/${SITE_NAME}" "/etc/nginx/sites-enabled/${SITE_NAME}"
# 默认站点会抢 80 端口，删掉
rm -f /etc/nginx/sites-enabled/default

chown -R www-data:www-data "${SITE_DIR}"
find "${SITE_DIR}" -type d -exec chmod 755 {} \;
find "${SITE_DIR}" -type f -exec chmod 644 {} \;

echo "==> 5/5 校验并重载"
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx

echo
echo "完成。访问 http://<你的公网IP>/"
echo "如果打不开，去云厂商控制台的「安全组」放行 80 端口（TCP）。"
echo "本机测试： curl -I http://127.0.0.1/"
