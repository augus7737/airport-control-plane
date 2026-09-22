#!/usr/bin/env bash
# 在本地假节点集群上跑一次真实发布：模板 -> 用户 -> 发布 -> 生效 -> 订阅拉取。
# 用法： ./e2e-publish.sh [security]   security 取 none | reality | tls（默认 none）
set -euo pipefail

cd "$(dirname "$0")"
API=http://127.0.0.1:8081
SECURITY=${1:-none}
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

PASSWORD=$(docker compose logs --no-log-prefix control-plane 2>&1 | grep -o 'password=[^ ]*' | tail -1 | cut -d= -f2)
[ -n "$PASSWORD" ] || { echo "控制面没有临时密码，可能已配置正式凭据"; exit 1; }

curl -fsS -c "$JAR" -X POST "$API/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD\"}" >/dev/null

api() { curl -sS -b "$JAR" "$@"; }

NODE_IDS=$(api "$API/api/v1/nodes" | python3 -c '
import json,os,sys
want = os.environ.get("NODE_FILTER", "")
ids = [n["id"] for n in json.load(sys.stdin)["items"]
       if not want or want in (n["facts"]["hostname"] or "")]
print(",".join(ids))
')
[ -n "$NODE_IDS" ] || { echo "没有可用节点，先跑 reset-fleet.sh"; exit 1; }
echo "nodes=$NODE_IDS"

PROFILE=$(api -X POST "$API/api/v1/proxy-profiles" -H 'content-type: application/json' -d "{
  \"name\": \"e2e vless/$SECURITY $(date +%H%M%S)\",
  \"protocol\": \"vless\",
  \"security\": \"$SECURITY\",
  \"transport\": \"tcp\",
  \"listen_port\": 8443,
  \"flow\": \"xtls-rprx-vision\",
  \"server_name\": \"www.cloudflare.com\"
}")
PROFILE_ID=$(echo "$PROFILE" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("profile",{}).get("id",""))')
[ -n "$PROFILE_ID" ] || { echo "模板创建失败: $PROFILE"; exit 1; }
echo "profile=$PROFILE_ID"

USER_RESP=$(api -X POST "$API/api/v1/access-users" -H 'content-type: application/json' -d "{
  \"name\": \"e2e-user\",
  \"protocol\": \"vless\",
  \"profile_id\": \"$PROFILE_ID\"
}")
USER_ID=$(echo "$USER_RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_user",{}).get("id",""))')
[ -n "$USER_ID" ] || { echo "用户创建失败: $USER_RESP"; exit 1; }
echo "access_user=$USER_ID"

NODE_JSON=$(python3 -c 'import sys,json; print(json.dumps(sys.argv[1].split(",")))' "$NODE_IDS")
echo "== 发布中（节点上会下载 sing-box 二进制，首次约 1-2 分钟）"
api -X POST "$API/api/v1/config-releases" -H 'content-type: application/json' -d "{
  \"title\": \"e2e publish $SECURITY\",
  \"profile_id\": \"$PROFILE_ID\",
  \"access_user_ids\": [\"$USER_ID\"],
  \"node_ids\": $NODE_JSON,
  \"operator\": \"e2e\",
  \"note\": \"local docker fleet e2e\"
}" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), ensure_ascii=False, indent=2)[:3000])'

sleep 45
echo "== 发布任务日志"
api "$API/api/v1/tasks?limit=40" | python3 -c '
import json,sys
items = json.load(sys.stdin)["items"]
hits = [t for t in items if "publish" in t["type"]]
if not hits:
    print("没有发布类任务，最近任务：", [t["type"] for t in items[:10]])
for t in hits:
    print("--- %s %s %s" % (t["type"], t["status"], t["title"]))
    for line in (t.get("log_excerpt") or [])[-25:]:
        print("   ", line)
'
