#!/bin/sh
# 控制面数据目录的快照备份与一条命令恢复。POSIX sh：最小化 Alpine 镜像里没有 bash。
#
#   scripts/backup-data-dir.sh backup                 生成快照并按保留策略清理
#   scripts/backup-data-dir.sh restore latest|<路径>  恢复快照（会把现有 data 目录整体挪走，不删除）
#   scripts/backup-data-dir.sh list                   列出 daily/weekly 快照
#   scripts/backup-data-dir.sh verify <路径>          校验归档可读 + sha256
#
# 保留策略：daily/ 里的快照按天滚动，超过 AIRPORT_BACKUP_DAILY_KEEP 天的先按 7 天分桶提升到
# weekly/（每桶只留一份），weekly/ 只保留最新的 AIRPORT_BACKUP_WEEKLY_KEEP 份。

set -eu

TAG="[airport-backup]"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

DATA_DIR="${AIRPORT_DATA_DIR:-$REPO_DIR/data}"
DAILY_KEEP="${AIRPORT_BACKUP_DAILY_KEEP:-7}"
WEEKLY_KEEP="${AIRPORT_BACKUP_WEEKLY_KEEP:-4}"
APP_USER="${AIRPORT_APP_USER:-}"
FORCE="${AIRPORT_BACKUP_FORCE:-false}"

log() {
  printf '%s %s\n' "$TAG" "$1"
}

fail() {
  printf '%s 失败: %s\n' "$TAG" "$1" >&2
  if command -v logger >/dev/null 2>&1; then
    logger -t airport-backup -- "失败: $1" 2>/dev/null || true
  fi
  exit 1
}

resolve_backup_dir() {
  if [ -n "${AIRPORT_BACKUP_DIR:-}" ]; then
    printf '%s\n' "$AIRPORT_BACKUP_DIR"
    return
  fi

  if [ -d /opt ] && [ -w /opt ]; then
    printf '/opt/airport-backups\n'
    return
  fi

  printf '%s\n' "$REPO_DIR/backups"
}

BACKUP_DIR=$(resolve_backup_dir)

require_data_dir() {
  [ -d "$DATA_DIR" ] || fail "数据目录不存在: $DATA_DIR（用 AIRPORT_DATA_DIR 指定）"
  [ -f "$DATA_DIR/nodes.json" ] || fail "数据目录里没有 nodes.json，看起来不是控制面 data 目录: $DATA_DIR"
}

file_mtime() {
  if stat -c %Y "$1" >/dev/null 2>&1; then
    stat -c %Y "$1"
  elif stat -f %m "$1" >/dev/null 2>&1; then
    stat -f %m "$1"
  else
    fail "无法读取文件修改时间: $1"
  fi
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    printf '\n'
  fi
}

write_checksum() {
  archive="$1"
  digest=$(sha256_of "$archive")
  if [ -z "$digest" ]; then
    log "本机没有 sha256sum/shasum，跳过校验和（恢复时只能做 tar 可读性校验）"
    return
  fi

  printf '%s  %s\n' "$digest" "$(basename -- "$archive")" > "$archive.sha256"
}

verify_archive() {
  archive="$1"
  [ -f "$archive" ] || fail "归档不存在: $archive"
  tar -tzf "$archive" >/dev/null 2>&1 || fail "归档不可读（gzip/tar 校验失败）: $archive"

  sidecar="$archive.sha256"
  if [ -f "$sidecar" ]; then
    expected=$(awk '{print $1; exit}' "$sidecar")
    actual=$(sha256_of "$archive")
    if [ -z "$actual" ]; then
      log "归档自带 sha256 但本机没有校验工具，跳过哈希比对"
    elif [ "$expected" != "$actual" ]; then
      fail "sha256 不匹配: $archive（期望 $expected，实际 $actual）"
    else
      log "sha256 校验通过"
    fi
  else
    log "归档没有 .sha256 伴生文件，只做 tar 可读性校验"
  fi
}

newest_first() {
  # 文件名内嵌 YYYYmmdd-HHMMSS，字典序即时间序；反向排序 = 由新到旧。
  [ -d "$1" ] || return 0
  ls -1 "$1" 2>/dev/null | grep '\.tar\.gz$' | sort -r || true
}

cmd_backup() {
  require_data_dir
  mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

  stamp=$(date -u +%Y%m%d-%H%M%S)
  archive="$BACKUP_DIR/daily/airport-data-$stamp.tar.gz"
  tmp_archive="$archive.tmp"

  # --exclude 掉进行中的临时文件，避免把半成品写进快照。
  if ! tar -czf "$tmp_archive" -C "$DATA_DIR/.." --exclude '*.tmp' "$(basename -- "$DATA_DIR")"; then
    rm -f "$tmp_archive"
    fail "打包失败: $DATA_DIR"
  fi

  mv "$tmp_archive" "$archive"
  write_checksum "$archive"
  verify_archive "$archive" || fail "刚生成的快照校验没通过: $archive"

  if [ -n "$APP_USER" ] && command -v chown >/dev/null 2>&1; then
    chown "$APP_USER" "$archive" 2>/dev/null || log "chown $APP_USER 失败，快照属主保持不变"
  fi

  log "快照已生成: $archive ($(wc -c < "$archive" | tr -d ' ') bytes)"
  cmd_prune
}

