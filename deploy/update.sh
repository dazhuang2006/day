#!/usr/bin/env bash
# 服务器端更新脚本：从 GitHub 拉最新源码 → 构建 → 发布到 nginx 目录。
#
# 前提（只需做一次）：
#   1. 服务器装了 git 和 Node.js
#   2. 仓库已 clone 到 $REPO_DIR
#   3. 结尾视频放在 $REPO_DIR/assets/video/finale.mp4（不进 Git，构建时会带上）
#
# 用法：
#   bash update.sh              # 拉取 + 构建 + 发布
#   bash update.sh --no-pull    # 只重新构建发布（不拉代码）
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/starberry}"
WEB_DIR="${WEB_DIR:-/var/www/starberry}"

cd "$REPO_DIR"

if [ "${1:-}" != "--no-pull" ]; then
  echo "==> 拉取最新代码"
  git fetch --all --prune
  git pull --ff-only
fi

echo "==> 安装依赖"
# 注意：不能用 --omit=dev —— vite / typescript 都在 devDependencies 里，
# 少装了就没法构建。
if [ -f package-lock.json ]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "==> 构建"
npm run build

if [ ! -f dist/index.html ]; then
  echo "!! 构建失败：dist/index.html 不存在"
  exit 1
fi

# 视频是 gitignored 的，如果服务器上没放，构建出来的 dist 里会缺，这里提醒但不中断
if [ ! -f dist/assets/video/finale.mp4 ]; then
  echo "!! 注意：dist/assets/video/finale.mp4 不存在。"
  echo "   如果游戏需要结尾视频，请把它放到 $REPO_DIR/assets/video/finale.mp4 后重新运行。"
fi

echo "==> 发布到 $WEB_DIR"
sudo mkdir -p "$WEB_DIR"
# --delete 会把服务器上多余的旧文件清掉，保证和服务端构建结果一致
sudo rsync -a --delete dist/ "$WEB_DIR"/
sudo chown -R www-data:www-data "$WEB_DIR"
sudo find "$WEB_DIR" -type d -exec chmod 755 {} \;
sudo find "$WEB_DIR" -type f -exec chmod 644 {} \;
sudo nginx -t
sudo systemctl reload nginx

echo
echo "完成。文件已发布到 $WEB_DIR"
echo "视频体积：$(du -h "$WEB_DIR/assets/video/finale.mp4" 2>/dev/null | cut -f1 || echo '未部署')"
