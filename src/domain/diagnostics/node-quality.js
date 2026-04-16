function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
}

function compactOutput(text, maxLength = 1600) {
  const normalized = stripAnsi(String(text || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function normalizeInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeFloat(value) {
  const parsed = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeBase64(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function remoteLine(key, value) {
  return `__AIRPORT_DIAG__meta ${key}=${value}\n`;
}

function remoteSectionLine(section, key, value) {
  return `__AIRPORT_DIAG__section ${section} ${key}=${value}\n`;
}

function buildPreflightScript() {
  const shellPath = "${PATH}";
  const shellDefaultCpuCount = "${cpu_count:-1}";
  const shellDefaultLoad = "${load1:-0}";
  const shellDefaultTmpFree = "${tmp_free_mb:-0}";
  const shellDefaultRootFree = "${root_free_mb:-0}";
  const shellDefaultVirt = "${virt:-unknown}";

  return String.raw`#!/bin/sh
set -eu

PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${shellPath}"

bool_value() {
  if command -v "$1" >/dev/null 2>&1; then
    printf '1'
  else
    printf '0'
  fi
}

read_mem_kib() {
  KEY="$1"
  awk -v key="$KEY" '$1 == key ":" { print $2; exit }' /proc/meminfo 2>/dev/null || true
}

to_mb() {
  VALUE="$1"
  if [ -z "$VALUE" ]; then
    printf '0'
    return 0
  fi

  awk -v value="$VALUE" 'BEGIN { printf "%d", value / 1024 }'
}

mem_total_kib="$(read_mem_kib MemTotal)"
mem_available_kib="$(read_mem_kib MemAvailable)"
mem_free_kib="$(read_mem_kib MemFree)"
cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || printf '1')"
load1="$(awk '{print $1}' /proc/loadavg 2>/dev/null || printf '0')"
tmp_free_mb="$(df -Pm /tmp 2>/dev/null | awk 'NR==2 { print $4; exit }')"
root_free_mb="$(df -Pm / 2>/dev/null | awk 'NR==2 { print $4; exit }')"

virt="unknown"
if command -v systemd-detect-virt >/dev/null 2>&1; then
  virt="$(systemd-detect-virt 2>/dev/null || true)"
fi
if [ -z "$virt" ] || [ "$virt" = "none" ]; then
  if grep -qa 'container=lxc' /proc/1/environ 2>/dev/null; then
    virt="lxc"
  elif [ -f /dev/lxc ] || [ -d /proc/vz ]; then
    virt="lxc"
  elif grep -qi docker /proc/1/cgroup 2>/dev/null; then
    virt="docker"
  else
    virt="unknown"
  fi
fi

printf '__AIRPORT_DIAG__meta mem_total_mb=%s\n' "$(to_mb "$mem_total_kib")"
if [ -n "$mem_available_kib" ]; then
  printf '__AIRPORT_DIAG__meta mem_available_mb=%s\n' "$(to_mb "$mem_available_kib")"
else
  printf '__AIRPORT_DIAG__meta mem_available_mb=%s\n' "$(to_mb "$mem_free_kib")"
fi
printf '__AIRPORT_DIAG__meta cpu_count=%s\n' "${shellDefaultCpuCount}"
printf '__AIRPORT_DIAG__meta load1=%s\n' "${shellDefaultLoad}"
printf '__AIRPORT_DIAG__meta tmp_free_mb=%s\n' "${shellDefaultTmpFree}"
printf '__AIRPORT_DIAG__meta root_free_mb=%s\n' "${shellDefaultRootFree}"
printf '__AIRPORT_DIAG__meta virtualization=%s\n' "${shellDefaultVirt}"
printf '__AIRPORT_DIAG__meta has_bash=%s\n' "$(bool_value bash)"
printf '__AIRPORT_DIAG__meta has_curl=%s\n' "$(bool_value curl)"
printf '__AIRPORT_DIAG__meta has_jq=%s\n' "$(bool_value jq)"
printf '__AIRPORT_DIAG__meta has_nexttrace=%s\n' "$(bool_value nexttrace)"
printf '__AIRPORT_DIAG__meta has_timeout=%s\n' "$(bool_value timeout)"
`;
}

function buildProfileScript(profile = "light") {
  const isDeep = profile === "deep";
  const shellPath = "${PATH}";
  const runLines = isDeep
    ? String.raw`
run_check net https://Net.Check.Place -4 -L -S 7 -n -y
`
    : String.raw`
run_check hardware https://Hardware.Check.Place -F -y
run_check ip https://IP.Check.Place -y
`;

  return String.raw`#!/bin/sh
set -eu

PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${shellPath}"
WORKDIR="$(mktemp -d /tmp/airport-diag.XXXXXX)"

cleanup() {
  rm -rf "$WORKDIR"
}

trap cleanup EXIT INT TERM

b64_file() {
  FILE="$1"
  if [ -f "$FILE" ] && [ -s "$FILE" ]; then
    base64 "$FILE" | tr -d '\n'
  else
    printf ''
  fi
}

b64_head_file() {
  FILE="$1"
  if [ -f "$FILE" ] && [ -s "$FILE" ]; then
    head -c 12000 "$FILE" | base64 | tr -d '\n'
  else
    printf ''
  fi
}

b64_text() {
  VALUE="$1"
  if [ -n "$VALUE" ]; then
    printf '%s' "$VALUE" | base64 | tr -d '\n'
  else
    printf ''
  fi
}

extract_report_link() {
  FILE="$1"
  if [ ! -f "$FILE" ]; then
    printf ''
    return 0
  fi

  grep -Eo 'https://Report.Check.Place/[^[:space:]]+\.svg' "$FILE" | tail -n 1 || true
}

run_check() {
  SECTION="$1"
  URL="$2"
  shift 2

  LOG_FILE="$WORKDIR/$SECTION.log"
  JSON_FILE="$WORKDIR/$SECTION.json"

  set +e
  curl -Ls "$URL" | bash -s -- "$@" -o "$JSON_FILE" >"$LOG_FILE" 2>&1
  EXIT_CODE=$?
  set -e

  REPORT_URL="$(extract_report_link "$LOG_FILE")"
  STATUS="failed"
  if [ -n "$REPORT_URL" ] && [ "$EXIT_CODE" -eq 0 ]; then
    STATUS="success"
  elif [ -n "$REPORT_URL" ]; then
    STATUS="partial"
  fi

  printf '__AIRPORT_DIAG__section %s status=%s\n' "$SECTION" "$STATUS"
  printf '__AIRPORT_DIAG__section %s exit_code=%s\n' "$SECTION" "$EXIT_CODE"
  printf '__AIRPORT_DIAG__section %s report_url_b64=%s\n' "$SECTION" "$(b64_text "$REPORT_URL")"
  printf '__AIRPORT_DIAG__section %s json_b64=%s\n' "$SECTION" "$(b64_file "$JSON_FILE")"
  printf '__AIRPORT_DIAG__section %s output_excerpt_b64=%s\n' "$SECTION" "$(b64_head_file "$LOG_FILE")"
}

${runLines}`;
}

function parseStructuredOutput(output) {
  const meta = {};
  const sections = {};
  const cleanedOutput = stripAnsi(output);

  for (const rawLine of cleanedOutput.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("__AIRPORT_DIAG__")) {
      continue;
    }

    if (line.startsWith("__AIRPORT_DIAG__meta ")) {
      const payload = line.slice("__AIRPORT_DIAG__meta ".length);
      const separator = payload.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = payload.slice(0, separator).trim();
      const value = payload.slice(separator + 1);
      meta[key] = value;
      continue;
    }

    if (line.startsWith("__AIRPORT_DIAG__section ")) {
      const payload = line.slice("__AIRPORT_DIAG__section ".length);
      const firstSpace = payload.indexOf(" ");
      if (firstSpace <= 0) {
        continue;
      }

      const section = payload.slice(0, firstSpace).trim();
      const assignment = payload.slice(firstSpace + 1);
      const separator = assignment.indexOf("=");
      if (separator <= 0) {
        continue;
      }

      const key = assignment.slice(0, separator).trim();
      const value = assignment.slice(separator + 1);
      sections[section] = sections[section] || {};
      sections[section][key] = value;
    }
  }

  return { meta, sections };
}

function extractMetric(excerpt, label) {
  const normalized = stripAnsi(excerpt || "");
  if (!normalized) {
    return null;
  }

  const pattern = new RegExp(`${label}\\s*[：:]\\s*([^\\n]+)`, "i");
  const match = normalized.match(pattern);
  return normalizeString(match?.[1] || null);
}

function hardwareSummary(section, node) {
  const virtualization =
    extractMetric(section.output_excerpt, "容器/虚拟化") ||
    extractMetric(section.output_excerpt, "Virtualization") ||
    node?.facts?.virtualization ||
    null;
  const cpu = extractMetric(section.output_excerpt, "CPU 型号");
  const memory = extractMetric(section.output_excerpt, "内存");
  const parts = ["硬件报告"];
  if (virtualization) {
    parts.push(virtualization);
  }
  if (cpu) {
    parts.push(cpu);
  }
  if (!cpu && memory) {
    parts.push(memory);
  }
  return parts.join(" · ");
}

function ipSummary(section) {
  const ipType = extractMetric(section.output_excerpt, "IP类型");
  const mail25 = extractMetric(section.output_excerpt, "本地25端口出站");
  const riskLabel =
    stripAnsi(section.output_excerpt || "").includes("低风险") ? "低风险" : null;
  const parts = ["IP 质量报告"];
  if (ipType) {
    parts.push(ipType);
  }
  if (riskLabel) {
    parts.push(riskLabel);
  }
  if (mail25) {
    parts.push(`25 端口 ${mail25}`);
  }
  return parts.join(" · ");
}

function netSummary(section) {
  const excerpt = stripAnsi(section.output_excerpt || "");
  const parts = ["网络质量报告"];
  if (excerpt.includes("NoData")) {
    parts.push("部分测项未返回有效数据");
  } else if (section.status === "partial") {
    parts.push("已生成报告，但完整度有限");
  }
  return parts.join(" · ");
}

function buildReasonLabels() {
  return {
    node_diagnostic_running: "当前节点已有诊断任务在执行",
    host_deep_diagnostic_running: "同一公网入口宿主已有深度诊断在执行",
    platform_ssh_key_missing: "平台缺少可用 SSH 私钥",
    platform_ssh_key_invalid: "平台 SSH 私钥不可用",
    management_route_missing: "当前节点缺少可用管理链路",
    diagnostic_light_memory_too_low: "轻量诊断要求节点至少 256MB 内存",
    diagnostic_deep_memory_too_low: "深度诊断要求节点至少 1GB 内存",
    diagnostic_deep_disk_too_low: "深度诊断要求节点至少 5GB 磁盘",
    diagnostic_bash_missing: "节点缺少 bash，暂时无法运行 NodeQuality 脚本",
    diagnostic_curl_missing: "节点缺少 curl，暂时无法拉取诊断脚本",
    diagnostic_jq_missing: "深度诊断依赖 jq",
    diagnostic_nexttrace_missing: "深度诊断依赖 nexttrace",
    diagnostic_preflight_failed: "节点预检失败，未能完成资源与依赖校验",
    diagnostic_memory_available_too_low: "当前可用内存过低，已停止诊断以避免卡死",
    diagnostic_tmp_free_too_low: "当前 /tmp 可用空间不足，已停止诊断",
    diagnostic_load_too_high: "当前节点负载过高，建议低峰期再运行深度诊断",
    diagnostic_transport_unavailable: "当前节点无法建立 SSH 执行通道",
    diagnostic_execution_failed: "诊断脚本执行失败",
    diagnostic_report_missing: "诊断执行完成，但未生成公开报告链接",
  };
}

function reasonLabel(code) {
  const labels = buildReasonLabels();
  return labels[String(code || "").trim()] || String(code || "未知异常");
}

function staticGuard(node, profile) {
  const blockers = [];
  const warnings = [];
  const memoryMb = normalizeInteger(node?.facts?.memory_mb);
  const diskGb = normalizeInteger(node?.facts?.disk_gb);

  if (profile === "light") {
    if (memoryMb != null && memoryMb < 256) {
      blockers.push("diagnostic_light_memory_too_low");
    }
  } else {
    if (memoryMb != null && memoryMb < 1024) {
      blockers.push("diagnostic_deep_memory_too_low");
    }
    if (diskGb != null && diskGb < 5) {
      blockers.push("diagnostic_deep_disk_too_low");
    }
    if (memoryMb != null && memoryMb < 1536) {
      warnings.push("深度诊断会持续数分钟，建议避开业务高峰。");
    }
  }

  return {
    blockers,
    warnings,
  };
}

function runtimeGuard(profile, meta) {
  const blockers = [];
  const warnings = [];
  const memAvailableMb = normalizeInteger(meta.mem_available_mb);
  const tmpFreeMb = normalizeInteger(meta.tmp_free_mb);
  const load1 = normalizeFloat(meta.load1);
  const cpuCount = Math.max(1, normalizeInteger(meta.cpu_count) || 1);
  const hasBash = meta.has_bash === "1";
  const hasCurl = meta.has_curl === "1";
  const hasJq = meta.has_jq === "1";
  const hasNexttrace = meta.has_nexttrace === "1";

  if (!hasBash) {
    blockers.push("diagnostic_bash_missing");
  }
  if (!hasCurl) {
    blockers.push("diagnostic_curl_missing");
  }

  if (profile === "light") {
    if (memAvailableMb != null && memAvailableMb < 96) {
      blockers.push("diagnostic_memory_available_too_low");
    }
    if (tmpFreeMb != null && tmpFreeMb < 128) {
      blockers.push("diagnostic_tmp_free_too_low");
    }
  } else {
    if (memAvailableMb != null && memAvailableMb < 256) {
      blockers.push("diagnostic_memory_available_too_low");
    }
    if (tmpFreeMb != null && tmpFreeMb < 256) {
      blockers.push("diagnostic_tmp_free_too_low");
    }
    if (!hasJq) {
      blockers.push("diagnostic_jq_missing");
    }
    if (!hasNexttrace) {
      blockers.push("diagnostic_nexttrace_missing");
    }
    if (load1 != null && load1 > cpuCount * 1.75) {
      blockers.push("diagnostic_load_too_high");
    } else if (load1 != null && load1 > cpuCount * 1.2) {
      warnings.push("当前节点负载偏高，深度诊断结果可能受影响。");
    }
  }

  return {
    blockers,
    warnings,
    snapshot: {
      mem_total_mb: normalizeInteger(meta.mem_total_mb),
      mem_available_mb: memAvailableMb,
      tmp_free_mb: tmpFreeMb,
      root_free_mb: normalizeInteger(meta.root_free_mb),
      cpu_count: cpuCount,
      load1,
      virtualization: normalizeString(meta.virtualization) || null,
      has_bash: hasBash,
      has_curl: hasCurl,
      has_jq: hasJq,
      has_nexttrace: hasNexttrace,
    },
  };
}

function summarizeSection(sectionName, section, node) {
  if (sectionName === "hardware") {
    return hardwareSummary(section, node);
  }
  if (sectionName === "ip") {
    return ipSummary(section);
  }
  if (sectionName === "net") {
    return netSummary(section);
  }
  return `${sectionName} 报告`;
}

function enrichSections(rawSections = {}, node = null) {
  const sections = {};

  for (const [sectionName, rawSection] of Object.entries(rawSections)) {
    const reportUrl = decodeBase64(rawSection.report_url_b64);
    const rawJson = decodeBase64(rawSection.json_b64);
    const outputExcerpt = compactOutput(decodeBase64(rawSection.output_excerpt_b64));
    const exitCode = normalizeInteger(rawSection.exit_code);
    const status = normalizeString(rawSection.status) || "failed";

    sections[sectionName] = {
      status,
      exit_code: exitCode,
      report_url: reportUrl,
      raw_json: rawJson,
      output_excerpt: outputExcerpt,
      summary: summarizeSection(
        sectionName,
        {
          status,
          exit_code: exitCode,
          report_url: reportUrl,
          raw_json: rawJson,
          output_excerpt: outputExcerpt,
        },
        node,
      ),
    };
  }

  return sections;
}

function diagnosticOutcome(profile, sections) {
  const relevantSections =
    profile === "light"
      ? [sections.hardware, sections.ip].filter(Boolean)
      : [sections.net].filter(Boolean);
  const successCount = relevantSections.filter((section) => section.report_url).length;
  const failedCount = relevantSections.length - successCount;

  if (successCount === 0) {
    return {
      status: "failed",
      quality: "failed",
    };
  }

  if (failedCount > 0 || relevantSections.some((section) => section.status === "partial")) {
    return {
      status: "partial",
      quality: "partial",
    };
  }

  return {
    status: "success",
    quality: "full",
  };
}

function diagnosticSummary(profile, sections, blockers = []) {
  if (blockers.length > 0) {
    return blockers.map((code) => reasonLabel(code)).join("；");
  }

  if (profile === "light") {
    const parts = [];
    if (sections.hardware?.report_url) {
      parts.push(sections.hardware.summary);
    }
    if (sections.ip?.report_url) {
      parts.push(sections.ip.summary);
    }
    return parts.length > 0 ? `轻量诊断完成：${parts.join("；")}` : "轻量诊断未生成可用报告。";
  }

  if (sections.net?.report_url) {
    return `深度诊断完成：${sections.net.summary}`;
  }
  return "深度诊断未生成可用报告。";
}

function logExcerpt(profile, summary, sections, blockers = [], rawOutput = null) {
  const lines = [
    `诊断档位 ${profile === "light" ? "light" : "deep"}`,
    summary,
  ];

  if (blockers.length > 0) {
    lines.push(`阻断原因 ${blockers.map((code) => reasonLabel(code)).join("；")}`);
  }

  for (const [name, section] of Object.entries(sections || {})) {
    if (!section) {
      continue;
    }
    lines.push(`${name} 状态 ${section.status}${section.report_url ? ` / ${section.report_url}` : ""}`);
  }

  const rawExcerpt = compactOutput(rawOutput, 1200);
  if (rawExcerpt && (Object.keys(sections || {}).length === 0 || blockers.length > 0)) {
    lines.push(rawExcerpt);
  }

  return lines;
}

function executeRemoteScript(spawn, terminateChildProcess, cwdProvider, transport, scriptBody, timeoutMs) {
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    let timer = null;
    const child = spawn(
      transport.command,
      [...transport.args, "sh", "-s", "--"],
      {
        cwd: cwdProvider(),
        env: transport.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    const append = (chunk) => {
      output += chunk.toString();
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.stdin.on("error", () => {});

    child.on("error", (error) => {
      finish({
        output: `${output}\n${error.message}\n`,
        exit_code: null,
        signal: null,
        timed_out: false,
      });
    });

    child.on("close", (code, signal) => {
      finish({
        output,
        exit_code: timedOut ? 124 : code,
        signal,
        timed_out: timedOut,
      });
    });

    child.stdin.write(scriptBody);
    child.stdin.end();

    timer = setTimeout(() => {
      timedOut = true;
      output += "\n[control-plane] diagnostic timeout\n";
      terminateChildProcess(child);
    }, timeoutMs);
    timer.unref?.();
  });
}

export function createNodeDiagnosticsDomain(dependencies) {
  const {
    cwdProvider = () => process.cwd(),
    defaultNodeSshUser = "root",
    diagnosticStore,
    getNodeById,
    nowIso,
    persistDiagnosticStore,
    persistTaskStore,
    randomUUID,
    resolveNodeSshTransport,
    buildTaskRecord,
    spawn,
    terminateChildProcess,
    upsertTaskRecord,
  } = dependencies;

  function sortDiagnostics(items = []) {
    return [...items].sort((left, right) =>
      String(right.started_at || right.created_at || "").localeCompare(
        String(left.started_at || left.created_at || ""),
      ),
    );
  }

  function listDiagnostics(nodeId = null) {
    const filtered = nodeId
      ? diagnosticStore.filter((item) => item?.node_id === nodeId)
      : diagnosticStore;
    return sortDiagnostics(filtered);
  }

  function upsertDiagnosticRecord(record) {
    const index = diagnosticStore.findIndex((item) => item.id === record.id);
    const nextRecord = {
      ...record,
      updated_at: nowIso(),
    };

    if (index >= 0) {
      diagnosticStore[index] = nextRecord;
    } else {
      diagnosticStore.unshift(nextRecord);
    }

    if (diagnosticStore.length > 200) {
      diagnosticStore.length = 200;
    }

    return nextRecord;
  }

  function findRunningDiagnostic(nodeId) {
    return diagnosticStore.find((item) => {
      return item?.node_id === nodeId && ["queued", "running"].includes(String(item?.status || ""));
    }) || null;
  }

  function runningDeepDiagnosticForHost(hostGroupKey) {
    if (!hostGroupKey) {
      return null;
    }

    return diagnosticStore.find((item) => {
      return (
        item?.profile === "deep" &&
        item?.host_group_key === hostGroupKey &&
        ["queued", "running"].includes(String(item?.status || ""))
      );
    }) || null;
  }

  function inferHostGroupKey(node) {
    return (
      normalizeString(node?.facts?.public_ipv4) ||
      normalizeString(node?.facts?.private_ipv4) ||
      normalizeString(node?.facts?.public_ipv6) ||
      normalizeString(node?.management?.ssh_host) ||
      node?.id ||
      null
    );
  }

  function buildDiagnosticTask(node, options = {}) {
    const profile = String(options.profile || "light").trim().toLowerCase() === "deep" ? "deep" : "light";
    const title = profile === "deep" ? "深度诊断" : "轻量诊断";
    const note =
      profile === "deep"
        ? "已提交深度诊断，控制面会先做资源保护校验，再尝试生成网络质量报告。"
        : "已提交轻量诊断，控制面会先做资源校验，再尝试生成硬件与 IP 质量报告。";

    return buildTaskRecord(node, {
      type: "node_diagnostic",
      title,
      trigger: options.trigger ?? "manual_diagnostic",
      status: "running",
      note,
      started_at: nowIso(),
      payload: {
        profile,
        provider: "nodequality",
        reason: options.reason ?? "manual_diagnostic",
      },
    });
  }

  function buildDiagnosticRecord(node, task, options = {}) {
    const profile = String(options.profile || task?.payload?.profile || "light").trim().toLowerCase() === "deep"
      ? "deep"
      : "light";
    const now = nowIso();

    return {
      id: `diag_${randomUUID()}`,
      node_id: node.id,
      task_id: task.id,
      profile,
      provider: "nodequality",
      status: "running",
      result_quality: null,
      summary:
        profile === "deep"
          ? "深度诊断已开始，正在做资源与依赖预检。"
          : "轻量诊断已开始，正在做资源与依赖预检。",
      host_group_key: inferHostGroupKey(node),
      guard: {
        static_blockers: [],
        runtime_blockers: [],
        warnings: [],
      },
      preflight: null,
      transport: null,
      reports: {
        hardware: null,
        ip: null,
        net: null,
      },
      created_at: now,
      started_at: now,
      finished_at: null,
      updated_at: now,
    };
  }

  async function failDiagnostic(task, record, summary, blockers = [], rawOutput = null) {
    const finishedAt = nowIso();
    const nextTask = {
      ...task,
      status: "failed",
      finished_at: finishedAt,
      note: summary,
      log_excerpt: logExcerpt(record.profile, summary, record.reports, blockers, rawOutput),
    };
    const nextRecord = upsertDiagnosticRecord({
      ...record,
      status: "failed",
      result_quality: "failed",
      summary,
      finished_at: finishedAt,
    });
    upsertTaskRecord(nextTask);
    await Promise.all([persistDiagnosticStore(), persistTaskStore()]);
    return {
      task: nextTask,
      diagnostic: nextRecord,
    };
  }

  async function executeDiagnosticTask(task, diagnostic) {
    const node = getNodeById(task.node_id);
    if (!node) {
      return failDiagnostic(task, diagnostic, "节点不存在，无法继续执行诊断。", []);
    }

    const profile = diagnostic.profile === "deep" ? "deep" : "light";
    const staticCheck = staticGuard(node, profile);
    diagnostic.guard = {
      ...(diagnostic.guard || {}),
      static_blockers: staticCheck.blockers,
      warnings: [...(diagnostic.guard?.warnings || []), ...staticCheck.warnings],
    };

    if (staticCheck.blockers.length > 0) {
      return failDiagnostic(
        task,
        upsertDiagnosticRecord(diagnostic),
        diagnosticSummary(profile, {}, staticCheck.blockers),
        staticCheck.blockers,
      );
    }

    const sshContext = await resolveNodeSshTransport(node, {
      allowDemoFallback: false,
    });

    if (sshContext.status !== "ready" || !sshContext.transport) {
      return failDiagnostic(
        task,
        upsertDiagnosticRecord({
          ...diagnostic,
          transport: {
            kind: sshContext.transport?.kind ?? null,
            label: sshContext.transport?.label ?? null,
            note: sshContext.note ?? null,
          },
        }),
        reasonLabel(sshContext.reason_code || "diagnostic_transport_unavailable"),
        [sshContext.reason_code || "diagnostic_transport_unavailable"],
      );
    }

    diagnostic = upsertDiagnosticRecord({
      ...diagnostic,
      transport: {
        kind: sshContext.transport.kind,
        label: sshContext.transport.label,
        note: sshContext.transport.note,
        ssh_user: defaultNodeSshUser,
      },
    });
    await persistDiagnosticStore();

    const preflightExecution = await executeRemoteScript(
      spawn,
      terminateChildProcess,
      cwdProvider,
      sshContext.transport,
      buildPreflightScript(),
      30000,
    );

    if (preflightExecution.timed_out || preflightExecution.exit_code !== 0) {
      return failDiagnostic(
        task,
        diagnostic,
        reasonLabel("diagnostic_preflight_failed"),
        ["diagnostic_preflight_failed"],
        preflightExecution.output,
      );
    }

    const parsedPreflight = parseStructuredOutput(preflightExecution.output);
    const runtimeCheck = runtimeGuard(profile, parsedPreflight.meta);
    diagnostic = upsertDiagnosticRecord({
      ...diagnostic,
      preflight: runtimeCheck.snapshot,
      guard: {
        ...(diagnostic.guard || {}),
        runtime_blockers: runtimeCheck.blockers,
        warnings: [...(diagnostic.guard?.warnings || []), ...runtimeCheck.warnings],
      },
    });
    await persistDiagnosticStore();

    if (runtimeCheck.blockers.length > 0) {
      return failDiagnostic(
        task,
        diagnostic,
        diagnosticSummary(profile, {}, runtimeCheck.blockers),
        runtimeCheck.blockers,
        preflightExecution.output,
      );
    }

    const execution = await executeRemoteScript(
      spawn,
      terminateChildProcess,
      cwdProvider,
      sshContext.transport,
      buildProfileScript(profile),
      profile === "deep" ? 8 * 60 * 1000 : 4 * 60 * 1000,
    );

    const parsed = parseStructuredOutput(execution.output);
    const sections = enrichSections(parsed.sections, node);
    const outcome = diagnosticOutcome(profile, sections);
    const blockers =
      outcome.status === "failed" ? ["diagnostic_report_missing"] : [];
    const summary = diagnosticSummary(profile, sections, blockers);
    const finishedAt = nowIso();

    const nextRecord = upsertDiagnosticRecord({
      ...diagnostic,
      status: outcome.status,
      result_quality: outcome.quality,
      summary,
      reports: {
        hardware: sections.hardware || null,
        ip: sections.ip || null,
        net: sections.net || null,
      },
      finished_at: finishedAt,
    });

    const nextTask = {
      ...task,
      status: outcome.status === "failed" ? "failed" : outcome.status === "partial" ? "partial" : "success",
      finished_at: finishedAt,
      note: summary,
      log_excerpt: logExcerpt(profile, summary, nextRecord.reports, blockers, execution.output),
    };

    upsertTaskRecord(nextTask);
    await Promise.all([persistDiagnosticStore(), persistTaskStore()]);

    return {
      task: nextTask,
      diagnostic: nextRecord,
    };
  }

  async function triggerDiagnostic(node, options = {}) {
    const profile = String(options.profile || "light").trim().toLowerCase() === "deep" ? "deep" : "light";
    const hostGroupKey = inferHostGroupKey(node);
    const runningForNode = findRunningDiagnostic(node.id);
    if (runningForNode) {
      throw new Error(reasonLabel("node_diagnostic_running"));
    }
    if (profile === "deep") {
      const runningForHost = runningDeepDiagnosticForHost(hostGroupKey);
      if (runningForHost) {
        throw new Error(reasonLabel("host_deep_diagnostic_running"));
      }
    }

    const task = buildDiagnosticTask(node, {
      profile,
      trigger: options.trigger ?? "manual_diagnostic",
      reason: options.reason ?? "manual_diagnostic",
    });
    const diagnostic = upsertDiagnosticRecord(
      buildDiagnosticRecord(node, task, {
        profile,
      }),
    );
    upsertTaskRecord(task);
    await Promise.all([persistDiagnosticStore(), persistTaskStore()]);

    executeDiagnosticTask(task, diagnostic).catch(async (error) => {
      const fallbackTask = {
        ...task,
        status: "failed",
        finished_at: nowIso(),
        note: normalizeString(error?.message) || reasonLabel("diagnostic_execution_failed"),
        log_excerpt: [
          `诊断档位 ${profile}`,
          normalizeString(error?.message) || reasonLabel("diagnostic_execution_failed"),
        ],
      };
      const fallbackDiagnostic = upsertDiagnosticRecord({
        ...diagnostic,
        status: "failed",
        result_quality: "failed",
        summary: normalizeString(error?.message) || reasonLabel("diagnostic_execution_failed"),
        finished_at: nowIso(),
      });
      upsertTaskRecord(fallbackTask);
      await Promise.all([persistDiagnosticStore(), persistTaskStore()]);
      return {
        task: fallbackTask,
        diagnostic: fallbackDiagnostic,
      };
    });

    return {
      task,
      diagnostic,
    };
  }

  return {
    buildDiagnosticRecord,
    buildDiagnosticTask,
    listDiagnostics,
    reasonLabel,
    sortDiagnostics,
    triggerDiagnostic,
    upsertDiagnosticRecord,
  };
}
