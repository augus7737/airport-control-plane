#!/bin/sh

set -eu
export PATH="/usr/sbin:/usr/bin:/sbin:/bin:${PATH}"

SERVER_URL=""
BOOTSTRAP_TOKEN=""
HOSTNAME_OVERRIDE=""
SSH_PORT_OVERRIDE=""
DEFAULT_SSH_PORT="19822"
SSH_PORT="$DEFAULT_SSH_PORT"
SSH_USER_OVERRIDE=""
PUBLIC_IPV4_OVERRIDE=""
PUBLIC_IPV6_OVERRIDE=""
PRIVATE_IPV4_OVERRIDE=""
PROVIDER_LABEL=""
REGION_LABEL=""
ROLE_LABEL=""
ACCESS_MODE=""
ENTRY_REGION=""
RELAY_NODE_ID=""
RELAY_LABEL=""
RELAY_REGION=""
ROUTE_NOTE=""

usage() {
  echo "Usage: sh scripts/bootstrap.sh --server <url> --token <bootstrap-token> [--hostname <name>] [--ssh-port <port>] [--ssh-user <name>] [--public-ipv4 <ip>] [--public-ipv6 <ip>] [--private-ipv4 <ip>] [--provider <name>] [--region <code>] [--role <name>] [--access-mode <direct|relay>] [--entry-region <name>] [--relay-node-id <node_id>] [--relay-label <name>] [--relay-region <code>] [--route-note <text>]"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server)
      SERVER_URL="$2"
      shift 2
      ;;
    --token)
      BOOTSTRAP_TOKEN="$2"
      shift 2
      ;;
    --hostname)
      HOSTNAME_OVERRIDE="$2"
      shift 2
      ;;
    --ssh-port)
      SSH_PORT_OVERRIDE="$2"
      shift 2
      ;;
    --ssh-user)
      SSH_USER_OVERRIDE="$2"
      shift 2
      ;;
    --public-ipv4)
      PUBLIC_IPV4_OVERRIDE="$2"
      shift 2
      ;;
    --public-ipv6)
      PUBLIC_IPV6_OVERRIDE="$2"
      shift 2
      ;;
    --private-ipv4)
      PRIVATE_IPV4_OVERRIDE="$2"
      shift 2
      ;;
    --provider)
      PROVIDER_LABEL="$2"
      shift 2
      ;;
    --region)
      REGION_LABEL="$2"
      shift 2
      ;;
    --role)
      ROLE_LABEL="$2"
      shift 2
      ;;
    --access-mode)
      ACCESS_MODE="$2"
      shift 2
      ;;
    --entry-region)
      ENTRY_REGION="$2"
      shift 2
      ;;
    --relay-node-id)
      RELAY_NODE_ID="$2"
      shift 2
      ;;
    --relay-label)
      RELAY_LABEL="$2"
      shift 2
      ;;
    --relay-region)
      RELAY_REGION="$2"
      shift 2
      ;;
    --route-note)
      ROUTE_NOTE="$2"
      shift 2
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [ -z "$SERVER_URL" ] || [ -z "$BOOTSTRAP_TOKEN" ]; then
  usage
  exit 1
fi

is_valid_port() {
  case "$1" in
    ''|*[!0-9]*)
      return 1
      ;;
  esac

  [ "$1" -ge 1 ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}

resolve_current_username() {
  if command -v id >/dev/null 2>&1; then
    id -un 2>/dev/null && return
  fi

  if command -v whoami >/dev/null 2>&1; then
    whoami && return
  fi

  echo ""
}

running_as_root() {
  if ! command -v id >/dev/null 2>&1; then
    return 1
  fi

  [ "$(id -u 2>/dev/null || echo 1)" = "0" ]
}

resolve_target_ssh_user() {
  if [ -n "$SSH_USER_OVERRIDE" ]; then
    printf '%s' "$SSH_USER_OVERRIDE"
    return
  fi

  if running_as_root; then
    printf '%s' "root"
    return
  fi

  resolve_current_username
}

