export function getAccessMode(node) {
  return node?.networking?.access_mode || "direct";
}

export function formatAccessMode(value) {
  return value === "relay" ? "经中转" : "直连";
}

export function getNodeDisplayName(node) {
  return node?.facts?.hostname || node?.id || "未命名节点";
}

export function formatMemoryConfig(memoryMb) {
  const value = Number(memoryMb);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (value >= 1024) {
    const sizeGb = value / 1024;
    const display = Number.isInteger(sizeGb) ? String(sizeGb) : sizeGb.toFixed(1).replace(/\.0$/, "");
    return `${display}G`;
  }

  return `${value}M`;
}

export function formatDiskConfig(diskGb) {
  const value = Number(diskGb);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  const display = Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${display}G`;
}

export function formatNodeConfiguration(node) {
  const cpu = Number(node?.facts?.cpu_cores);
  const cpuLabel = Number.isFinite(cpu) && cpu > 0 ? `${cpu}C` : null;
  const memoryLabel = formatMemoryConfig(node?.facts?.memory_mb);
  const diskLabel = formatDiskConfig(node?.facts?.disk_gb);
  const parts = [cpuLabel, memoryLabel, diskLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

export function formatNodeConfigSpecs(node) {
  const cpu = Number(node?.facts?.cpu_cores);
  const memoryLabel = formatMemoryConfig(node?.facts?.memory_mb);
  const diskLabel = formatDiskConfig(node?.facts?.disk_gb);

  return [
    {
      label: "CPU",
      short: Number.isFinite(cpu) && cpu > 0 ? `${cpu}C` : "-",
      value: Number.isFinite(cpu) && cpu > 0 ? `${cpu} 核` : "-",
    },
    {
      label: "内存",
      short: memoryLabel || "-",
      value: memoryLabel ? memoryLabel.replace("G", " GB").replace("M", " MB") : "-",
    },
    {
      label: "磁盘",
      short: diskLabel || "-",
      value: diskLabel ? `${diskLabel.replace("G", " GB")} 系统盘` : "-",
    },
  ];
}

export function formatNodeConfigMeta(node) {
  const segments = [
    [node?.facts?.os_name, node?.facts?.os_version].filter(Boolean).join(" "),
    node?.facts?.arch || null,
  ].filter(Boolean);

  return segments.length > 0 ? segments.join(" · ") : "系统信息待补充";
}

export function formatNodeSshPort(node) {
  const port = Number(node?.facts?.ssh_port ?? 19822);
  return Number.isInteger(port) && port > 0 ? String(port) : "19822";
}

export function formatIpSourceLabel(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source) return "-";
  if (source === "cip.cc") return "cip.cc 探测";
  if (source === "ipify") return "ipify 探测";
  if (source === "request-peer") return "控制面请求源";
  if (source === "manual_override") return "手工覆盖";
  if (source === "manual") return "手工指定";
  return value;
}

export function shortenIpAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return "-";
  if (!raw.includes(":") || raw.length <= 18) {
    return raw;
  }
  return `${raw.slice(0, 9)}…${raw.slice(-6)}`;
}

export function getPrimaryPublicIpRecord(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  return records.find((item) => item.family === "IPv4") || records[0];
}

export function getPublicIpRecords(node) {
  const facts = node?.facts || {};
  return [
    {
      family: "IPv4",
      short: "v4",
      address: facts.public_ipv4 || null,
      location: facts.public_ipv4_location || null,
      owner: facts.public_ipv4_owner || null,
      source: facts.public_ipv4_source || null,
    },
    {
      family: "IPv6",
      short: "v6",
      address: facts.public_ipv6 || null,
      location: facts.public_ipv6_location || null,
      owner: facts.public_ipv6_owner || null,
      source: facts.public_ipv6_source || null,
    },
  ].filter((item) => item.address);
}

export function formatNodeIpOwnershipSummary(node) {
  const records = getPublicIpRecords(node);
  if (records.length === 0) {
    return node?.facts?.private_ipv4 ? "仅检测到内网地址" : "未探测到公网地址";
  }

  return records
    .map((record) => {
      const parts = [record.location, record.owner].filter(Boolean);
      return parts.length > 0 ? `${record.family} · ${parts.join(" / ")}` : `${record.family} · 未识别`;
    })
    .join("；");
}

export function formatExpiryCountdown(days) {
  if (days == null) {
    return "待补充";
  }
  if (days < 0) {
    return `过期 ${Math.abs(days)} 天`;
  }
  if (days === 0) {
    return "今日到期";
  }
  return `${days} 天`;
}

export function getExpiryTone(days) {
  if (days == null) {
    return "blue";
  }
  if (days < 0) {
    return "red";
  }
  if (days <= 7) {
    return "yellow";
  }
  return "green";
}
