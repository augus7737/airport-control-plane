#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="airport-control-plane"
SERVICE_NAME="${APP_NAME}.service"
APP_USER="airport"
APP_GROUP="airport"
APP_DIR="/opt/airport-control-plane"
DATA_DIR="${APP_DIR}/data"
ENV_DIR="/etc/airport-control-plane"
ENV_FILE="${ENV_DIR}/airport.env"
LEGACY_ENV_FILE="${APP_DIR}/.env.production"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
NODE_MAJOR="${AIRPORT_NODE_MAJOR:-20}"
MEMORY_MAX="${AIRPORT_MEMORY_MAX:-256M}"
HEALTH_ATTEMPTS="${AIRPORT_HEALTH_ATTEMPTS:-40}"
HEALTH_DELAY_SECONDS="${AIRPORT_HEALTH_DELAY_SECONDS:-3}"
ROLLBACK_DIR=""
STAGING_DIR=""
SERVICE_ROLLBACK_FILE=""
SERVICE_FILE_EXISTED=false
ACTION="install"
MIGRATE_DATA_PROD_DIR="${AIRPORT_MIGRATE_DATA_PROD:-}"
MIGRATE_ENV_FILE="${AIRPORT_MIGRATE_ENV_FILE:-}"
RUN_FULL_TESTS="${AIRPORT_RUN_FULL_TESTS:-false}"

usage() {
  cat <<'EOF'
Usage:
  sudo bash scripts/deploy-systemd.sh install [--migrate-data-prod PATH] [--migrate-env PATH] [--full-test]
  sudo bash scripts/deploy-systemd.sh update [--migrate-data-prod PATH] [--migrate-env PATH] [--full-test]

Canonical bare-metal systemd deployment for Ubuntu/Debian low-memory hosts.
Containers are intentionally not used by this script.
EOF
}

log() {
  printf '[deploy-systemd] %s\n' "$*"
}

fail() {
  printf '[deploy-systemd] ERROR: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    rm -rf "$STAGING_DIR"
  fi
  if [ -n "$SERVICE_ROLLBACK_FILE" ] && [ -f "$SERVICE_ROLLBACK_FILE" ]; then
    rm -f "$SERVICE_ROLLBACK_FILE"
  fi
}
trap cleanup EXIT

is_truthy() {
  case "${1:-}" in
    true|TRUE|yes|YES|1|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

parse_args() {
  ACTION="${1:-install}"
  case "$ACTION" in
    install|update)
      shift || true
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      fail "未知动作：$ACTION"
      ;;
  esac

  while [ "$#" -gt 0 ]; do
    case "$1" in
      --migrate-data-prod)
        shift
        if [ "$#" -eq 0 ]; then
          fail "--migrate-data-prod 需要一个路径。"
        fi
        MIGRATE_DATA_PROD_DIR="$1"
        ;;
      --migrate-data-prod=*)
        MIGRATE_DATA_PROD_DIR="${1#*=}"
        ;;
      --migrate-env)
        shift
        if [ "$#" -eq 0 ]; then
          fail "--migrate-env 需要一个路径。"
        fi
        MIGRATE_ENV_FILE="$1"
        ;;
      --migrate-env=*)
        MIGRATE_ENV_FILE="${1#*=}"
        ;;
      --full-test)
        RUN_FULL_TESTS=true
        ;;
      *)
        fail "未知参数：$1"
        ;;
    esac
    shift
  done
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -d '\n' | tr '+/' 'AB' | cut -c1-32
    return
  fi

  dd if=/dev/urandom bs=24 count=1 2>/dev/null | base64 | tr -d '\n' | tr '+/' 'AB' | cut -c1-32
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    fail "请使用 root 或 sudo 执行。"
  fi
}

require_debian_or_ubuntu() {
  if [ ! -r /etc/os-release ]; then
    fail "无法识别系统；当前脚本只支持 Ubuntu/Debian。"
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  case " ${ID:-} ${ID_LIKE:-} " in
    *" debian "*|*" ubuntu "*) ;;
    *) fail "当前系统不是 Ubuntu/Debian family：${PRETTY_NAME:-unknown}" ;;
  esac
}

