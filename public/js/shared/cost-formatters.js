const moneyFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function normalizeTotals(input) {
  if (Array.isArray(input?.totals_by_currency)) {
    return input.totals_by_currency;
  }

  if (Array.isArray(input?.estimated_totals_by_currency)) {
    return input.estimated_totals_by_currency;
  }

  if (Number.isFinite(Number(input?.total_monthly_cost))) {
    return [
      {
        currency: String(input?.effective_currency || input?.currency || "").trim(),
        amount: Number(input.total_monthly_cost),
      },
    ];
  }

  if (Number.isFinite(Number(input?.estimated_monthly_cost))) {
    return [
      {
        currency: String(input?.currency || "").trim(),
        amount: Number(input.estimated_monthly_cost),
      },
    ];
  }

  if (Array.isArray(input)) {
    return input;
  }

  return [];
}

export function formatMoneyAmount(amount, currency = null, fallback = "待补") {
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount)) {
    return fallback;
  }

  const rendered = moneyFormatter.format(numericAmount);
  return currency ? `${currency} ${rendered}` : rendered;
}

export function formatCurrencyTotals(input, fallback = "待补") {
  const totals = normalizeTotals(input)
    .map((item) => {
      const amount = Number(item?.amount);
      const currency = String(item?.currency || "").trim();
      if (!Number.isFinite(amount) || !currency) {
        return null;
      }
      return `${currency} ${moneyFormatter.format(amount)}`;
    })
    .filter(Boolean);

  return totals.length > 0 ? totals.join(" / ") : fallback;
}

export function formatCostStatus(status, fallback = "待补") {
  switch (String(status || "").trim().toLowerCase()) {
    case "ok":
      return "已就绪";
    case "incomplete":
      return "成本缺失";
    case "unlinked_provider":
      return "未绑定厂商";
    case "invalid_cycle":
      return "周期异常";
    case "invalid_once_amortization":
      return "折旧缺失";
    default:
      return fallback;
  }
}

export function findCostItemByNodeId(items = [], nodeId) {
  return (Array.isArray(items) ? items : []).find((item) => item?.node_id === nodeId) || null;
}

export function findCostItemByProviderId(items = [], providerId) {
  return (Array.isArray(items) ? items : []).find((item) => item?.provider_id === providerId) || null;
}

export function findCostItemByReleaseId(items = [], releaseId) {
  return (Array.isArray(items) ? items : []).find((item) => item?.release_id === releaseId) || null;
}

export function findCostItemByAccessUserId(items = [], accessUserId) {
  return (
    (Array.isArray(items) ? items : []).find((item) => item?.access_user_id === accessUserId) || null
  );
}