resolve_user_home_dir() {
  TARGET_USER="$1"
  TARGET_HOME=""

  if [ -z "$TARGET_USER" ]; then
    printf '%s' ""
    return
  fi

  if command -v getent >/dev/null 2>&1; then
    TARGET_HOME="$(getent passwd "$TARGET_USER" 2>/dev/null | awk -F ':' 'NR == 1 { print $6 }')"
  fi

  if [ -z "$TARGET_HOME" ] && [ -r /etc/passwd ]; then
    TARGET_HOME="$(awk -F ':' -v target_user="$TARGET_USER" '$1 == target_user { print $6; exit }' /etc/passwd)"
  fi

  if [ -z "$TARGET_HOME" ] && [ "$TARGET_USER" = "$(resolve_current_username)" ]; then
    TARGET_HOME="${HOME:-}"
  fi

  if [ -z "$TARGET_HOME" ] && [ "$TARGET_USER" = "root" ]; then
    TARGET_HOME="/root"
  fi

  printf '%s' "$TARGET_HOME"
}

install_platform_public_key() {
  PUBLIC_KEY_VALUE="$1"
  TARGET_USER="$2"
  CURRENT_USER="$(resolve_current_username)"
  TARGET_HOME="$(resolve_user_home_dir "$TARGET_USER")"

  if [ -z "$TARGET_HOME" ]; then
    echo "[bootstrap] 无法确定用户 ${TARGET_USER} 的 home 目录，平台公钥写入失败。" >&2
    return 1
  fi

  if ! running_as_root && [ -n "$CURRENT_USER" ] && [ "$CURRENT_USER" != "$TARGET_USER" ]; then
    echo "[bootstrap] 当前用户 ${CURRENT_USER} 无法为 ${TARGET_USER} 写入 authorized_keys，请切到目标用户或 root 后重试。" >&2
    return 1
  fi

  mkdir -p "$TARGET_HOME/.ssh"
  chmod 700 "$TARGET_HOME/.ssh"
  touch "$TARGET_HOME/.ssh/authorized_keys"
  chmod 600 "$TARGET_HOME/.ssh/authorized_keys"

  if ! grep -Fq "$PUBLIC_KEY_VALUE" "$TARGET_HOME/.ssh/authorized_keys"; then
    printf '%s\n' "$PUBLIC_KEY_VALUE" >> "$TARGET_HOME/.ssh/authorized_keys"
  fi

  if running_as_root && command -v chown >/dev/null 2>&1; then
    chown "$TARGET_USER":"$TARGET_USER" "$TARGET_HOME/.ssh" "$TARGET_HOME/.ssh/authorized_keys" >/dev/null 2>&1 || \
      chown "$TARGET_USER" "$TARGET_HOME/.ssh" "$TARGET_HOME/.ssh/authorized_keys" >/dev/null 2>&1 || true
  fi

  echo "[bootstrap] 已写入平台公钥到 ${TARGET_HOME}/.ssh/authorized_keys (user=${TARGET_USER})" >&2
  return 0
}

if [ -n "$SSH_PORT_OVERRIDE" ] && ! is_valid_port "$SSH_PORT_OVERRIDE"; then
  echo "Invalid ssh port: $SSH_PORT_OVERRIDE" >&2
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_http_client() {
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    return
  fi

  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl >/dev/null 2>&1 || true
  fi

  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    return
  fi

  echo "Missing required command: curl or wget" >&2
  exit 1
}

http_post_json() {
  URL="$1"
  BODY="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsS -X POST "$URL" \
      -H "content-type: application/json" \
      -d "$BODY"
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO- \
      --header="content-type: application/json" \
      --post-data="$BODY" \
      "$URL"
    return
  fi

  echo "Missing required command: curl or wget" >&2
  exit 1
}

ensure_ssh_server_package() {
  if command -v sshd >/dev/null 2>&1; then
    return 0
  fi

  if command -v apk >/dev/null 2>&1; then
    apk update >/dev/null 2>&1 || true
    apk add --no-cache openssh >/dev/null 2>&1 || \
      apk add --no-cache openssh-server openssh-keygen >/dev/null 2>&1 || true
  fi

  command -v sshd >/dev/null 2>&1
}

ensure_sshd_config_line() {
  FILE_PATH="$1"
  KEY="$2"
  VALUE="$3"

  if [ ! -f "$FILE_PATH" ]; then
    return 0
  fi

  if grep -q "^[#[:space:]]*${KEY}[[:space:]]" "$FILE_PATH" 2>/dev/null; then
    sed -i "s|^[#[:space:]]*${KEY}[[:space:]].*|${KEY} ${VALUE}|" "$FILE_PATH" 2>/dev/null || true
    return 0
  fi

  printf '\n%s %s\n' "$KEY" "$VALUE" >> "$FILE_PATH"
}