apt_install() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y --no-install-recommends "$@"
}

node_major_version() {
  node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0\n'
}

ensure_node_runtime() {
  local current_major
  current_major="$(node_major_version)"

  if [ "$current_major" -ge "$NODE_MAJOR" ] && command -v npm >/dev/null 2>&1; then
    log "Node.js $(node -v) / npm $(npm -v) 已满足要求。"
    return
  fi

  log "安装 Node.js ${NODE_MAJOR}.x 运行时。"
  apt-get update
  apt_install ca-certificates curl gnupg
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL "https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key" \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg.tmp
  mv /etc/apt/keyrings/nodesource.gpg.tmp /etc/apt/keyrings/nodesource.gpg
  chmod 0644 /etc/apt/keyrings/nodesource.gpg
  printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_%s.x nodistro main\n' "$NODE_MAJOR" \
    >/etc/apt/sources.list.d/nodesource.list
  apt-get update
  apt_install nodejs

  current_major="$(node_major_version)"
  if [ "$current_major" -lt "$NODE_MAJOR" ] || ! command -v npm >/dev/null 2>&1; then
    fail "Node.js 安装后仍不满足 >=${NODE_MAJOR}，请检查 apt 源。"
  fi
}

ensure_base_packages() {
  log "安装裸机部署所需基础包。"
  apt-get update
  apt_install ca-certificates curl git tar gzip coreutils systemd
  ensure_node_runtime
}

ensure_app_user() {
  if ! getent group "$APP_GROUP" >/dev/null 2>&1; then
    groupadd --system "$APP_GROUP"
  fi

  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --gid "$APP_GROUP" --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi
}

ensure_directories() {
  install -d -m 0755 "$APP_DIR"
  install -d -m 0750 -o "$APP_USER" -g "$APP_GROUP" "$DATA_DIR"
  install -d -m 0750 -o root -g "$APP_GROUP" "$ENV_DIR"
}

resolve_existing_path() {
  local input="$1"
  if [ -z "$input" ]; then
    return 1
  fi

  if ! readlink -f "$input"; then
    return 1
  fi
}

data_dir_has_content() {
  [ -n "$(find "$DATA_DIR" -mindepth 1 -print -quit)" ]
}

migrate_data_prod_if_requested() {
  if [ -z "$MIGRATE_DATA_PROD_DIR" ]; then
    return
  fi

  local source_dir
  source_dir="$(resolve_existing_path "$MIGRATE_DATA_PROD_DIR")" || fail "迁移源不存在：$MIGRATE_DATA_PROD_DIR"

  if [ ! -d "$source_dir" ]; then
    fail "迁移源不是目录：$source_dir"
  fi

  if [ "$source_dir" = "$DATA_DIR" ]; then
    fail "迁移源不能等于目标 data 目录：$DATA_DIR"
  fi

  if data_dir_has_content; then
    fail "目标 data 目录非空，拒绝覆盖迁移：$DATA_DIR"
  fi

  log "显式迁移旧 data-prod 数据：$source_dir -> $DATA_DIR"
  (
    cd "$source_dir"
    tar -cf - .
  ) | tar -xf - -C "$DATA_DIR"
  chown -R "$APP_USER:$APP_GROUP" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
}

