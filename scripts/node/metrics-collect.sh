#!/bin/sh
# 节点资源快照采集：只读，输出 `metric <key> <value>` 行，由控制面解析。
# 目标环境是 128MB~1GB 的 LXC/podman 容器（Alpine busybox ash / Debian slim），
# 因此只用 POSIX sh + busybox 一定存在的 applet，不依赖 bash/awk/free/nproc。
#
# 资源口径必须走 cgroup：容器里 /proc/meminfo 常被替换成假常量，
# procps 的 free 读到的是宿主值，nproc 读到的是宿主核数。

CG=/sys/fs/cgroup

metric() {
  printf 'metric %s=%s\n' "$1" "$2"
}

# 单行 "key value" 文件里取第 N 个字段
gfield() {
  [ -r "$1" ] || return 0
  grep -m1 -e "$2" "$1" 2>/dev/null | tr -s ' \t' ' ' | cut -d' ' -f"$3"
}

# 整个文件就是一行空分隔字段
sfield() {
  [ -r "$1" ] || return 0
  tr -s ' \t' ' ' < "$1" 2>/dev/null | cut -d' ' -f"$2"
}

metric collector_version 1

# ---------- 内存（cgroup v2） ----------
mem_max=$(sfield "$CG/memory.max" 1)
[ -n "$mem_max" ] || mem_max=$(sfield "$CG/memory/limit_in_bytes" 1)
mem_cur=$(sfield "$CG/memory.current" 1)
[ -n "$mem_cur" ] || mem_cur=$(sfield "$CG/memory/usage_in_bytes" 1)
metric mem_max_bytes "$mem_max"
metric mem_current_bytes "$mem_cur"
metric mem_swap_current_bytes "$(sfield "$CG/memory.swap.current" 1)"
metric mem_swap_max_bytes "$(sfield "$CG/memory.swap.max" 1)"
# 容器内 /proc/meminfo 仅作对照：与 cgroup 值不一致时说明口径要靠 cgroup
metric proc_memtotal_kb "$(gfield /proc/meminfo MemTotal 2)"

# OOM / 回收事件计数：小内存机器上这比使用率更能说明问题
metric mem_events_max "$(gfield "$CG/memory.events" max 2)"
metric mem_events_oom "$(gfield "$CG/memory.events" oom 2)"
metric mem_events_oom_kill "$(gfield "$CG/memory.events" oom_kill 2)"

# ---------- CPU 配额与实际用量 ----------
cpu_max_line=$(tr -s ' \t' ' ' < "$CG/cpu.max" 2>/dev/null)
cpu_quota=$(printf '%s' "$cpu_max_line" | cut -d' ' -f1)
cpu_period=$(printf '%s' "$cpu_max_line" | cut -d' ' -f2)
[ -n "$cpu_period" ] || cpu_period=100000
if [ "$cpu_quota" = "max" ] || [ -z "$cpu_quota" ]; then
  # 没有配额时退回在线核数（注意：这是宿主核数，仅作兜底）
  cpu_cores=$(grep -c -e '^processor' /proc/cpuinfo 2>/dev/null)
  metric cpu_quota_pct "$(( ${cpu_cores:-1} * 100 ))"
  metric cpu_quota_source "online_cpus"
else
  # 口径：100 = 一个核的配额
  metric cpu_quota_pct "$((cpu_quota * 100 / cpu_period))"
  metric cpu_quota_source "cgroup_cpu_max"
fi

usage0=$(gfield "$CG/cpu.stat" usage_usec 2)
sleep 1
usage1=$(gfield "$CG/cpu.stat" usage_usec 2)
if [ -n "$usage0" ] && [ -n "$usage1" ]; then
  # 1 秒窗口内消耗的 CPU 时间，换算成“占多少比例的一核”，保留两位小数。
  # 这些容器常年空闲，整数百分比会全都读成 0，看起来像监控坏了。
  centi=$(( (usage1 - usage0) / 100 ))
  metric cpu_used_pct "$((centi / 100)).$(printf '%02d' "$((centi % 100))")"
