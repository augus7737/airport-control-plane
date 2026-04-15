function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((item) => normalizeString(item)).filter(Boolean))];
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function resolveHomeDirectory(systemUser) {
  const configured = normalizeString(systemUser?.home_dir);
  if (configured) {
    return configured;
  }

  const username = normalizeString(systemUser?.username) ?? "user";
  if (username === "root") {
    return "/root";
  }

  return `/home/${username}`;
}

function buildAuthorizedKeysText(systemUser) {
  return normalizeStringArray(systemUser?.ssh_authorized_keys).join("\n");
}

function buildSystemUserApplyBlock(systemUser, index) {
  const username = normalizeString(systemUser?.username) ?? `user${index + 1}`;
  const name = normalizeString(systemUser?.name) ?? username;
  const status = normalizeString(systemUser?.status)?.toLowerCase() ?? "active";
  const shellPath = normalizeString(systemUser?.shell) ?? "/bin/sh";
  const homeDir = resolveHomeDirectory(systemUser);
  const uid = Number.isInteger(systemUser?.uid) ? String(systemUser.uid) : "";
  const groups = normalizeStringArray(systemUser?.groups);
  const authorizedKeysText = buildAuthorizedKeysText(systemUser);
  const beginMark = `# >>> airport-managed user ${username} >>>`;
  const endMark = `# <<< airport-managed user ${username} <<<`;
  const sudoEnabled = Boolean(systemUser?.sudo_enabled);
  const keysHeredoc = `EOF_AIRPORT_KEYS_${index + 1}`;

  if (status !== "active") {
    return `
USERNAME=${shellQuote(username)}
DISPLAY_NAME=${shellQuote(name)}
HOME_DIR=${shellQuote(homeDir)}
BEGIN_MARK=${shellQuote(beginMark)}
END_MARK=${shellQuote(endMark)}

if user_exists "$USERNAME"; then
  remove_authorized_keys_block "$USERNAME" "$HOME_DIR" "$BEGIN_MARK" "$END_MARK"
  lock_user "$USERNAME"
fi
remove_sudo_rule "$USERNAME"
echo "[system-user] username=$USERNAME display_name=$DISPLAY_NAME status=disabled"
`.trim();
  }

  const groupLines = groups.length
    ? groups
        .map((group) => `ensure_user_group "$USERNAME" ${shellQuote(group)}`)
        .join("\n")
    : `# no extra groups for ${username}`;

  const keyLines = authorizedKeysText
    ? `
TMP_KEYS_FILE="$(mktemp /tmp/airport-system-user-keys.XXXXXX 2>/dev/null || mktemp)"
cat >"$TMP_KEYS_FILE" <<'${keysHeredoc}'
${authorizedKeysText}
${keysHeredoc}
apply_authorized_keys "$USERNAME" "$HOME_DIR" "$BEGIN_MARK" "$END_MARK" "$TMP_KEYS_FILE"
rm -f "$TMP_KEYS_FILE"
`.trim()
    : `remove_authorized_keys_block "$USERNAME" "$HOME_DIR" "$BEGIN_MARK" "$END_MARK"`;

  return `
USERNAME=${shellQuote(username)}
DISPLAY_NAME=${shellQuote(name)}
HOME_DIR=${shellQuote(homeDir)}
SHELL_PATH=${shellQuote(shellPath)}
UID_VALUE=${shellQuote(uid)}
BEGIN_MARK=${shellQuote(beginMark)}
END_MARK=${shellQuote(endMark)}

ensure_user_present "$USERNAME" "$HOME_DIR" "$SHELL_PATH" "$UID_VALUE"
unlock_user "$USERNAME"
ensure_user_home "$USERNAME" "$HOME_DIR"
${groupLines}
${keyLines}
${sudoEnabled ? 'ensure_sudo_rule "$USERNAME"' : 'remove_sudo_rule "$USERNAME"'}
echo "[system-user] username=$USERNAME display_name=$DISPLAY_NAME status=active"
`.trim();
}