write_env_file_if_missing() {
  if [ -f "$ENV_FILE" ]; then
    if [ -n "$MIGRATE_ENV_FILE" ]; then
      fail "目标环境文件已存在，拒绝覆盖显式迁移：$ENV_FILE"
    fi
    return
  fi

  if [ -n "$MIGRATE_ENV_FILE" ]; then
    local source_env
    source_env="$(resolve_existing_path "$MIGRATE_ENV_FILE")" || fail "迁移环境文件不存在：$MIGRATE_ENV_FILE"
    if [ ! -f "$source_env" ]; then
      fail "迁移环境源不是文件：$source_env"
    fi
    install -m 0640 -o root -g "$APP_GROUP" "$source_env" "$ENV_FILE"
    log "已显式迁移环境文件：$source_env -> $ENV_FILE"
    return
  fi

  if [ -f "$LEGACY_ENV_FILE" ]; then
    install -m 0640 -o root -g "$APP_GROUP" "$LEGACY_ENV_FILE" "$ENV_FILE"
    log "已从现有裸机环境文件迁移配置：$LEGACY_ENV_FILE -> $ENV_FILE"
    return
  fi

  local auth_user="${CONTROL_PLANE_AUTH_USERNAME:-admin}"
  local auth_password="${CONTROL_PLANE_AUTH_PASSWORD:-$(random_password)}"

  umask 0077
  cat >"$ENV_FILE" <<EOF
# Generated by scripts/deploy-systemd.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
PORT=${PORT:-8080}
CONTROL_PLANE_AUTH_USERNAME=${auth_user}
CONTROL_PLANE_AUTH_PASSWORD=${auth_password}
CONTROL_PLANE_SESSION_TTL_MS=${CONTROL_PLANE_SESSION_TTL_MS:-43200000}
CONTROL_PLANE_SESSION_SECURE=${CONTROL_PLANE_SESSION_SECURE:-false}
CONTROL_PLANE_SESSION_REFRESH_PERSIST_INTERVAL_MS=${CONTROL_PLANE_SESSION_REFRESH_PERSIST_INTERVAL_MS:-30000}

PLATFORM_PUBLIC_BASE_URL=${PLATFORM_PUBLIC_BASE_URL:-}
CLIENT_PUBLIC_BASE_URL=${CLIENT_PUBLIC_BASE_URL:-}
NODE_SSH_USER=${NODE_SSH_USER:-root}
DEMO_SHELL_BINARY=${DEMO_SHELL_BINARY:-/bin/sh}
AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=${AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT:-false}
OPERATION_EXECUTION_TIMEOUT_MS=${OPERATION_EXECUTION_TIMEOUT_MS:-300000}
OPERATION_OUTPUT_LIMIT_BYTES=${OPERATION_OUTPUT_LIMIT_BYTES:-128000}
OPERATION_TARGET_CONCURRENCY=${OPERATION_TARGET_CONCURRENCY:-3}
SSH_CONNECT_TIMEOUT_SECONDS=${SSH_CONNECT_TIMEOUT_SECONDS:-15}
PROBE_TCP_TIMEOUT_MS=${PROBE_TCP_TIMEOUT_MS:-4000}
PROBE_SSH_TIMEOUT_MS=${PROBE_SSH_TIMEOUT_MS:-12000}
AUTO_PROBE_ENABLED=${AUTO_PROBE_ENABLED:-true}
AUTO_PROBE_INTERVAL_MS=${AUTO_PROBE_INTERVAL_MS:-900000}
AUTO_PROBE_BATCH_SIZE=${AUTO_PROBE_BATCH_SIZE:-4}
AUTO_PROBE_MIN_GAP_MS=${AUTO_PROBE_MIN_GAP_MS:-600000}
AUTO_PROBE_JITTER_MS=${AUTO_PROBE_JITTER_MS:-10000}
TZ=${TZ:-Asia/Shanghai}
EOF
  chown root:"$APP_GROUP" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"

  log "已生成环境文件：$ENV_FILE"
  log "初始登录账号：$auth_user"
  log "初始登录密码：$auth_password"
}

validate_env_file() {
  local auth_password
  auth_password="$(read_env_value CONTROL_PLANE_AUTH_PASSWORD)"

  if [ -z "$auth_password" ]; then
    fail "CONTROL_PLANE_AUTH_PASSWORD 不能为空。"
  fi

  if [ "$auth_password" = "CHANGE_ME" ]; then
    fail "CONTROL_PLANE_AUTH_PASSWORD 仍是 CHANGE_ME，请先改成强密码。"
  fi
}

read_env_value() {
  local key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*(#|$)/ && $1 == key {
      sub(/^[^=]*=/, "", $0)
      print $0
      exit
    }
  ' "$ENV_FILE"
}