read_ssh_port_from_file() {
  FILE_PATH="$1"

  if [ ! -f "$FILE_PATH" ]; then
    printf '%s' ""
    return
  fi

  awk '
    /^[[:space:]]*#/ { next }
    {
      key = tolower($1)
      if (key == "port" && $2 ~ /^[0-9]+$/) {
        port = $2
      }
    }
    END {
      if (port != "") {
        print port
      }
    }
  ' "$FILE_PATH" 2>/dev/null || true
}

write_sshd_dropin_config() {
  DROPIN_DIR="/etc/ssh/sshd_config.d"
  DROPIN_FILE="$DROPIN_DIR/99-airport-bootstrap.conf"
  DROPIN_PORT="$SSH_PORT"

  if [ ! -d "$DROPIN_DIR" ]; then
    return 0
  fi

  {
    printf '%s\n' "# Managed by airport bootstrap"
    if [ -n "$DROPIN_PORT" ] && is_valid_port "$DROPIN_PORT"; then
      printf 'Port %s\n' "$DROPIN_PORT"
    fi
    printf '%s\n' "PermitRootLogin prohibit-password"
    printf '%s\n' "PubkeyAuthentication yes"
    printf '%s\n' "PasswordAuthentication no"
  } >"$DROPIN_FILE"
}

detect_configured_ssh_port() {
  DETECTED_PORT=""

  for FILE_PATH in /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf; do
    [ -f "$FILE_PATH" ] || continue

    FILE_PORT="$(read_ssh_port_from_file "$FILE_PATH")"

    if [ -n "$FILE_PORT" ]; then
      DETECTED_PORT="$FILE_PORT"
    fi
  done

  if [ -n "$DETECTED_PORT" ] && is_valid_port "$DETECTED_PORT"; then
    printf '%s' "$DETECTED_PORT"
    return
  fi

  printf '%s' ""
}

is_local_port_listening() {
  PORT="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v port="$PORT" '
      NR > 1 {
        addr = $4
        sub(/^.*:/, "", addr)
        gsub(/[\[\]]/, "", addr)
        if (addr == port) {
          found = 1
        }
      }
      END {
        exit found ? 0 : 1
      }
    '
    return $?
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk -v port="$PORT" '
      NR > 2 {
        addr = $4
        sub(/^.*:/, "", addr)
        gsub(/[\[\]]/, "", addr)
        if (addr == port) {
          found = 1
        }
      }
      END {
        exit found ? 0 : 1
      }
    '
    return $?
  fi

  return 1
}

wait_for_local_port() {
  PORT="$1"
  ATTEMPTS="${2:-12}"
  SLEEP_SECONDS="${3:-1}"
  COUNT=0

  while [ "$COUNT" -lt "$ATTEMPTS" ]; do
    if is_local_port_listening "$PORT"; then
      return 0
    fi

    COUNT=$((COUNT + 1))
    sleep "$SLEEP_SECONDS" 2>/dev/null || true
  done

  return 1
}

ensure_ssh_server_ready() {
  if ! ensure_ssh_server_package; then
    echo "[bootstrap] 未能安装 sshd，控制面暂时无法回连当前节点。" >&2
    return 1
  fi

  install -d -m 755 /var/run/sshd /run/sshd 2>/dev/null || true

  if command -v ssh-keygen >/dev/null 2>&1; then
    ssh-keygen -A >/dev/null 2>&1 || true
  fi

  if [ -f /etc/ssh/sshd_config ]; then
    ensure_sshd_config_line /etc/ssh/sshd_config Port "$SSH_PORT"
    ensure_sshd_config_line /etc/ssh/sshd_config PermitRootLogin prohibit-password
    ensure_sshd_config_line /etc/ssh/sshd_config PubkeyAuthentication yes
    ensure_sshd_config_line /etc/ssh/sshd_config PasswordAuthentication no
  fi

  write_sshd_dropin_config

  if command -v rc-update >/dev/null 2>&1; then
    rc-update add sshd default >/dev/null 2>&1 || true
  fi

  if command -v rc-service >/dev/null 2>&1; then
    rc-service sshd restart >/dev/null 2>&1 || rc-service sshd start >/dev/null 2>&1 || true
  fi

  if command -v sshd >/dev/null 2>&1; then
    sshd >/dev/null 2>&1 || /usr/sbin/sshd >/dev/null 2>&1 || true
  fi

  if wait_for_local_port "$SSH_PORT" 12 1; then
    return 0
  fi

  echo "[bootstrap] sshd 已尝试拉起，但 ${SSH_PORT} 端口仍未监听。" >&2
  return 1
}