export function buildSystemUserApplyScript({ release, systemUsers = [] }) {
  const blocks = systemUsers.map((systemUser, index) => buildSystemUserApplyBlock(systemUser, index));

  return `#!/bin/sh
set -eu
export PATH="/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin:\${PATH}"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

user_exists() {
  id "$1" >/dev/null 2>&1
}

group_exists() {
  GROUP_NAME="$1"
  [ -n "$GROUP_NAME" ] || return 1
  if command_exists getent; then
    getent group "$GROUP_NAME" >/dev/null 2>&1
    return $?
  fi
  grep -Eq "^\${GROUP_NAME}:" /etc/group 2>/dev/null
}

ensure_group() {
  GROUP_NAME="$1"
  [ -n "$GROUP_NAME" ] || return 0

  if group_exists "$GROUP_NAME"; then
    return 0
  fi

  if command_exists addgroup; then
    addgroup "$GROUP_NAME" >/dev/null 2>&1 || true
    return 0
  fi

  if command_exists groupadd; then
    groupadd "$GROUP_NAME" >/dev/null 2>&1 || true
    return 0
  fi

  echo "[system-user] warning=group_create_unavailable group=$GROUP_NAME" >&2
  return 0
}

ensure_user_present() {
  USERNAME="$1"
  HOME_DIR="$2"
  SHELL_PATH="$3"
  UID_VALUE="$4"

  if user_exists "$USERNAME"; then
    if command_exists usermod; then
      [ -n "$HOME_DIR" ] && usermod -d "$HOME_DIR" "$USERNAME" >/dev/null 2>&1 || true
      [ -n "$SHELL_PATH" ] && usermod -s "$SHELL_PATH" "$USERNAME" >/dev/null 2>&1 || true
      [ -n "$UID_VALUE" ] && usermod -u "$UID_VALUE" "$USERNAME" >/dev/null 2>&1 || true
    fi
    return 0
  fi

  if command_exists adduser && command_exists apk; then
    if [ -n "$UID_VALUE" ]; then
      adduser -D -u "$UID_VALUE" -h "$HOME_DIR" -s "$SHELL_PATH" "$USERNAME" >/dev/null
    else
      adduser -D -h "$HOME_DIR" -s "$SHELL_PATH" "$USERNAME" >/dev/null
    fi
    return 0
  fi

  if command_exists useradd; then
    if [ -n "$UID_VALUE" ]; then
      useradd -m -u "$UID_VALUE" -d "$HOME_DIR" -s "$SHELL_PATH" "$USERNAME" >/dev/null 2>&1
    else
      useradd -m -d "$HOME_DIR" -s "$SHELL_PATH" "$USERNAME" >/dev/null 2>&1
    fi
    return 0
  fi

  echo "[system-user] error=no_user_creation_tool username=$USERNAME" >&2
  return 1
}

ensure_user_group() {
  USERNAME="$1"
  GROUP_NAME="$2"
  [ -n "$GROUP_NAME" ] || return 0

  ensure_group "$GROUP_NAME"

  if command_exists addgroup && command_exists apk; then
    addgroup "$USERNAME" "$GROUP_NAME" >/dev/null 2>&1 || true
    return 0
  fi

  if command_exists usermod; then
    usermod -aG "$GROUP_NAME" "$USERNAME" >/dev/null 2>&1 || true
    return 0
  fi

  echo "[system-user] warning=group_assign_unavailable username=$USERNAME group=$GROUP_NAME" >&2
  return 0
}

ensure_user_home() {
  USERNAME="$1"
  HOME_DIR="$2"
  install -d -m 700 "$HOME_DIR"
  if user_exists "$USERNAME"; then
    chown "$USERNAME":"$USERNAME" "$HOME_DIR" >/dev/null 2>&1 || chown "$USERNAME" "$HOME_DIR" >/dev/null 2>&1 || true
  fi
}

remove_managed_block() {
  TARGET_FILE="$1"
  BEGIN_MARK="$2"
  END_MARK="$3"

  if [ ! -f "$TARGET_FILE" ]; then
    return 0
  fi

  TMP_FILE="$(mktemp /tmp/airport-system-user-block.XXXXXX 2>/dev/null || mktemp)"
  awk -v begin="$BEGIN_MARK" -v end="$END_MARK" '
    $0 == begin { skip=1; next }
    $0 == end { skip=0; next }
    skip != 1 { print }
  ' "$TARGET_FILE" >"$TMP_FILE"
  mv "$TMP_FILE" "$TARGET_FILE"
}

upsert_managed_block() {
  TARGET_FILE="$1"
  BEGIN_MARK="$2"
  END_MARK="$3"
  CONTENT_FILE="$4"

  TMP_FILE="$(mktemp /tmp/airport-system-user-block.XXXXXX 2>/dev/null || mktemp)"
  if [ -f "$TARGET_FILE" ]; then
    awk -v begin="$BEGIN_MARK" -v end="$END_MARK" '
      $0 == begin { skip=1; next }
      $0 == end { skip=0; next }
      skip != 1 { print }
    ' "$TARGET_FILE" >"$TMP_FILE"
  else
    : >"$TMP_FILE"
  fi

  printf '%s\n' "$BEGIN_MARK" >>"$TMP_FILE"
  cat "$CONTENT_FILE" >>"$TMP_FILE"
  if [ -s "$CONTENT_FILE" ]; then
    printf '\n' >>"$TMP_FILE"
  fi
  printf '%s\n' "$END_MARK" >>"$TMP_FILE"
  mv "$TMP_FILE" "$TARGET_FILE"
}

apply_authorized_keys() {
  USERNAME="$1"
  HOME_DIR="$2"
  BEGIN_MARK="$3"
  END_MARK="$4"
  CONTENT_FILE="$5"
  SSH_DIR="$HOME_DIR/.ssh"
  AUTHORIZED_KEYS_FILE="$SSH_DIR/authorized_keys"

  install -d -m 700 "$SSH_DIR"
  touch "$AUTHORIZED_KEYS_FILE"
  upsert_managed_block "$AUTHORIZED_KEYS_FILE" "$BEGIN_MARK" "$END_MARK" "$CONTENT_FILE"
  chmod 600 "$AUTHORIZED_KEYS_FILE"
  if user_exists "$USERNAME"; then
    chown "$USERNAME":"$USERNAME" "$SSH_DIR" >/dev/null 2>&1 || chown "$USERNAME" "$SSH_DIR" >/dev/null 2>&1 || true
    chown "$USERNAME":"$USERNAME" "$AUTHORIZED_KEYS_FILE" >/dev/null 2>&1 || chown "$USERNAME" "$AUTHORIZED_KEYS_FILE" >/dev/null 2>&1 || true
  fi
}

remove_authorized_keys_block() {
  USERNAME="$1"
  HOME_DIR="$2"
  BEGIN_MARK="$3"
  END_MARK="$4"
  AUTHORIZED_KEYS_FILE="$HOME_DIR/.ssh/authorized_keys"

  if [ ! -f "$AUTHORIZED_KEYS_FILE" ]; then
    return 0
  fi

  remove_managed_block "$AUTHORIZED_KEYS_FILE" "$BEGIN_MARK" "$END_MARK"
  chmod 600 "$AUTHORIZED_KEYS_FILE" >/dev/null 2>&1 || true
  if user_exists "$USERNAME"; then
    chown "$USERNAME":"$USERNAME" "$AUTHORIZED_KEYS_FILE" >/dev/null 2>&1 || chown "$USERNAME" "$AUTHORIZED_KEYS_FILE" >/dev/null 2>&1 || true
  fi
}

ensure_sudo_rule() {
  USERNAME="$1"

  if ! command_exists sudo && command_exists apk; then
    apk add --no-cache sudo >/dev/null 2>&1 || true
  fi

  if command_exists sudo || [ -d /etc/sudoers.d ] || [ -f /etc/sudoers ]; then
    install -d -m 755 /etc/sudoers.d
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$USERNAME" >"/etc/sudoers.d/90-airport-$USERNAME"
    chmod 440 "/etc/sudoers.d/90-airport-$USERNAME"
    return 0
  fi

  echo "[system-user] warning=sudo_unavailable username=$USERNAME" >&2
  return 0
}

remove_sudo_rule() {
  USERNAME="$1"
  rm -f "/etc/sudoers.d/90-airport-$USERNAME"
}

lock_user() {
  USERNAME="$1"
  if user_exists "$USERNAME"; then
    command_exists passwd && passwd -l "$USERNAME" >/dev/null 2>&1 || true
    command_exists usermod && usermod -L "$USERNAME" >/dev/null 2>&1 || true
  fi
}

unlock_user() {
  USERNAME="$1"
  if user_exists "$USERNAME"; then
    command_exists passwd && passwd -u "$USERNAME" >/dev/null 2>&1 || true
    command_exists usermod && usermod -U "$USERNAME" >/dev/null 2>&1 || true
  fi
}

${blocks.join("\n\n")}

echo "[system-user] release_id=${release?.id ?? "unknown"}"
`;
}
