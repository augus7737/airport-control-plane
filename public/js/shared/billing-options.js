export const billingCycleOptions = [
  ["月付", "月付"],
  ["季付", "季付"],
  ["年付", "年付"],
  ["周付", "周付"],
  ["日付", "日付"],
  ["小时付", "小时付"],
  ["一次性", "一次性"],
];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderBillingCycleOptions(selectedValue = "", options = {}) {
  const selected = String(selectedValue || "").trim();
  const emptyLabel = String(options.emptyLabel || "未填写");
  const includeEmpty = options.includeEmpty !== false;
  const knownValues = new Set(billingCycleOptions.map(([value]) => value));
  const customOption =
    selected && !knownValues.has(selected)
      ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} · 当前值</option>`
      : "";

  return `
    ${includeEmpty ? `<option value="">${escapeHtml(emptyLabel)}</option>` : ""}
    ${billingCycleOptions
      .map(
        ([value, label]) => `
          <option value="${escapeHtml(value)}"${selected === value ? " selected" : ""}>${escapeHtml(label)}</option>
        `,
      )
      .join("")}
    ${customOption}
  `;
}
