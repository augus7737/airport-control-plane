import { formatLocationDisplay } from "../shared/location-suggestions.js";

export function createNodeCellHelpersModule(dependencies = {}) {
  const {
    escapeHtml,
    formatIpSourceLabel,
    formatNodeConfigMeta,
    formatNodeConfigSpecs,
    formatNodeConfiguration,
    formatNodeSshPort,
    getPrimaryPublicIpRecord,
    getPublicIpRecords,
    shortenIpAddress,
  } = dependencies;

  function renderNodeConfigurationCell(node) {
    const specs = formatNodeConfigSpecs(node);
    const meta = formatNodeConfigMeta(node);
    const kernelVersion = node?.facts?.kernel_version || "-";
    const sshPort = formatNodeSshPort(node);
    const summary = formatNodeConfiguration(node);

    return `
      <div class="cell-hover-card">
        <div class="compact-inline-summary" aria-label="${escapeHtml(meta)}">
          ${escapeHtml(summary)}
        </div>
        <div class="cell-hover-panel">
          <div class="cell-hover-title">基础配置</div>
          <div class="cell-hover-grid">
            ${specs
              .map(
                (spec) => `
                  <div class="cell-hover-row">
                    <span>${spec.label}</span>
                    <strong>${escapeHtml(spec.value)}</strong>
                  </div>
                `,
              )
              .join("")}
            <div class="cell-hover-row">
              <span>系统</span>
              <strong>${escapeHtml(meta)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>内核</span>
              <strong>${escapeHtml(kernelVersion)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>SSH</span>
              <strong>${escapeHtml(sshPort)}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPublicIpCell(node) {
    const records = getPublicIpRecords(node);
    const privateIpv4 = node?.facts?.private_ipv4 || null;
    const regionLabel = formatLocationDisplay(node?.labels?.region, {
      scope: "region",
      style: "compact",
      fallback: "未标记",
    });
    const primaryRecord = getPrimaryPublicIpRecord(records);
    const secondaryRecords = primaryRecord
      ? records.filter((record) => record.address !== primaryRecord.address)
      : [];
    const stackHint =
      secondaryRecords.length > 0
        ? secondaryRecords.map((record) => `+${record.short}`).join(" ")
        : "";

    const summaryHtml =
      primaryRecord
        ? `
            <div class="compact-ip-inline">
              <span class="compact-ip-tag">${primaryRecord.short}</span>
              <span class="compact-ip-address mono">${escapeHtml(shortenIpAddress(primaryRecord.address))}</span>
            </div>
            ${
              stackHint
                ? `<span class="compact-inline-stack">${escapeHtml(stackHint)}</span>`
                : ""
            }
          `
        : privateIpv4
          ? '<span class="compact-empty-tag">仅内网</span>'
          : '<span class="compact-empty-tag">待探测</span>';

    const detailsHtml =
      records.length > 0
        ? records
            .map(
              (record) => `
                <div class="ip-detail-block">
                  <div class="cell-hover-row">
                    <span>${record.family}</span>
                    <strong class="mono">${escapeHtml(record.address)}</strong>
                  </div>
                  <div class="cell-hover-row">
                    <span>归属</span>
                    <strong>${escapeHtml(record.location || "-")}</strong>
                  </div>
                  <div class="cell-hover-row">
                    <span>运营商</span>
                    <strong>${escapeHtml(record.owner || "-")}</strong>
                  </div>
                  <div class="cell-hover-row">
                    <span>来源</span>
                    <strong>${escapeHtml(formatIpSourceLabel(record.source))}</strong>
                  </div>
                </div>
              `,
            )
            .join("")
        : `
            <div class="ip-detail-block">
              <div class="cell-hover-row">
                <span>公网地址</span>
                <strong>未探测到</strong>
              </div>
            </div>
          `;

    return `
      <div class="cell-hover-card cell-hover-card-ip">
        <div class="compact-ip-main">${summaryHtml}</div>
        <div class="cell-hover-panel">
          <div class="cell-hover-title">公网地址与归属</div>
          <div class="cell-hover-grid">
            ${detailsHtml}
            <div class="cell-hover-row">
              <span>标签国家</span>
              <strong>${escapeHtml(regionLabel)}</strong>
            </div>
            <div class="cell-hover-row">
              <span>内网 IPv4</span>
              <strong class="mono">${escapeHtml(privateIpv4 || "-")}</strong>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return {
    renderNodeConfigurationCell,
    renderPublicIpCell,
  };
}