write_service_file() {
  local service_tmp
  service_tmp="$(mktemp /tmp/airport-control-plane.service.XXXXXX)"
  cat >"$service_tmp" <<EOF
[Unit]
Description=Airport Control Plane
Documentation=https://github.com/augus7737/airport-control-plane
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=${APP_USER}
Group=${APP_GROUP}
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
TimeoutStartSec=30
TimeoutStopSec=30
KillSignal=SIGTERM
MemoryMax=${MEMORY_MAX}
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=
SystemCallArchitectures=native
UMask=0077

[Install]
WantedBy=multi-user.target
EOF
  install -m 0644 "$service_tmp" "$SERVICE_FILE"
  rm -f "$service_tmp"
  chmod 0644 "$SERVICE_FILE"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null
}

backup_service_file() {
  SERVICE_FILE_EXISTED=false
  SERVICE_ROLLBACK_FILE="$(mktemp /tmp/airport-control-plane.service.rollback.XXXXXX)"

  if [ -f "$SERVICE_FILE" ]; then
    cp -a "$SERVICE_FILE" "$SERVICE_ROLLBACK_FILE"
    SERVICE_FILE_EXISTED=true
    log "保存当前 systemd unit 用于失败回滚：$SERVICE_ROLLBACK_FILE"
    return
  fi

  rm -f "$SERVICE_ROLLBACK_FILE"
  SERVICE_ROLLBACK_FILE=""
}

restore_service_file() {
  if [ "$SERVICE_FILE_EXISTED" = true ] && [ -n "$SERVICE_ROLLBACK_FILE" ] && [ -f "$SERVICE_ROLLBACK_FILE" ]; then
    log "恢复上一版 systemd unit：$SERVICE_FILE"
    cp -a "$SERVICE_ROLLBACK_FILE" "$SERVICE_FILE"
    systemctl daemon-reload || true
    systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
    return
  fi

  if [ -f "$SERVICE_FILE" ]; then
    log "移除失败部署创建的 systemd unit：$SERVICE_FILE"
    systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload || true
  fi
}

repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

copy_repo_to_staging() {
  local root
  root="$(repo_root)"
  STAGING_DIR="$(mktemp -d /tmp/airport-control-plane.candidate.XXXXXX)"

  log "准备候选版本：$STAGING_DIR"
  (
    cd "$root"
    tar \
      --exclude='./.git' \
      --exclude='./node_modules' \
      --exclude='./data' \
      --exclude='./data-prod' \
      --exclude='./.env.production' \
      -cf - .
  ) | tar -xf - -C "$STAGING_DIR"

  chown -R "$APP_USER:$APP_GROUP" "$STAGING_DIR"
}

run_as_app_user() {
  runuser -u "$APP_USER" -- "$@"
}

install_candidate_dependencies() {
  log "安装生产依赖：npm ci --omit=dev"
  (
    cd "$STAGING_DIR"
    run_as_app_user npm ci --omit=dev
  )
}

verify_candidate() {
  log "执行候选版本最低语法检查：npm run check"
  (
    cd "$STAGING_DIR"
    run_as_app_user npm run check
  )

  if is_truthy "$RUN_FULL_TESTS"; then
    log "执行候选版本完整测试：npm test"
    (
      cd "$STAGING_DIR"
      run_as_app_user npm test
    )
  else
    log "跳过完整 npm test；如需启用请设置 AIRPORT_RUN_FULL_TESTS=true 或传入 --full-test。"
  fi
}

safe_clean_app_dir() {
  if [ "$APP_DIR" != "/opt/airport-control-plane" ] || [ ! -d "$APP_DIR" ]; then
    fail "APP_DIR 安全校验失败：$APP_DIR"
  fi

  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name data \
    ! -name data-prod \
    ! -name .git \
    ! -name .env.production \
    -exec rm -rf {} +
}

