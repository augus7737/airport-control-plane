import { appState } from "../store/runtime-store.js";

const defaultDistributionState = Object.freeze({
  enabled: false,
  mode: "disabled",
  default_version: "",
  mirror_base_url: "",
  auto_sync: false,
  sync_status: "idle",
  last_sync_at: null,
  last_sync_message: "",
  artifact_count: 0,
  supported_platforms: [],
});

function cloneDefaultDistributionState() {
  return {
    ...defaultDistributionState,
    supported_platforms: [],
  };
}

function normalizeDistributionState(rawState = {}) {
  const normalized = {
    ...cloneDefaultDistributionState(),
    ...(rawState && typeof rawState === "object" ? rawState : {}),
  };
  normalized.enabled = Boolean(normalized.enabled);
  normalized.auto_sync = Boolean(normalized.auto_sync);
  normalized.default_version = String(normalized.default_version || "").trim();
  normalized.mirror_base_url = String(normalized.mirror_base_url || "").trim();
  normalized.sync_status = String(normalized.sync_status || "idle").trim().toLowerCase() || "idle";
  normalized.last_sync_message = String(normalized.last_sync_message || "").trim();
  normalized.artifact_count = Number.isFinite(Number(normalized.artifact_count))
    ? Number(normalized.artifact_count)
    : 0;
  normalized.supported_platforms = Array.isArray(normalized.supported_platforms)
    ? normalized.supported_platforms
        .map((item) => String(item || "").trim())
        .filter((item) => item)
    : [];
  return normalized;
}

function getPlatformDistributionState() {
  const platform = appState.platform || {};
  const rawState =
    platform.sing_box_distribution ||
    platform.singbox_distribution ||
    platform.distribution?.sing_box ||
    platform.distribution ||
    {};
  return normalizeDistributionState(rawState);
}

function distributionStatusClass(state) {
  if (state.sync_status === "success" && state.enabled) return "active";
  if (state.sync_status === "failed") return "failed";
  if (state.enabled && !state.default_version) return "degraded";
  if (state.enabled && !state.mirror_base_url) return "degraded";
  if (!state.enabled) return "new";
  return "degraded";
}

function distributionStatusLabel(state) {
  if (state.sync_status === "success" && state.enabled) return "已就绪";
  if (state.sync_status === "failed") return "同步失败";
  if (!state.enabled) return "未启用";
  if (!state.default_version || !state.mirror_base_url) return "待完善";
  return "待同步";
}

function formatDistributionMode(state) {
  if (!state.enabled) return "关闭";
  if (state.auto_sync) return "自动 + 手动";
  return "手动";
}

function formatDistributionSyncState(state) {
  if (state.sync_status === "success") return "最近同步成功";
  if (state.sync_status === "running") return "同步中";
  if (state.sync_status === "failed") return "最近同步失败";
  if (state.sync_status === "never") return "未同步";
  return "等待首次同步";
}

function formatDistributionLastSyncAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return "未同步";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatDistributionPlatforms(state) {
  return state.supported_platforms.length ? state.supported_platforms.join(" / ") : "待配置";
}