ensure_http_client
need_cmd uname
need_cmd hostname

if [ -n "$SSH_PORT_OVERRIDE" ]; then
  SSH_PORT="$SSH_PORT_OVERRIDE"
else
  DETECTED_SSH_PORT="$(detect_configured_ssh_port)"
  if [ -n "$DETECTED_SSH_PORT" ] && [ "$DETECTED_SSH_PORT" != "22" ]; then
    SSH_PORT="$DETECTED_SSH_PORT"
  else
    SSH_PORT="$DEFAULT_SSH_PORT"
  fi
fi

TARGET_SSH_USER="$(resolve_target_ssh_user)"

json_escape() {
  printf '%s' "$1" | awk '
    BEGIN {
      first = 1
      ORS = ""
    }
    {
      gsub(/\\/, "\\\\")
      gsub(/"/, "\\\"")
      gsub(/\r/, "\\r")
      gsub(/\t/, "\\t")
      if (!first) {
        printf "\\n"
      }
      printf "%s", $0
      first = 0
    }
  '
}

json_or_null() {
  if [ -n "$1" ]; then
    printf '"%s"' "$(json_escape "$1")"
    return
  fi

  printf 'null'
}

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
    return
  fi

  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
    return
  fi

  echo "Missing required command: sha256sum or shasum" >&2
  exit 1
}

read_os_release() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    echo "${NAME:-unknown}|${VERSION_ID:-unknown}"
    return
  fi

  echo "unknown|unknown"
}

read_cpu_cores() {
  if command -v getconf >/dev/null 2>&1; then
    getconf _NPROCESSORS_ONLN 2>/dev/null || echo 1
    return
  fi

  echo 1
}

read_memory_mb() {
  if [ -r /proc/meminfo ]; then
    awk '/MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo
    return
  fi

  echo 0
}

read_disk_gb() {
  if command -v df >/dev/null 2>&1; then
    df -Pk / 2>/dev/null | awk 'NR==2 { printf "%d", $2 / 1024 / 1024 }'
    return
  fi

  echo 0
}

read_default_ip() {
  if command -v ip >/dev/null 2>&1; then
    ip route get 1 2>/dev/null | awk '/src/ { for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }'
    return
  fi

  echo ""
}

read_default_interface() {
  if command -v ip >/dev/null 2>&1; then
    ip route get 1 2>/dev/null | awk '/dev/ { for (i = 1; i <= NF; i++) if ($i == "dev") { print $(i + 1); exit } }'
    return
  fi

  echo ""
}

read_machine_id() {
  for FILE_PATH in /etc/machine-id /var/lib/dbus/machine-id; do
    if [ -s "$FILE_PATH" ]; then
      VALUE="$(tr -d '\r\n' < "$FILE_PATH" | tr '[:upper:]' '[:lower:]' | tr -cd '0-9a-f')"
      if [ -n "$VALUE" ]; then
        printf '%s' "$VALUE"
        return
      fi
    fi
  done

  echo ""
}

read_primary_mac() {
  INTERFACE_NAME="$(read_default_interface)"

  if [ -n "$INTERFACE_NAME" ] && [ -r "/sys/class/net/$INTERFACE_NAME/address" ]; then
    tr -d '\r\n' < "/sys/class/net/$INTERFACE_NAME/address" | tr '[:upper:]' '[:lower:]'
    return
  fi

  if [ -n "$INTERFACE_NAME" ] && command -v ip >/dev/null 2>&1; then
    ip link show "$INTERFACE_NAME" 2>/dev/null | awk '/link\/ether/ { print tolower($2); exit }'
    return
  fi

  echo ""
}

trim_inline() {
  printf '%s' "$1" | tr -d '\r' | awk '
    {
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0)
      if (length($0) > 0) {
        print $0
        exit
      }
    }
  '
}

http_get_text() {
  URL="$1"
  FAMILY="${2:-}"

  if command -v curl >/dev/null 2>&1; then
    case "$FAMILY" in
      4)
        curl -4 -fsSL --connect-timeout 3 --max-time 5 "$URL"
        ;;
      6)
        curl -6 -fsSL --connect-timeout 3 --max-time 5 "$URL"
        ;;
      *)
        curl -fsSL --connect-timeout 3 --max-time 5 "$URL"
        ;;
    esac
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -qO- --timeout=5 "$URL"
    return
  fi

  return 1
}

