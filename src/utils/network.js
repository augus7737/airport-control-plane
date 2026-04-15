import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export function normalizeNullableString(value) {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

export function normalizeIpLiteral(value) {
  const raw = normalizeNullableString(value);
  if (!raw) {
    return null;
  }

  return raw.replace(/^\[|\]$/g, "");
}

export function isLoopbackHost(hostname) {
  const normalized = String(hostname ?? "").trim().toLowerCase();
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0"
  );
}

export function isPrivateIpv4(address) {
  const value = String(address ?? "").trim();
  return (
    value.startsWith("10.") ||
    value.startsWith("127.") ||
    value.startsWith("0.") ||
    value.startsWith("169.254.") ||
    value.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(value)
  );
}

export function isPrivateIpv6(address) {
  const value = String(address ?? "").trim().toLowerCase();
  return (
    value === "::1" ||
    value.startsWith("fe80:") ||
    value.startsWith("fc") ||
    value.startsWith("fd")
  );
}

export function isPublicIpv4(address) {
  const value = normalizeIpLiteral(address);
  return isIP(value ?? "") === 4 && !isPrivateIpv4(value);
}

export function isPublicIpv6(address) {
  const value = normalizeIpLiteral(address);
  return isIP(value ?? "") === 6 && !isPrivateIpv6(value);
}

export function scoreLanInterface(name, address) {
  const interfaceName = String(name ?? "").toLowerCase();
  let score = 0;

  if (/^(en\d+|eth\d+|ens\d+|eno\d+|wlan\d+|wlp\d+)/.test(interfaceName)) {
    score += 50;
  }

  if (
    /(docker|br-|veth|virbr|vmnet|utun|tailscale|wg|zerotier|bridge|lo|gif|stf)/.test(
      interfaceName,
    )
  ) {
    score -= 100;
  }

  if (String(address).startsWith("192.168.")) {
    score += 30;
  } else if (String(address).startsWith("10.")) {
    score += 20;
  } else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(String(address))) {
    score += 10;
  }

  return score;
}

export function getPreferredLanIpv4() {
  const interfaces = networkInterfaces();
  const candidates = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== "IPv4" || !isPrivateIpv4(entry.address)) {
        continue;
      }

      candidates.push({
        name,
        address: entry.address,
        score: scoreLanInterface(name, entry.address),
      });
    }
  }

  candidates.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));
  return candidates[0]?.address ?? null;
}

export function samePrivateIpv4Subnet(left, right) {
  if (!isPrivateIpv4(left) || !isPrivateIpv4(right)) {
    return false;
  }

  const leftParts = String(left).split(".");
  const rightParts = String(right).split(".");
  if (leftParts.length !== 4 || rightParts.length !== 4) {
    return false;
  }

  return leftParts.slice(0, 3).join(".") === rightParts.slice(0, 3).join(".");
}