export function createPlatformSshPageModule(dependencies = {}) {
  const {
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    formatPlatformPublicKeyPreview,
    formatPlatformSshBootstrapState,
    formatPlatformSshSource,
    getPlatformSshKeyState,
    navigatorRef = navigator,
    platformSshStatusClass,
    platformSshStatusLabel,
    renderCurrentContent,
    setPlatformContext,
    windowRef = window,
  } = dependencies;

  function renderPlatformDistributionPanel() {
    const distribution = getPlatformDistributionState();
    return `
      <article class="panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>sing-box 分发</h3>
              <p>配置平台默认二进制分发参数，保存后可手动触发一次镜像同步。</p>
            </div>
            <span class="${distributionStatusClass(distribution)}">${distributionStatusLabel(distribution)}</span>
          </div>
          <div class="detail-kv">
            <div class="kv-row"><span>分发模式</span><strong>${formatDistributionMode(distribution)}</strong></div>
            <div class="kv-row"><span>默认版本</span><strong class="mono">${escapeHtml(distribution.default_version || "-")}</strong></div>
            <div class="kv-row"><span>镜像基址</span><strong class="mono">${escapeHtml(distribution.mirror_base_url || "-")}</strong></div>
            <div class="kv-row"><span>支持平台</span><strong class="mono">${escapeHtml(formatDistributionPlatforms(distribution))}</strong></div>
            <div class="kv-row"><span>产物数量</span><strong>${distribution.artifact_count}</strong></div>
            <div class="kv-row"><span>同步状态</span><strong>${formatDistributionSyncState(distribution)}</strong></div>
            <div class="kv-row"><span>上次同步</span><strong>${formatDistributionLastSyncAt(distribution.last_sync_at)}</strong></div>
          </div>
          <form id="platform-singbox-distribution-form" class="ops-form-grid" style="margin-top:12px;">
            <label class="check-row">
              <input type="checkbox" name="enabled"${distribution.enabled ? " checked" : ""} />
              <span>启用平台分发</span>
            </label>
            <label class="check-row">
              <input type="checkbox" name="auto_sync"${distribution.auto_sync ? " checked" : ""} />
              <span>启用自动同步</span>
            </label>
            <div class="field">
              <label for="platform-singbox-default-version">默认版本</label>
              <input id="platform-singbox-default-version" name="default_version" value="${escapeHtml(distribution.default_version)}" placeholder="例如：1.11.7" />
            </div>
            <div class="field">
              <label for="platform-singbox-mirror-base-url">镜像基址</label>
              <input id="platform-singbox-mirror-base-url" name="mirror_base_url" value="${escapeHtml(distribution.mirror_base_url)}" placeholder="例如：https://your-panel.example.com/artifacts/sing-box" />
            </div>
          </form>
          ${
            distribution.last_sync_message
              ? `<div class="message ${distribution.sync_status === "failed" ? "error" : "success"}" style="margin-top:10px;">${escapeHtml(distribution.last_sync_message)}</div>`
              : ""
          }
          <div class="modal-actions" style="margin-top:12px;">
            <button class="button primary" type="button" data-singbox-distribution-save>保存配置</button>
            <button class="button ghost" type="button" data-singbox-distribution-sync>同步镜像</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderPlatformSshPanel() {
    const sshKey = getPlatformSshKeyState();
    const showGenerate = sshKey.can_generate && sshKey.status !== "ready";
    const showCopy = Boolean(sshKey.public_key);

    const sshPanel = `
      <article class="panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>平台 SSH 密钥</h3>
              <p>bootstrap 注入和控制面 SSH 接管共用这一套密钥，先把它准备好，节点才能真正进入初始化。</p>
            </div>
            <span class="${platformSshStatusClass(sshKey)}">${platformSshStatusLabel(sshKey)}</span>
          </div>
          <div class="detail-kv">
            <div class="kv-row"><span>来源</span><strong>${formatPlatformSshSource(sshKey)}</strong></div>
            <div class="kv-row"><span>自动注入</span><strong>${formatPlatformSshBootstrapState(sshKey)}</strong></div>
            <div class="kv-row"><span>私钥路径</span><strong class="mono">${escapeHtml(sshKey.private_key_path || "-")}</strong></div>
            <div class="kv-row"><span>当前状态</span><strong>${escapeHtml(sshKey.note || "可用于 bootstrap 与 SSH 接管。")}</strong></div>
          </div>
          <div class="event-list" style="margin-top:14px;">
            <div class="event">
              <strong>当前公钥</strong>
              <p class="mono">${escapeHtml(formatPlatformPublicKeyPreview(sshKey))}</p>
            </div>
          </div>
          <div class="modal-actions" style="margin-top:12px;">
            ${
              showGenerate
                ? '<button class="button primary" type="button" data-platform-generate-key>一键生成平台密钥</button>'
                : ""
            }
            ${
              showCopy
                ? '<button class="button ghost" type="button" data-platform-copy-public-key>复制平台公钥</button>'
                : ""
            }
          </div>
        </div>
      </article>
    `;

    return `${sshPanel}${renderPlatformDistributionPanel()}`;
  }

  function renderPlatformSshSummaryPanel() {
    const sshKey = getPlatformSshKeyState();
    const showGenerate = sshKey.can_generate && sshKey.status !== "ready";

    return `
      <article class="panel">
        <div class="panel-body">
          <div class="panel-title">
            <div>
              <h3>平台接管</h3>
              <p>首页先看是否具备接管能力，完整密钥信息放到令牌页集中维护。</p>
            </div>
            <span class="${platformSshStatusClass(sshKey)}">${platformSshStatusLabel(sshKey)}</span>
          </div>
          <div class="detail-kv">
            <div class="kv-row"><span>来源</span><strong>${formatPlatformSshSource(sshKey)}</strong></div>
            <div class="kv-row"><span>自动注入</span><strong>${formatPlatformSshBootstrapState(sshKey)}</strong></div>
            <div class="kv-row"><span>当前公钥</span><strong class="mono">${escapeHtml(formatPlatformPublicKeyPreview(sshKey))}</strong></div>
          </div>
          <div class="modal-actions overview-summary-actions">
            ${
              showGenerate
                ? '<button class="button primary" type="button" data-platform-generate-key>生成平台密钥</button>'
                : ""
            }
            <a class="button ghost" href="/tokens.html">去令牌页查看</a>
          </div>
        </div>
      </article>
    `;
  }

  function setupPlatformKeyActions() {
    documentRef.querySelectorAll("[data-platform-generate-key]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const trigger = event.currentTarget;
        const originalLabel = trigger.textContent;
        trigger.disabled = true;
        trigger.textContent = "生成中...";

        try {
          const response = await fetchImpl("/api/v1/platform/ssh-key/generate", {
            method: "POST",
          });
          const result = await response.json();

          if (!response.ok) {
            throw new Error(result.message || "生成平台 SSH 密钥失败");
          }

          if (result.platform_context) {
            setPlatformContext(result.platform_context);
          }

          renderCurrentContent();
          windowRef.alert(
            result.message || "平台 SSH 密钥已生成，现在新的 bootstrap 会自动把公钥写入节点。",
          );
        } catch (error) {
          trigger.disabled = false;
          trigger.textContent = originalLabel;
          windowRef.alert(error instanceof Error ? error.message : "生成平台 SSH 密钥失败");
        }
      });
    });

    documentRef.querySelectorAll("[data-platform-copy-public-key]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const sshKey = getPlatformSshKeyState();
        const ok = await navigatorRef.clipboard
          .writeText(sshKey.public_key || "")
          .then(() => true, () => false);
        event.currentTarget.textContent = ok ? "已复制公钥" : "复制失败";
      });
    });

    documentRef.querySelectorAll("[data-singbox-distribution-save]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const trigger = event.currentTarget;
        const form = documentRef.getElementById("platform-singbox-distribution-form");
        if (!form) {
          return;
        }

        const originalLabel = trigger.textContent;
        trigger.disabled = true;
        trigger.textContent = "保存中...";

        try {
          const formData = new FormData(form);
          const payload = {
            enabled: formData.get("enabled") === "on",
            auto_sync: formData.get("auto_sync") === "on",
            default_version: String(formData.get("default_version") || "").trim() || null,
            mirror_base_url: String(formData.get("mirror_base_url") || "").trim() || null,
          };

          const response = await fetchImpl("/api/v1/platform/sing-box-distribution", {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.details?.join("，") || result.message || "保存分发配置失败");
          }

          if (result.platform_context) {
            setPlatformContext(result.platform_context);
          } else if (result.sing_box_distribution || result.singbox_distribution) {
            setPlatformContext({
              sing_box_distribution: result.sing_box_distribution || result.singbox_distribution,
            });
          }

          renderCurrentContent();
          windowRef.alert(result.message || "sing-box 分发配置已保存。");
        } catch (error) {
          trigger.disabled = false;
          trigger.textContent = originalLabel;
          windowRef.alert(error instanceof Error ? error.message : "保存分发配置失败");
        }
      });
    });

    documentRef.querySelectorAll("[data-singbox-distribution-sync]").forEach((button) => {
      button.addEventListener("click", async (event) => {
        const trigger = event.currentTarget;
        const originalLabel = trigger.textContent;
        trigger.disabled = true;
        trigger.textContent = "同步中...";

        try {
          const response = await fetchImpl("/api/v1/platform/sing-box-distribution/sync", {
            method: "POST",
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.details?.join("，") || result.message || "触发镜像同步失败");
          }

          if (result.platform_context) {
            setPlatformContext(result.platform_context);
          } else if (result.sing_box_distribution || result.singbox_distribution) {
            setPlatformContext({
              sing_box_distribution: result.sing_box_distribution || result.singbox_distribution,
            });
          }

          renderCurrentContent();
          windowRef.alert(result.message || "已触发 sing-box 镜像同步。");
        } catch (error) {
          trigger.disabled = false;
          trigger.textContent = originalLabel;
          windowRef.alert(error instanceof Error ? error.message : "触发镜像同步失败");
        }
      });
    });
  }

  return {
    renderPlatformSshPanel,
    renderPlatformSshSummaryPanel,
    setupPlatformKeyActions,
  };
}
