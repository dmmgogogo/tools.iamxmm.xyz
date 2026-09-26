#!/usr/bin/env bash
# 部署 tools.iamxmm.xyz 到 ops-xmm-sg
# 源文件放 /root/app/tools，nginx 实际读取 /var/www/tools.iamxmm.xyz
set -euo pipefail
cd "$(dirname "$0")"

HOST=ops-xmm-sg
APP_DIR=/root/app/tools
WEB_DIR=/var/www/tools.iamxmm.xyz

rsync -az --delete --exclude .DS_Store public deploy "$HOST:$APP_DIR/"

ssh "$HOST" 'bash -s' <<EOF
set -euo pipefail
mkdir -p $WEB_DIR
rsync -a --delete $APP_DIR/public/ $WEB_DIR/
chown -R www-data:www-data $WEB_DIR
install -m 644 $APP_DIR/deploy/nginx.conf /etc/nginx/sites-available/tools.iamxmm.xyz
ln -sf /etc/nginx/sites-available/tools.iamxmm.xyz /etc/nginx/sites-enabled/tools.iamxmm.xyz
nginx -t
systemctl reload nginx
EOF

echo "deployed: https://tools.iamxmm.xyz"
