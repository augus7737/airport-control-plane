export function statusText(status) {
  const value = String(status || "new").toLowerCase();
  if (value === "active" || value === "success" || value === "stable") return "可用";
  if (value === "partial") return "部分成功";
  if (value === "queued") return "排队中";
  if (value === "running") return "执行中";
  if (value === "disabled") return "已停用";
  if (value === "exhausted") return "已用尽";
  if (value === "degraded") return "降级";
  if (value === "failed") return "异常";
  if (value === "expired") return "已过期";
  return "待初始化";
}

export function statusClassName(status) {
  const value = String(status || "new").toLowerCase();
  if (value === "active" || value === "success" || value === "stable") {
    return "badge badge-active";
  }
  if (value === "partial" || value === "queued" || value === "running") {
    return "badge badge-running";
  }
  if (
    value === "degraded" ||
    value === "failed" ||
    value === "attention" ||
    value === "expired" ||
    value === "disabled" ||
    value === "exhausted"
  ) {
    return "badge badge-degraded";
  }
  return "badge badge-new";
}

export function shellStatusText(status) {
  const value = String(status || "idle").toLowerCase();
  if (value === "open") return "已连接";
  if (value === "starting" || value === "connecting") return "建立中";
  if (value === "closed") return "已关闭";
  if (value === "failed") return "连接失败";
  return "未连接";
}

export function shellStatusClassName(status) {
  const value = String(status || "idle").toLowerCase();
  if (value === "open") return "badge badge-active";
  if (value === "starting" || value === "connecting") return "badge badge-running";
  if (value === "failed") return "badge badge-degraded";
  if (value === "closed") return "badge badge-new";
  return "badge badge-new";
}

export function formatRelativeTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diffMs = date.getTime() - Date.now();
  const isFuture = diffMs > 0;
  const diffMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (diffMinutes < 60) return `${diffMinutes} 分钟${isFuture ? "后" : "前"}`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时${isFuture ? "后" : "前"}`;
  return `${Math.round(diffHours / 24)} 天${isFuture ? "后" : "前"}`;
}

export function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("zh-CN");
}

export function formatDateInput(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

export function formatRenewal(value) {
  return value ? "自动续费" : "手动续费";
}

export function formatTraffic(used, total) {
  if (used == null && total == null) return "-";
  if (used == null) return `${total} GB`;
  if (total == null) return `${used} GB`;
  return `${used} / ${total} GB`;
}

export function getEffectiveTokenStatus(token) {
  if (!token) {
    return "disabled";
  }

  const rawStatus = String(token.status || "active").toLowerCase();
  if (rawStatus === "disabled" || rawStatus === "exhausted") {
    return rawStatus;
  }

  if (token.expires_at) {
    const expiresAt = new Date(token.expires_at).getTime();
    if (!Number.isNaN(expiresAt) && Date.now() > expiresAt) {
      return "expired";
    }
  }

  if (
    Number.isFinite(token.max_uses) &&
    token.max_uses !== null &&
    Number(token.uses || 0) >= Number(token.max_uses)
  ) {
    return "exhausted";
  }

  return rawStatus || "active";
}

export function sortBootstrapTokens(tokens) {
  return [...tokens].sort((left, right) => {
    const leftStatus = getEffectiveTokenStatus(left);
    const rightStatus = getEffectiveTokenStatus(right);

    if (leftStatus !== rightStatus) {
      if (leftStatus === "active") return -1;
      if (rightStatus === "active") return 1;
    }

    return String(right.created_at || "").localeCompare(String(left.created_at || ""));
  });
}

export function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

export function shellQuote(value) {
  return `'${String(value || "").replace(/'/g, `'\"'\"'`)}'`;
}

export function formatTokenUsage(token) {
  const uses = Number(token?.uses || 0);
  if (Number.isFinite(token?.max_uses) && token.max_uses !== null) {
    return `${uses} / ${token.max_uses}`;
  }
  return `${uses}`;
}