read_cip_field() {
  TEXT="$1"
  FIELD="$2"

  printf '%s\n' "$TEXT" | awk -F ':' -v field="$FIELD" '
    {
      key = $1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
      if (key == field) {
        value = substr($0, index($0, ":") + 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
        print value
        exit
      }
    }
  '
}

is_public_ipv4() {
  VALUE="$(trim_inline "$1")"
  if ! printf '%s' "$VALUE" | awk '
    BEGIN { ok = 1 }
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {
      split($0, parts, ".")
      for (i = 1; i <= 4; i++) {
        if (parts[i] < 0 || parts[i] > 255) ok = 0
      }
      if ((parts[1] == 10) ||
          (parts[1] == 127) ||
          (parts[1] == 0) ||
          (parts[1] == 169 && parts[2] == 254) ||
          (parts[1] == 192 && parts[2] == 168) ||
          (parts[1] == 172 && parts[2] >= 16 && parts[2] <= 31)) {
        ok = 0
      }
      exit(ok ? 0 : 1)
    }
    { exit 1 }
  '; then
    return 1
  fi

  return 0
}

is_public_ipv6() {
  VALUE="$(trim_inline "$1" | tr '[:upper:]' '[:lower:]')"
  [ -n "$VALUE" ] || return 1

  case "$VALUE" in
    ::1|fe80:*|fc*|fd*)
      return 1
      ;;
  esac

  printf '%s' "$VALUE" | grep -q ':' || return 1
  return 0
}

is_ipv4_literal() {
  VALUE="$(trim_inline "$1")"

  printf '%s' "$VALUE" | awk '
    BEGIN { ok = 1 }
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/ {
      split($0, parts, ".")
      for (i = 1; i <= 4; i++) {
        if (parts[i] < 0 || parts[i] > 255) ok = 0
      }
      exit(ok ? 0 : 1)
    }
    { exit 1 }
  '
}

probe_public_ipv4() {
  PUBLIC_IPV4=""
  PUBLIC_IPV4_LOCATION=""
  PUBLIC_IPV4_OWNER=""
  PUBLIC_IPV4_SOURCE=""

  if [ -n "$PUBLIC_IPV4_OVERRIDE" ]; then
    PUBLIC_IPV4="$PUBLIC_IPV4_OVERRIDE"
    PUBLIC_IPV4_SOURCE="manual_override"
    return
  fi

  CIP_TEXT="$(http_get_text "https://www.cip.cc" 4 2>/dev/null || true)"
  CANDIDATE_IP="$(trim_inline "$(read_cip_field "$CIP_TEXT" "IP")")"

  if is_public_ipv4 "$CANDIDATE_IP"; then
    PUBLIC_IPV4="$CANDIDATE_IP"
    PUBLIC_IPV4_LOCATION="$(trim_inline "$(read_cip_field "$CIP_TEXT" "地址")")"
    PUBLIC_IPV4_OWNER="$(trim_inline "$(read_cip_field "$CIP_TEXT" "运营商")")"
    PUBLIC_IPV4_SOURCE="cip.cc"
    return
  fi

  CANDIDATE_IP="$(trim_inline "$(http_get_text "https://api.ipify.org" 4 2>/dev/null || true)")"
  if is_public_ipv4 "$CANDIDATE_IP"; then
    PUBLIC_IPV4="$CANDIDATE_IP"
    PUBLIC_IPV4_SOURCE="ipify"
  fi
}

probe_public_ipv6() {
  PUBLIC_IPV6=""
  PUBLIC_IPV6_LOCATION=""
  PUBLIC_IPV6_OWNER=""
  PUBLIC_IPV6_SOURCE=""

  if [ -n "$PUBLIC_IPV6_OVERRIDE" ]; then
    PUBLIC_IPV6="$PUBLIC_IPV6_OVERRIDE"
    PUBLIC_IPV6_SOURCE="manual_override"
    return
  fi

  CIP_TEXT="$(http_get_text "https://www.cip.cc" 6 2>/dev/null || true)"
  CANDIDATE_IP="$(trim_inline "$(read_cip_field "$CIP_TEXT" "IP")")"

  if is_public_ipv6 "$CANDIDATE_IP"; then
    PUBLIC_IPV6="$CANDIDATE_IP"
    PUBLIC_IPV6_LOCATION="$(trim_inline "$(read_cip_field "$CIP_TEXT" "地址")")"
    PUBLIC_IPV6_OWNER="$(trim_inline "$(read_cip_field "$CIP_TEXT" "运营商")")"
    PUBLIC_IPV6_SOURCE="cip.cc"
    return
  fi

  CANDIDATE_IP="$(trim_inline "$(http_get_text "https://api64.ipify.org" 6 2>/dev/null || true)")"
  if is_public_ipv6 "$CANDIDATE_IP"; then
    PUBLIC_IPV6="$CANDIDATE_IP"
    PUBLIC_IPV6_SOURCE="ipify"
  fi
}