create_rollback_backup() {
  if [ ! -d "$APP_DIR" ] || [ -z "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 ! -name data ! -name data-prod ! -name .git ! -name .env.production -print -quit)" ]; then
    ROLLBACK_DIR=""
    return
  fi

  ROLLBACK_DIR="$(mktemp -d /opt/airport-control-plane.rollback.XXXXXX)"
  log "保存当前版本用于失败回滚：$ROLLBACK_DIR"
  (
    cd "$APP_DIR"
    tar \
      --exclude='./data' \
      --exclude='./data-prod' \
      --exclude='./.git' \
      --exclude='./.env.production' \
      -cf - .
  ) | tar -xf - -C "$ROLLBACK_DIR"
}

set_release_permissions() {
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name data \
    ! -name data-prod \
    ! -name .git \
    ! -name .env.production \
    -exec chown -R root:"$APP_GROUP" {} +
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name data \
    ! -name data-prod \
    ! -name .git \
    ! -name .env.production \
    -exec chmod -R u=rwX,g=rX,o=rX {} +
  chown -R "$APP_USER:$APP_GROUP" "$DATA_DIR"
  chmod 0750 "$DATA_DIR"
}

activate_candidate() {
  safe_clean_app_dir
  (
    cd "$STAGING_DIR"
    tar -cf - .
  ) | tar -xf - -C "$APP_DIR"
  set_release_permissions
}

service_port() {
  local port_value
  port_value="$(read_env_value PORT)"
  printf '%s\n' "${port_value:-8080}"
}

health_url() {
  printf 'http://127.0.0.1:%s/healthz\n' "$(service_port)"
}

print_recent_logs() {
  journalctl -u "$SERVICE_NAME" -n 120 --no-pager >&2 || true
}

wait_for_health() {
  local url attempt
  url="$(health_url)"
  log "等待服务健康就绪：$url"

  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if systemctl is-active --quiet "$SERVICE_NAME" && curl -fsS "$url" >/dev/null 2>&1; then
      log "服务已健康。"
      return 0
    fi

    if systemctl is-failed --quiet "$SERVICE_NAME"; then
      log "服务进入 failed 状态，最近日志如下：" >&2
      print_recent_logs
      return 1
    fi

    sleep "$HEALTH_DELAY_SECONDS"
  done

  log "服务未在预期时间内通过健康检查，最近日志如下：" >&2
  print_recent_logs
  return 1
}

rollback_activation() {
  restore_service_file

  if [ -z "$ROLLBACK_DIR" ] || [ ! -d "$ROLLBACK_DIR" ]; then
    log "没有可回滚版本；已停止未通过验证的服务。"
    systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
    return
  fi

  log "恢复上一版代码并重启服务。"
  safe_clean_app_dir
  (
    cd "$ROLLBACK_DIR"
    tar -cf - .
  ) | tar -xf - -C "$APP_DIR"
  find "$APP_DIR" -mindepth 1 -maxdepth 1 \
    ! -name .git \
    ! -name data-prod \
    ! -name .env.production \
    -exec chown -R root:"$APP_GROUP" {} +
  set_release_permissions
  systemctl restart "$SERVICE_NAME" || true
  wait_for_health || true
}

restart_and_verify() {
  systemctl restart "$SERVICE_NAME"
  if ! wait_for_health; then
    return 1
  fi
}

rollback_deploy_failure() {
  local exit_code="$?"
  trap - ERR

  log "部署失败，尝试恢复旧代码和旧 systemd unit。"
  rollback_activation || true
  fail "新版本未通过部署验证或健康检查，已尝试回滚。原始退出码：$exit_code"
}

enable_deploy_rollback() {
  trap rollback_deploy_failure ERR
}

disable_deploy_rollback() {
  trap - ERR
}

deploy() {
  require_root
  require_debian_or_ubuntu
  ensure_base_packages
  ensure_app_user
  ensure_directories
  migrate_data_prod_if_requested
  write_env_file_if_missing
  validate_env_file
  copy_repo_to_staging
  install_candidate_dependencies
  verify_candidate
  create_rollback_backup
  backup_service_file
  enable_deploy_rollback
  write_service_file
  activate_candidate
  restart_and_verify
  disable_deploy_rollback

  log "部署完成：$(health_url)"
  log "工作目录：$APP_DIR"
  log "环境文件：$ENV_FILE"
}

main() {
  parse_args "$@"
  deploy
}

main "$@"