export function maskTokenValue(value) {
  const raw = String(value || "");
  if (raw.length <= 10) {
    return raw || "-";
  }
  return `${raw.slice(0, 5)}••••${raw.slice(-4)}`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatOperationMode(value) {
  return value === "script" ? "脚本" : "命令";
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function normalizeOperationOutput(output) {
  if (Array.isArray(output)) {
    return output.map((line) => String(line ?? "")).join("\n");
  }

  if (typeof output === "string") {
    return output;
  }

  if (output == null) {
    return "";
  }

  if (typeof output === "object") {
    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return String(output);
    }
  }

  return String(output);
}

function parseTimestampMs(value) {
  if (!value) return null;
  const date = new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

export function resolveDurationMs(record, fallbackStart = null, fallbackEnd = null) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const direct = [record.duration_ms, record.durationMs];
  for (const item of direct) {
    const num = Number(item);
    if (Number.isFinite(num) && num >= 0) {
      return num;
    }
  }

  const durationSeconds = Number(record.duration_seconds);
  if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
    return Math.round(durationSeconds * 1000);
  }

  const startedAt = parseTimestampMs(record.started_at || record.created_at || fallbackStart);
  const finishedAt = parseTimestampMs(record.finished_at || fallbackEnd);

  if (startedAt != null && finishedAt != null && finishedAt > startedAt) {
    return finishedAt - startedAt;
  }

  return null;
}

export function formatDuration(durationMs) {
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) {
    return "未回传";
  }

  if (value < 1000) {
    return `${Math.max(1, Math.round(value))} ms`;
  }

  if (value < 60_000) {
    const seconds = value / 1000;
    return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} 秒`;
  }

  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  if (seconds === 0) {
    return `${minutes} 分钟`;
  }
  return `${minutes} 分 ${seconds} 秒`;
}

function extractExitCodeFromOutput(output) {
  const text = normalizeOperationOutput(output);
  if (!text) return null;

  const match = text.match(/(?:exit(?:[_\s-]?code)?|退出码)\s*[=:：]?\s*(-?\d+)/i);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveExitCode(target) {
  if (!target || typeof target !== "object") {
    return null;
  }

  const direct = [target.exit_code, target.exitCode];
  for (const item of direct) {
    if (item == null || item === "") continue;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : trimmed;
    }
    return String(item);
  }

  return extractExitCodeFromOutput(target.output);
}

export function formatExitCode(target) {
  const code = resolveExitCode(target);
  if (code != null && code !== "") {
    return String(code);
  }

  if (String(target?.status || "").toLowerCase() === "running") {
    return "执行中";
  }

  return "未回传";
}

export function resolveTransportLabel(target, operation = null) {
  const readLabel = (source) => {
    if (!source) return null;
    if (typeof source === "string") {
      const normalized = source.trim();
      if (!normalized) return null;
      if (normalized === "ssh-relay") return "SSH 经跳板";
      if (normalized === "ssh-proxy") return "SSH 经代理";
      if (normalized === "ssh-direct") return "SSH 直连";
      return normalized;
    }
    if (typeof source === "object") {
      if (source.label) return String(source.label);
      if (source.kind) return readLabel(source.kind);
    }
    return null;
  };

  const targetLabel =
    readLabel(target?.transport_label) ||
    readLabel(target?.transport) ||
    readLabel(target?.transport_kind);

  if (targetLabel) {
    return targetLabel;
  }

  const operationLabel =
    readLabel(operation?.transport_label) ||
    readLabel(operation?.transport) ||
    readLabel(operation?.transport_kind);

  if (operationLabel) {
    return operationLabel;
  }

  const managementAccessMode =
    target?.management_access_mode ||
    target?.requested_management_access_mode ||
    target?.access_mode;

  if (managementAccessMode === "relay") {
    return target?.transport_kind === "ssh-proxy" ? "SSH 经代理" : "SSH 经跳板";
  }
  if (managementAccessMode === "direct") return "SSH 直连";
  return "未回传";
}

export function summarizeOperationTransport(operation) {
  if (!operation) return "未回传";

  const labels = new Set();
  if (Array.isArray(operation.targets)) {
    for (const target of operation.targets) {
      const label = resolveTransportLabel(target, operation);
      if (label && label !== "未回传") {
        labels.add(label);
      }
    }
  }

  if (labels.size === 0) {
    return resolveTransportLabel(null, operation);
  }

  const values = [...labels];
  if (values.length <= 2) {
    return values.join(" / ");
  }
  return `${values.slice(0, 2).join(" / ")} 等 ${values.length} 种`;
}

export function summarizeOperationExitCode(operation) {
  if (!operation || !Array.isArray(operation.targets) || operation.targets.length === 0) {
    return "未回传";
  }

  const codes = operation.targets
    .map((target) => formatExitCode(target))
    .filter((value) => value && value !== "未回传");

  if (codes.length === 0) {
    return "未回传";
  }

  const uniqueCodes = [...new Set(codes)];
  if (uniqueCodes.length <= 3) {
    return uniqueCodes.join(" / ");
  }
  return `${uniqueCodes.slice(0, 3).join(" / ")}...`;
}

export function daysUntil(dateValue) {
  if (!dateValue) return null;
  const diff = new Date(dateValue).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function toNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
