const BILLING_CYCLE_ALIASES = new Map([
  ["month", "月付"],
  ["monthly", "月付"],
  ["月", "月付"],
  ["月付", "月付"],
  ["quarter", "季付"],
  ["quarterly", "季付"],
  ["季", "季付"],
  ["季付", "季付"],
  ["year", "年付"],
  ["yearly", "年付"],
  ["annual", "年付"],
  ["annually", "年付"],
  ["年", "年付"],
  ["年付", "年付"],
  ["week", "周付"],
  ["weekly", "周付"],
  ["周", "周付"],
  ["周付", "周付"],
  ["day", "日付"],
  ["daily", "日付"],
  ["日", "日付"],
  ["日付", "日付"],
  ["hour", "小时付"],
  ["hourly", "小时付"],
  ["小时", "小时付"],
  ["小时付", "小时付"],
  ["once", "一次性"],
  ["one-time", "一次性"],
  ["one_time", "一次性"],
  ["lifetime", "一次性"],
  ["一次", "一次性"],
  ["一次性", "一次性"],
]);

export const SUPPORTED_BILLING_CYCLES = [
  "月付",
  "季付",
  "年付",
  "周付",
  "日付",
  "小时付",
  "一次性",
];

export function normalizeNullableNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const nextValue =
    typeof value === "string" ? Number.parseFloat(value.trim()) : Number(value);
  return Number.isFinite(nextValue) ? nextValue : fallback;
}

export function normalizeNullableInteger(value, fallback = null) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const nextValue =
    typeof value === "string" ? Number.parseInt(value.trim(), 10) : Number(value);
  return Number.isInteger(nextValue) ? nextValue : fallback;
}

export function normalizeCostCurrency(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized) {
    return fallback;
  }

  return /^[A-Z][A-Z0-9_-]{1,9}$/.test(normalized) ? normalized : fallback;
}

export function normalizeBillingCycle(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return fallback;
  }

  return BILLING_CYCLE_ALIASES.get(normalized.toLowerCase()) ?? fallback;
}

export function normalizeBudgetThreshold(value, fallback = null) {
  const numericValue = normalizeNullableNumber(value, fallback);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }

  return numericValue <= 1 ? numericValue * 100 : numericValue;
}