OS_RELEASE="$(read_os_release)"
OS_NAME="$(printf '%s' "$OS_RELEASE" | cut -d '|' -f 1)"
OS_VERSION="$(printf '%s' "$OS_RELEASE" | cut -d '|' -f 2)"
NODE_HOSTNAME="${HOSTNAME_OVERRIDE:-$(hostname)}"
ARCH="$(uname -m)"
KERNEL_VERSION="$(uname -r)"
CPU_CORES="$(read_cpu_cores)"
MEMORY_MB="$(read_memory_mb)"
DISK_GB="$(read_disk_gb)"
PRIVATE_IPV4="${PRIVATE_IPV4_OVERRIDE:-$(read_default_ip)}"
NODE_MACHINE_ID="$(read_machine_id)"
PRIMARY_MAC="$(read_primary_mac)"

if [ -n "$PUBLIC_IPV4_OVERRIDE" ] && ! is_public_ipv4 "$PUBLIC_IPV4_OVERRIDE"; then
  echo "Invalid public IPv4 override: $PUBLIC_IPV4_OVERRIDE" >&2
  exit 1
fi

if [ -n "$PUBLIC_IPV6_OVERRIDE" ] && ! is_public_ipv6 "$PUBLIC_IPV6_OVERRIDE"; then
  echo "Invalid public IPv6 override: $PUBLIC_IPV6_OVERRIDE" >&2
  exit 1
fi

if [ -n "$PRIVATE_IPV4_OVERRIDE" ] && ! is_ipv4_literal "$PRIVATE_IPV4_OVERRIDE"; then
  echo "Invalid private IPv4 override: $PRIVATE_IPV4_OVERRIDE" >&2
  exit 1
fi

probe_public_ipv4
probe_public_ipv6
FINGERPRINT_SOURCE="node-v2"

if [ -n "$NODE_MACHINE_ID" ]; then
  FINGERPRINT_SOURCE="${FINGERPRINT_SOURCE}|machine:${NODE_MACHINE_ID}"
fi

if [ -n "$PRIMARY_MAC" ]; then
  FINGERPRINT_SOURCE="${FINGERPRINT_SOURCE}|mac:${PRIMARY_MAC}"
fi

if [ "$FINGERPRINT_SOURCE" = "node-v2" ]; then
  FINGERPRINT_SOURCE="legacy-v2|host:${NODE_HOSTNAME}|arch:${ARCH}|kernel:${KERNEL_VERSION}|cpu:${CPU_CORES}|mem:${MEMORY_MB}|disk:${DISK_GB}"
fi

FINGERPRINT="sha256:$(sha256_hex "$FINGERPRINT_SOURCE")"

LABELS_JSON=""
if [ -n "$PROVIDER_LABEL" ] || [ -n "$REGION_LABEL" ] || [ -n "$ROLE_LABEL" ]; then
  LABELS_JSON="$(cat <<EOF
,
  "labels": {
    "provider": $(json_or_null "$PROVIDER_LABEL"),
    "region": $(json_or_null "$REGION_LABEL"),
    "role": $(json_or_null "$ROLE_LABEL")
  }
EOF
)"
fi

NETWORKING_JSON=""
if [ -n "$ACCESS_MODE" ] || [ -n "$ENTRY_REGION" ] || [ -n "$RELAY_NODE_ID" ] || [ -n "$RELAY_LABEL" ] || [ -n "$RELAY_REGION" ] || [ -n "$ROUTE_NOTE" ]; then
  NETWORKING_JSON="$(cat <<EOF
