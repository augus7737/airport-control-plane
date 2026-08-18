import { createPlatformSshPresentationModule } from "./platform-ssh-presentation.js";
import { createProvisioningCommandModule } from "./provisioning-commands.js";

export function createProvisioningModalsModule(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    getBootstrapScriptUrl,
    getPlatformBaseUrl,
    getPlatformSshKeyState,
    getPrimaryBootstrapToken,
    navigatorRef = navigator,
    page,
    renderCurrentContent,
    shellQuote,
    toNumberOrNull,
    upsertBootstrapToken,
    windowRef = window,
  } = dependencies;
  const {
    getBootstrapCommand,
    getBootstrapEnrollCommand,
    getBootstrapMirrorCommand,
    getBootstrapPrepareCommand,
    renderBootstrapCommandPair,
  } = createProvisioningCommandModule({
    escapeHtml,
    getBootstrapScriptUrl,
    getPlatformBaseUrl,
    getPrimaryBootstrapToken,
    shellQuote,
  });
  const {
    formatPlatformPublicKeyPreview,
    formatPlatformSshBootstrapState,
    formatPlatformSshSource,
    platformSshStatusClass,
    platformSshStatusLabel,
  } = createPlatformSshPresentationModule({
    getPlatformSshKeyState,
  });

  function refreshBootstrapCommandDom() {
    const primaryToken = getPrimaryBootstrapToken();
    const baseUrl = getPlatformBaseUrl();
    const sshKey = getPlatformSshKeyState();
    const mirrorCommand = getBootstrapMirrorCommand();
    const enrollCommand = getBootstrapEnrollCommand();
    const prepareCommand = getBootstrapPrepareCommand();

    documentRef
      .querySelectorAll(
        "#bootstrap-command-mirror, #bootstrap-command-inline-mirror, #modal-command-mirror",
      )
      .forEach((element) => {
        element.textContent = mirrorCommand;
      });

    documentRef
      .querySelectorAll(
        "#bootstrap-command-prepare, #bootstrap-command-inline-prepare, #modal-command-prepare",
      )
      .forEach((element) => {
        element.textContent = prepareCommand;
      });

    documentRef
      .querySelectorAll(
        "#bootstrap-command-enroll, #bootstrap-command-inline-enroll, #modal-command-enroll",
      )
      .forEach((element) => {
        element.textContent = enrollCommand;
      });

    const tokenChip = documentRef.getElementById("current-bootstrap-token");
    if (tokenChip) {
      tokenChip.textContent = primaryToken ? primaryToken.label || primaryToken.id : "未配置";
    }

    const baseChip = documentRef.getElementById("current-bootstrap-base");
    if (baseChip) {
      baseChip.textContent = baseUrl;
    }

    const sshChip = documentRef.getElementById("current-platform-ssh");
    if (sshChip) {
      sshChip.textContent = platformSshStatusLabel(sshKey);
    }
  }

  function shouldShowBootstrapHero(targetPage = page) {
    return targetPage === "nodes";
  }

  function shouldShowProvisioningChips(targetPage = page) {
    return ["overview", "nodes", "tokens"].includes(targetPage);
  }

  function enrollModalTemplate() {
    return `
      <div class="modal-backdrop" id="enroll-modal">
        <div class="modal">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>纳管新节点</h3>
                <p>目标是让新机器自己完成登记，再进入平台控制面，而不是靠手工录表。</p>
              </div>
              <button class="close" id="close-enroll-modal" aria-label="关闭">×</button>
            </div>
            <div class="guide-list">
              <section class="guide-card">
                <span class="guide-step">命令区</span>
                <h4>复制下面 1 条命令到新设备执行</h4>
                <p>脚本会自动换源、补齐依赖、启动 SSH，并把节点注册到控制面。</p>
                <form class="form-grid" id="bootstrap-command-options">
                  <div class="field">
                    <label for="bootstrap-option-hostname">主机名</label>
                    <input id="bootstrap-option-hostname" name="hostname" placeholder="例如 br1" />
                  </div>
                  <div class="field">
                    <label for="bootstrap-option-public-ipv4">公网 IPv4</label>
                    <input id="bootstrap-option-public-ipv4" name="public_ipv4" placeholder="例如 163.176.224.226" />
                  </div>
                  <div class="field">
                    <label for="bootstrap-option-ssh-port">外部 SSH 端口</label>
                    <input id="bootstrap-option-ssh-port" name="ssh_port" value="22" placeholder="LXC 映射端口，例如 38022" />
                  </div>
                  <div class="field">
                    <label for="bootstrap-option-provider">厂商</label>
                    <input id="bootstrap-option-provider" name="provider" placeholder="例如 deeprush" />
                  </div>
                  <div class="field">
                    <label for="bootstrap-option-region">地区</label>
                    <input id="bootstrap-option-region" name="region" placeholder="例如 BR" />
                  </div>
                </form>
                <div id="modal-bootstrap-commands">${renderBootstrapCommandPair(null, {
                  singleScript: true,
                  mirrorId: "modal-command-mirror",
                  prepareId: "modal-command-prepare",
                  enrollId: "modal-command-enroll",
                  mirrorTitle: "切换国内镜像源",
                  mirrorHint: "适用于中国大陆网络环境的 Alpine 节点。",
                  prepareTitle: "更新并安装必要软件",
                  prepareHint: "补齐 curl、openssh 和证书后再接管。",
                  enrollTitle: "执行一键接管脚本",
                  enrollHint: "前两步完成后，再执行这一条。",
                })}</div>
                <div class="modal-actions">
                  <button class="button primary" id="copy-enroll-command">复制一键接管脚本</button>
                  <button class="button ghost" id="copy-full-bootstrap-command">复制传统三步</button>
                  <button class="button ghost" id="copy-mirror-command">复制换源</button>
                  <button class="button ghost" id="copy-prepare-command">复制依赖安装</button>
                  <button class="button ghost" id="copy-script-url">复制脚本地址</button>
                </div>
              </section>
              <section class="guide-card">
                <span class="guide-step">登记完成</span>
                <h4>自动建立节点档案</h4>
                <p>执行接管命令后，平台会为节点生成唯一 ID，并登记系统事实信息。</p>
              </section>
              <section class="guide-card">
                <span class="guide-step">纳入平台</span>
                <h4>进入统一生命周期</h4>
                <p>注册完成后可继续进入初始化、探测、评分、修复、替换等流程。</p>
              </section>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function tokenModalTemplate() {
    return `
      <div class="modal-backdrop" id="token-modal">
        <div class="modal">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>创建注册令牌</h3>
                <p>先定义用途，再决定有效期和使用上限。新机器执行命令时，就从这里领取一个可审计的入口凭证。</p>
              </div>
              <button class="close" id="close-token-modal" aria-label="关闭">×</button>
            </div>

            <form id="token-form" class="form-grid">
              <div class="field">
                <label for="token-label">用途 / 范围</label>
                <input id="token-label" name="label" placeholder="例如 默认边缘节点 / 迁移批次 A / 老节点补录" required />
              </div>
              <div class="field">
                <label for="token-expire">到期时间</label>
                <input id="token-expire" name="expires_at" type="date" />
              </div>
              <div class="field">
                <label for="token-max-uses">最大使用次数</label>
                <input id="token-max-uses" name="max_uses" type="number" min="1" placeholder="留空表示不限制" />
              </div>
              <div class="field">
                <label for="token-note">备注</label>
                <input id="token-note" name="note" placeholder="例如 用于 4 月新增香港与日本节点" />
              </div>
              <div class="field full">
                <div class="modal-actions">
                  <button class="button primary" type="submit">创建令牌</button>
                  <button class="button ghost" type="button" id="token-reset">清空表单</button>
                </div>
                <div id="token-message"></div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  async function writeClipboard(value) {
    return navigatorRef.clipboard.writeText(value).then(() => true, () => false);
  }

  function bindEscapeClose(modal, close) {
    if (modal.dataset.escapeBound === "1") {
      return;
    }

    modal.dataset.escapeBound = "1";
    documentRef.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
      }
    });
  }

  function setupModal() {
    const modal = documentRef.getElementById("enroll-modal");
    const openButton = documentRef.getElementById("open-enroll-modal");
    const closeButton = documentRef.getElementById("close-enroll-modal");
    if (!modal || !closeButton) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    const open = () => modal.classList.add("open");
    const close = () => modal.classList.remove("open");
    const buildEnrollOptions = () => ({
      hostname: documentRef.getElementById("bootstrap-option-hostname")?.value || "",
      publicIpv4: documentRef.getElementById("bootstrap-option-public-ipv4")?.value || "",
      sshPort: documentRef.getElementById("bootstrap-option-ssh-port")?.value || "22",
      provider: documentRef.getElementById("bootstrap-option-provider")?.value || "",
      region: documentRef.getElementById("bootstrap-option-region")?.value || "",
    });
    const syncEnrollCommand = () => {
      const element = documentRef.getElementById("modal-command-enroll");
      if (element) {
        element.textContent = getBootstrapEnrollCommand(null, buildEnrollOptions());
      }
    };

    openButton?.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });

    documentRef.getElementById("copy-prepare-command")?.addEventListener("click", async (event) => {
      const ok = await writeClipboard(getBootstrapPrepareCommand());
      event.currentTarget.textContent = ok ? "已复制步骤 2" : "复制失败";
    });

    documentRef.getElementById("copy-mirror-command")?.addEventListener("click", async (event) => {
      const ok = await writeClipboard(getBootstrapMirrorCommand());
      event.currentTarget.textContent = ok ? "已复制步骤 1" : "复制失败";
    });

    documentRef.getElementById("copy-enroll-command")?.addEventListener("click", async (event) => {
      syncEnrollCommand();
      const ok = await writeClipboard(getBootstrapEnrollCommand(null, buildEnrollOptions()));
      event.currentTarget.textContent = ok ? "已复制一键脚本" : "复制失败";
    });

    documentRef.getElementById("copy-full-bootstrap-command")?.addEventListener("click", async (event) => {
      syncEnrollCommand();
      const command = [
        "# 步骤 1：切换国内镜像源",
        getBootstrapMirrorCommand(),
        "",
        "# 步骤 2：更新并安装必要软件",
        getBootstrapPrepareCommand(),
        "",
        "# 步骤 3：执行一键接管",
        getBootstrapEnrollCommand(null, buildEnrollOptions()),
      ].join("\n");
      const ok = await writeClipboard(command);
      event.currentTarget.textContent = ok ? "已复制完整三步" : "复制失败";
    });

    documentRef.getElementById("copy-script-url")?.addEventListener("click", async (event) => {
      const ok = await writeClipboard(getBootstrapScriptUrl());
      event.currentTarget.textContent = ok ? "已复制地址" : "复制失败";
    });

    bindEscapeClose(modal, close);
    documentRef
      .querySelectorAll("#bootstrap-command-options input")
      .forEach((input) => input.addEventListener("input", syncEnrollCommand));
    syncEnrollCommand();
  }

  function setupTokenModal() {
    const modal = documentRef.getElementById("token-modal");
    const openButton = documentRef.getElementById("open-token-modal");
    const closeButton = documentRef.getElementById("close-token-modal");
    const form = documentRef.getElementById("token-form");
    const resetButton = documentRef.getElementById("token-reset");
    const message = documentRef.getElementById("token-message");

    if (!modal || !closeButton || !form || !message) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    const clearMessage = () => {
      message.innerHTML = "";
    };

    const open = () => modal.classList.add("open");
    const close = () => modal.classList.remove("open");

    openButton?.addEventListener("click", open);
    closeButton.addEventListener("click", close);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) close();
    });

    resetButton?.addEventListener("click", () => {
      form.reset();
      clearMessage();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearMessage();

      const formData = new FormData(form);
      const payload = {
        label: String(formData.get("label") || "").trim(),
        expires_at: String(formData.get("expires_at") || "").trim() || null,
        max_uses: toNumberOrNull(formData.get("max_uses")),
        note: String(formData.get("note") || "").trim() || null,
      };

      try {
        const response = await fetchImpl("/api/v1/bootstrap-tokens", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.details?.join("，") || result.message || "创建失败");
        }

        appState.tokenConsole.lastCreatedToken = result.token;
        upsertBootstrapToken(result.token);
        renderCurrentContent();

        const bootstrapCommand = getBootstrapCommand(result.token.token);
        message.innerHTML = `
          <div class="message success">
            <strong>令牌已创建。</strong><br />
            注册令牌页只保留令牌管理，不再直接铺开纳管步骤。需要接管新机器时，请去节点清单或总览里的“纳管新节点”入口。
            <div class="detail-kv" style="margin-top:12px;">
              <div class="kv-row"><span>令牌标签</span><strong>${escapeHtml(result.token.label || result.token.id)}</strong></div>
              <div class="kv-row"><span>令牌值</span><strong class="mono">${escapeHtml(result.token.token || "-")}</strong></div>
            </div>
            <div class="modal-actions" style="margin-top:12px;">
              <button class="button primary" type="button" id="copy-created-bootstrap-command">复制接管命令</button>
              <button class="button ghost" type="button" id="copy-created-token">复制令牌值</button>
              <a class="button ghost" href="/nodes.html">去节点清单</a>
            </div>
          </div>
        `;

        documentRef
          .getElementById("copy-created-bootstrap-command")
          ?.addEventListener("click", async (clickEvent) => {
            const ok = await writeClipboard(bootstrapCommand);
            clickEvent.currentTarget.textContent = ok ? "已复制接管命令" : "复制失败";
          });

        documentRef.getElementById("copy-created-token")?.addEventListener("click", async (clickEvent) => {
          const ok = await writeClipboard(result.token.token || "");
          clickEvent.currentTarget.textContent = ok ? "已复制令牌" : "复制失败";
        });

        form.reset();
      } catch (error) {
        message.innerHTML = `<div class="message error">${
          error instanceof Error ? error.message : "创建失败"
        }</div>`;
      }
    });

    bindEscapeClose(modal, close);
  }

  return {
    enrollModalTemplate,
    formatPlatformPublicKeyPreview,
    formatPlatformSshBootstrapState,
    formatPlatformSshSource,
    getBootstrapCommand,
    getBootstrapEnrollCommand,
    getBootstrapMirrorCommand,
    getBootstrapPrepareCommand,
    platformSshStatusClass,
    platformSshStatusLabel,
    refreshBootstrapCommandDom,
    renderBootstrapCommandPair,
    setupModal,
    setupTokenModal,
    shouldShowBootstrapHero,
    shouldShowProvisioningChips,
    tokenModalTemplate,
  };
}
