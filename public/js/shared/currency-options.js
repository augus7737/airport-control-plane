export const DEFAULT_CURRENCY = "CNY";

export const currencyOptions = [
  ["CNY", "CNY · 人民币"],
  ["USD", "USD · 美元"],
  ["EUR", "EUR · 欧元"],
  ["HKD", "HKD · 港币"],
  ["SGD", "SGD · 新加坡元"],
  ["JPY", "JPY · 日元"],
  ["KRW", "KRW · 韩元"],
  ["BRL", "BRL · 巴西雷亚尔"],
  ["GBP", "GBP · 英镑"],
  ["AUD", "AUD · 澳元"],
  ["CAD", "CAD · 加元"],
  ["MYR", "MYR · 马来西亚林吉特"],
  ["THB", "THB · 泰铢"],
  ["VND", "VND · 越南盾"],
  ["IDR", "IDR · 印尼盾"],
  ["PHP", "PHP · 菲律宾比索"],
  ["INR", "INR · 印度卢比"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function normalizeCurrencyCode(value) {
  return String(value || "").trim().toUpperCase();
}

export function renderCurrencyOptions(selectedValue = "", options = {}) {
  const selected = normalizeCurrencyCode(selectedValue);
  const includeEmpty = options.includeEmpty !== false;
  const emptyLabel = String(options.emptyLabel || "未填写");
  const knownValues = new Set(currencyOptions.map(([currency]) => currency));
  const customOption =
    selected && !knownValues.has(selected)
      ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} · 当前值</option>`
      : "";

  return `
    ${includeEmpty ? `<option value="">${escapeHtml(emptyLabel)}</option>` : ""}
    ${currencyOptions
      .map(
        ([currency, label]) => `
          <option value="${escapeHtml(currency)}"${selected === currency ? " selected" : ""}>${escapeHtml(label)}</option>
        `,
      )
      .join("")}
    ${customOption}
  `;
}

export function ensureCurrencySelectValue(select, value) {
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }

  const normalizedValue = normalizeCurrencyCode(value);
  if (!normalizedValue) {
    select.value = "";
    return;
  }

  const hasOption = [...select.options].some((option) => option.value === normalizedValue);
  if (!hasOption) {
    const option = new Option(`${normalizedValue} · 当前值`, normalizedValue, true, true);
    select.add(option);
  }

  select.value = normalizedValue;
}