,
  "networking": {
    "access_mode": $(json_or_null "$ACCESS_MODE"),
    "entry_region": $(json_or_null "$ENTRY_REGION"),
    "relay_node_id": $(json_or_null "$RELAY_NODE_ID"),
    "relay_label": $(json_or_null "$RELAY_LABEL"),
    "relay_region": $(json_or_null "$RELAY_REGION"),
    "route_note": $(json_or_null "$ROUTE_NOTE")
  }
EOF
)"
fi

PAYLOAD="$(cat <<EOF
{
  "bootstrap_token": "$(json_escape "$BOOTSTRAP_TOKEN")",
  "fingerprint": "$(json_escape "$FINGERPRINT")",
  "facts": {
    "hostname": "$(json_escape "$NODE_HOSTNAME")",
    "os_name": "$(json_escape "$OS_NAME")",
    "os_version": "$(json_escape "$OS_VERSION")",
    "arch": "$(json_escape "$ARCH")",
    "kernel_version": "$(json_escape "$KERNEL_VERSION")",
    "public_ipv4": $(json_or_null "$PUBLIC_IPV4"),
    "public_ipv6": $(json_or_null "$PUBLIC_IPV6"),
    "public_ipv4_source": $(json_or_null "$PUBLIC_IPV4_SOURCE"),
    "public_ipv6_source": $(json_or_null "$PUBLIC_IPV6_SOURCE"),
    "public_ipv4_location": $(json_or_null "$PUBLIC_IPV4_LOCATION"),
    "public_ipv6_location": $(json_or_null "$PUBLIC_IPV6_LOCATION"),
    "public_ipv4_owner": $(json_or_null "$PUBLIC_IPV4_OWNER"),
    "public_ipv6_owner": $(json_or_null "$PUBLIC_IPV6_OWNER"),
    "private_ipv4": "$(json_escape "$PRIVATE_IPV4")",
    "machine_id": $(json_or_null "$NODE_MACHINE_ID"),
    "primary_mac": $(json_or_null "$PRIMARY_MAC"),
    "cpu_cores": $CPU_CORES,
    "memory_mb": $MEMORY_MB,
    "disk_gb": $DISK_GB,
    "ssh_port": $SSH_PORT
  }$LABELS_JSON$NETWORKING_JSON
}
EOF
)"

RESPONSE="$(http_post_json "${SERVER_URL%/}/api/v1/nodes/register" "$PAYLOAD")"

echo "$RESPONSE"

INIT_TASK_ID="$(printf '%s\n' "$RESPONSE" | sed -n 's/.*"init_task_id": "\(task_[^"]*\)".*/\1/p' | head -n 1)"
PUBLIC_KEY="$(printf '%s\n' "$RESPONSE" | sed -n 's/.*"public_key": "\([^"]*\)".*/\1/p' | head -n 1)"
SSH_KEY_INSTALLED=false

if [ -n "$PUBLIC_KEY" ]; then
  if install_platform_public_key "$PUBLIC_KEY" "$TARGET_SSH_USER"; then
    SSH_KEY_INSTALLED=true
  else
    echo "[bootstrap] 平台公钥写入失败，控制面后续 SSH 接管可能不可用。" >&2
  fi
fi

SSH_SERVICE_READY=false
if ensure_ssh_server_ready; then
  SSH_SERVICE_READY=true
else
  echo "[bootstrap] SSH 服务尚未准备完成，暂不触发控制面初始化，请先确认节点能监听 ${SSH_PORT} 端口后重新执行 bootstrap。" >&2
fi

if [ -n "$INIT_TASK_ID" ] && [ "$SSH_SERVICE_READY" = true ]; then
  INIT_CALLBACK_PAYLOAD="$(cat <<EOF
{
  "bootstrap_token": "$(json_escape "$BOOTSTRAP_TOKEN")",
  "installed_ssh_key": $SSH_KEY_INSTALLED
}
EOF
)"

  if http_post_json "${SERVER_URL%/}/api/v1/tasks/${INIT_TASK_ID}/bootstrap-complete" "$INIT_CALLBACK_PAYLOAD" >/dev/null 2>&1; then
    echo "[bootstrap] 已回报控制面，初始化任务 ${INIT_TASK_ID} 已触发。" >&2
  else
    echo "[bootstrap] 初始化任务 ${INIT_TASK_ID} 触发失败，可稍后在控制台手动重试。" >&2
  fi
elif [ -n "$INIT_TASK_ID" ]; then
  echo "[bootstrap] 初始化任务 ${INIT_TASK_ID} 已保留，待 SSH 就绪后重新执行 bootstrap 即可继续。" >&2
fi