cmd_prune() {
  [ -d "$BACKUP_DIR/daily" ] || return 0

  now=$(date -u +%s)
  cutoff=$((now - DAILY_KEEP * 86400))
  seen_buckets=""

  for name in $(newest_first "$BACKUP_DIR/daily"); do
    archive="$BACKUP_DIR/daily/$name"
    [ -f "$archive" ] || continue
    mtime=$(file_mtime "$archive")

    if [ "$mtime" -ge "$cutoff" ]; then
      continue
    fi

    bucket=$((mtime / 604800))
    case " $seen_buckets " in
      *" $bucket "*)
        rm -f "$archive" "$archive.sha256"
        log "超期且同周已有留存，删除 $name"
        ;;
      *)
        seen_buckets="$seen_buckets $bucket"
        mv "$archive" "$BACKUP_DIR/weekly/$name"
        [ -f "$archive.sha256" ] && mv "$archive.sha256" "$BACKUP_DIR/weekly/$name.sha256"
        log "已提升为周备份: $name"
        ;;
    esac
  done

  kept=0
  for name in $(newest_first "$BACKUP_DIR/weekly"); do
    archive="$BACKUP_DIR/weekly/$name"
    [ -f "$archive" ] || continue
    kept=$((kept + 1))
    if [ "$kept" -gt "$WEEKLY_KEEP" ]; then
      rm -f "$archive" "$archive.sha256"
      log "周备份超出保留份数，删除 $name"
    fi
  done
}

resolve_restore_target() {
  case "$1" in
    latest)
      name=$(newest_first "$BACKUP_DIR/daily" | head -n 1)
      if [ -z "$name" ]; then
        name=$(newest_first "$BACKUP_DIR/weekly" | head -n 1)
      fi
      [ -n "$name" ] || fail "没有找到任何快照，先看 list: $BACKUP_DIR"
      printf '%s\n' "$name"
      ;;
    *)
      printf '%s\n' "$1"
      ;;
  esac
}

cmd_restore() {
  [ $# -ge 1 ] || fail "用法: $0 restore latest|<归档路径>"
  archive=$(resolve_restore_target "$1")
  case "$archive" in
    */*) ;;
    *) archive="$BACKUP_DIR/daily/$archive" ;;
  esac

  verify_archive "$archive"
  parent_dir=$(CDPATH= cd -- "$(dirname -- "$DATA_DIR")" && pwd)
  data_name=$(basename -- "$DATA_DIR")

  # 归档顶层目录名必须与目标 data 目录同名，否则解出来会套一层子目录。
  if ! tar -tzf "$archive" | head -n 1 | grep -q "^$data_name/"; then
    fail "归档顶层不是 $data_name/，无法直接恢复到 $DATA_DIR"
  fi

  if [ "$FORCE" != "true" ]; then
    if command -v pgrep >/dev/null 2>&1 && pgrep -f "node src/server.js" >/dev/null 2>&1; then
      fail "检测到控制面进程仍在运行，恢复会被它写回覆盖。请先停服务，或设 AIRPORT_BACKUP_FORCE=true"
    fi
  fi

  stamp=$(date -u +%Y%m%d-%H%M%S)
  if [ -d "$DATA_DIR" ]; then
    stash="$parent_dir/data-pre-restore-$stamp"
    mv "$DATA_DIR" "$stash"
    log "现有数据目录已挪到: $stash（确认恢复无误后再自行删除）"
  fi

  mkdir -p "$DATA_DIR"
  chmod 0750 "$DATA_DIR" 2>/dev/null || true
  tar -xzf "$archive" -C "$parent_dir" || fail "解包失败: $archive"

  if [ -n "$APP_USER" ] && command -v chown >/dev/null 2>&1; then
    chown -R "$APP_USER" "$DATA_DIR" 2>/dev/null || log "chown -R $APP_USER 失败，请手工修正属主"
  fi

  log "已恢复 $archive -> $DATA_DIR"
  log "下一步：启动控制面并核对节点/任务数量；确认后再删除 data-pre-restore-* 目录"
}

cmd_list() {
  log "备份目录: $BACKUP_DIR（daily 保留 ${DAILY_KEEP} 天，weekly 保留 ${WEEKLY_KEEP} 份）"
  for tier in daily weekly; do
    dir="$BACKUP_DIR/$tier"
    count=$(ls -1 "$dir" 2>/dev/null | grep -c '\.tar\.gz$' || true)
    log "$tier: ${count:-0} 份"
    for name in $(newest_first "$dir"); do
      printf '  %s\n' "$name"
    done
  done
}

case "${1:-backup}" in
  backup)
    shift 2>/dev/null || true
    cmd_backup
    ;;
  prune)
    shift 2>/dev/null || true
    cmd_prune
    ;;
  list)
    shift 2>/dev/null || true
    cmd_list
    ;;
  verify)
    shift 2>/dev/null || true
    [ $# -ge 1 ] || fail "用法: $0 verify <归档路径>"
    verify_archive "$1"
    ;;
  restore)
    shift
    cmd_restore "$@"
    ;;
  -h | --help | help)
    sed -n '2,14p' "$0"
    ;;
  *)
    fail "未知命令: $1（支持 backup / restore / list / verify / prune）"
    ;;
esac
