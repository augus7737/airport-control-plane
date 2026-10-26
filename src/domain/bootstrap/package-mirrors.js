const MAINLAND_CHINA_REGION_NAMES = new Set([
  "cn",
  "prc",
  "china",
  "mainland china",
  "china mainland",
  "中国",
  "中国大陆",
  "中国内地",
  "大陆",
  "内地",
]);

const NON_MAINLAND_CHINA_REGION_PATTERN = /香港|澳门|台湾|hong\s*kong|macao|macau|taiwan/i;

export function isMainlandChinaRegion(region) {
  const normalized = String(region ?? "").trim().toLowerCase();
  if (!normalized || NON_MAINLAND_CHINA_REGION_PATTERN.test(normalized)) {
    return false;
  }

  if (MAINLAND_CHINA_REGION_NAMES.has(normalized) || /中国(?:大陆|内地)/.test(normalized)) {
    return true;
  }

  const regionTokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  return regionTokens.includes("cn") || regionTokens.includes("prc");
}

export function buildAlpineRepositoryPreparation(region) {
  if (!isMainlandChinaRegion(region)) {
    return "";
  }

  return `command -v apk >/dev/null 2>&1 && [ -f /etc/apk/repositories ] && [ ! -f /etc/apk/repositories.airport.bak ] && cp /etc/apk/repositories /etc/apk/repositories.airport.bak 2>/dev/null || true
command -v apk >/dev/null 2>&1 && [ -f /etc/apk/repositories ] && sed -i 's#https\\?://[^ ]*alpinelinux\\.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories || true`;
}