fi
metric cpu_usage_usec "$usage1"
metric cpu_nr_throttled "$(gfield "$CG/cpu.stat" nr_throttled 2)"
metric cpu_throttled_usec "$(gfield "$CG/cpu.stat" throttled_usec 2)"
metric pids_current "$(sfield "$CG/pids.current" 1)"
metric pids_max "$(sfield "$CG/pids.max" 1)"
metric loadavg_1m "$(sfield /proc/loadavg 1)"
metric uptime_sec "$(sfield /proc/uptime 1 | cut -d. -f1)"

# ---------- 磁盘 ----------
# df -P -m 输出固定 6 列（单位 MB），避免表头换行与超长设备名
df -P -m / 2>/dev/null | tail -n 1 | while read -r _fs total used avail pct _mp; do
  metric disk_total_mb "$total"
  metric disk_used_mb "$used"
  metric disk_avail_mb "$avail"
  metric disk_used_pct "$(printf '%s' "$pct" | tr -d '%')"
done

# ---------- 网络累计流量 ----------
# 容器里 /proc/net/dev 通常是宿主网卡计数，因此它只当趋势看，不当配额看。
# 注意 $10 在 POSIX sh 里会被读成 ${1}0，取第 10 列必须 shift。
rx=0
tx=0
while read -r line; do
  [ -n "$line" ] || continue
  set -- $(printf '%s' "$line" | tr -s ' :' ' ')
  case "$1" in lo) continue ;; esac
  [ -n "$2" ] || continue
  rx=$((rx + $2))
  shift 9
  [ -n "$1" ] && tx=$((tx + $1))
done <<EOF
$(grep ':' /proc/net/dev 2>/dev/null)
EOF
metric net_rx_bytes "$rx"
metric net_tx_bytes "$tx"

# ---------- 进程与监听端口（#74 的外来进程取证搭在同一轮 SSH 里） ----------
metric proc_total "$(ps -e 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')"

# RSS 最高的前 5 个进程：busybox ps 的 -o rss 在部分镜像里没有，取不到就跳过
if ps -eo pid=,rss=,comm= >/dev/null 2>&1; then
  ps -eo pid=,rss=,comm= 2>/dev/null | sort -k2 -nr | head -n 5 | while read -r pid rss comm; do
    [ -n "$pid" ] || continue
    printf 'proc %s|%s|%s\n' "$pid" "$rss" "$comm"
  done
fi

# 监听清单输出统一成 `listen <本地地址:端口>|<持有进程>`；
# netstat 与 ss 的列序不同（本地地址分别在第 4、第 5 列），所以各写一个解析分支。
print_listeners() {
  _field=$1
  while read -r line; do
    local_addr=$(printf '%s' "$line" | tr -s ' \t' ' ' | cut -d' ' -f"$_field")
    [ -n "$local_addr" ] || continue
    # netstat 与 ss 都把进程列放在状态列之后，取 LISTEN 之后的全部文本最稳；
    # 程序名本身可能带空格（sshd: /usr/sbin/），按空白切列会截断。
    proc_field=$(printf '%s' "$line" | sed -n 's|.*LISTEN[[:space:]]*||p')
    printf 'listen %s|%s\n' "$local_addr" "${proc_field:-unknown}"
  done
}

if netstat -ltn 2>/dev/null | tail -n +3 | grep -q .; then
  metric listeners_source netstat
  metric listeners_total "$(netstat -ltn 2>/dev/null | tail -n +3 | grep -c .)"
  netstat -ltnp 2>/dev/null | tail -n +3 | print_listeners 4
elif ss -ltnp 2>/dev/null | tail -n +2 | grep -q .; then
  metric listeners_source ss
  metric listeners_total "$(ss -ltn | tail -n +2 | grep -c .)"
  ss -ltnp 2>/dev/null | tail -n +2 | print_listeners 5
else
  metric listeners_source unavailable
  metric listeners_total 0
fi

exit 0
