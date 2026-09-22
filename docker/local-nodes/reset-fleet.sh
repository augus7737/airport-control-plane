#!/usr/bin/env bash
# 重建本地假节点集群并走真实 bootstrap 流程注册。密码从控制面容器日志取，不落盘。
# 用法： ./reset-fleet.sh [--fresh]   --fresh 会清空 e2e 数据卷回到初始状态
set -euo pipefail

cd "$(dirname "$0")"
API=http://127.0.0.1:8081
JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

# 每台节点 6 段： container|hostname|region|provider|role|public_ipv4
# 三台容器共用宿主机出口 IP，会被发布前的端口冲突检查拦下，所以用 TEST-NET-3（203.0.113.0/24）
# 给每台一个独立公网 IP 模拟真实 VPS；该地址不可达，业务端口探测失败属预期，不是产品缺陷。
FLEET=${FLEET:-"node-hk|hk-01|香港|Vultr|direct|203.0.113.11|node-sg|sg-01|新加坡|RackNerd|direct|203.0.113.12|node-us|us-01|IAD|BandwagonHost|direct|203.0.113.13"}

if [ "${1:-}" = "--fresh" ]; then
  docker compose down -v >/dev/null 2>&1 || true
fi

IFS='|' read -ra SPEC <<< "$FLEET"
CONTAINERS=()
for ((i = 0; i < ${#SPEC[@]}; i += 6)); do
  CONTAINERS+=("${SPEC[i]}")
done

docker compose up -d --build --force-recreate "${CONTAINERS[@]}" >/dev/null
sleep 15

docker compose up -d control-plane >/dev/null
sleep 6

PASSWORD=$(docker compose logs --no-log-prefix control-plane 2>&1 | grep -o 'password=[^ ]*' | tail -1 | cut -d= -f2)
[ -n "$PASSWORD" ] || { echo "控制面没有临时密码，可能已配置正式凭据"; exit 1; }

curl -fsS -c "$JAR" -X POST "$API/api/v1/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"username\":\"admin\",\"password\":\"$PASSWORD\"}" >/dev/null

# 平台私钥必须在注册之前存在，否则 init 任务会卡在"平台尚未配置可用 SSH 私钥"且没有补救入口。
curl -fsS -b "$JAR" -X POST "$API/api/v1/platform/ssh-key/generate" >/dev/null 2>&1 || true

TOKEN=$(curl -fsS -b "$JAR" -X POST "$API/api/v1/bootstrap-tokens" \
  -H 'content-type: application/json' -d '{"note":"local e2e fleet","max_uses":20}' \
  | sed -n 's/.*"token": "\([^"]*\)".*/\1/p' | head -1)
[ -n "$TOKEN" ] || { echo "签发 bootstrap 令牌失败"; exit 1; }

IFS='|' read -ra SPEC <<< "$FLEET"
for ((i = 0; i < ${#SPEC[@]}; i += 6)); do
  container=${SPEC[i]}
  name=${SPEC[i + 1]}
  region=${SPEC[i + 2]}
  provider=${SPEC[i + 3]}
  role=${SPEC[i + 4]}
  public_ip=${SPEC[i + 5]}
  ip=$(docker compose exec -T "$container" hostname -i | tr -d '[:space:]')
  echo "== $container ($name) ip=$ip public=$public_ip region=$region"
  docker compose exec -T "$container" sh -c \
    "curl -fsSL http://control-plane:8080/bootstrap.sh | sh -s -- \
      --server http://control-plane:8080 --token $TOKEN \
      --hostname $name --region '$region' --provider $provider --role $role \
      --public-ipv4 $public_ip --private-ipv4 $ip" 2>&1 | tail -1
done

sleep 30
curl -fsS -b "$JAR" "$API/api/v1/nodes" | python3 -c '
import json,sys
items = json.load(sys.stdin)["items"]
print(f"nodes={len(items)}")
for node in items:
    print(" ", node["facts"]["hostname"], node["status"], node["health_score"], node.get("init_status"), node["labels"])
'
