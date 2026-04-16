import { createNodeAssetModalEventsModule } from "./node-asset-modal-events.js";
import { createNodeAssetModalPayloadsModule } from "./node-asset-modal-payloads.js";
import { createNodeAssetModalTemplatesModule } from "./node-asset-modal-templates.js";
import { createLocationSuggestionsModule, normalizeLocationValue } from "../shared/location-suggestions.js";

export function createNodeAssetModalsModule(dependencies) {
  const {
    appState,
    documentRef = document,
    escapeHtml,
    fetchImpl = fetch,
    formatDateInput,
    getCurrentNode,
    getNodeDisplayName,
    page,
    refreshRuntimeData,
    renderCurrentContent,
    toNumberOrNull,
    upsertNode,
  } = dependencies;
  const { assetModalTemplate, manualModalTemplate } = createNodeAssetModalTemplatesModule();
  const { bindLocationAutocomplete } = createLocationSuggestionsModule({ documentRef });
  const { buildAssetPayload, buildManualNodePayload } = createNodeAssetModalPayloadsModule({
    toNumberOrNull,
  });
  const {
    bindAssetModalCoreEvents,
    bindAssetModalOpenTriggers,
    bindEscapeClose,
    bindManualModalEvents,
  } = createNodeAssetModalEventsModule({
    documentRef,
  });

  function setAssetEditorTargetNodeId(nodeId = null) {
    appState.assetEditor.targetNodeId = nodeId || null;
  }

  function getProviderOptionsHtml(selectedId = null) {
    const normalizedSelectedId = String(selectedId || "").trim();
    return [
      '<option value="">未绑定厂商台账</option>',
      ...appState.providers.map((provider) => {
        const providerId = String(provider.id || "");
        const selected = providerId === normalizedSelectedId ? " selected" : "";
        const label = provider.account_name
          ? `${provider.name || provider.id} · ${provider.account_name}`
          : provider.name || provider.id;
        return `<option value="${escapeHtml(providerId)}"${selected}>${escapeHtml(label)}</option>`;
      }),
    ].join("");
  }

  function syncProviderField(selectElement, inputElement) {
    if (!selectElement || !inputElement) {
      return;
    }

    const selectedProvider = appState.providers.find(
      (provider) => provider.id === selectElement.value,
    );
    if (selectedProvider && !String(inputElement.value || "").trim()) {
      inputElement.value = selectedProvider.name || "";
    }
  }

  function getAssetEditorNode(nodes = appState.nodes) {
    const targetNodeId = appState.assetEditor.targetNodeId;
    if (targetNodeId) {
      const matched = nodes.find((item) => item.id === targetNodeId);
      if (matched) {
        return matched;
      }
    }

    return getCurrentNode(nodes);
  }

  function setupManualModal() {
    const modal = documentRef.getElementById("manual-modal");
    const openButton = documentRef.getElementById("open-manual-modal");
    const closeButton = documentRef.getElementById("close-manual-modal");
    const form = documentRef.getElementById("manual-node-form");
    const resetButton = documentRef.getElementById("manual-reset");
    const message = documentRef.getElementById("manual-message");
    const providerSelect = documentRef.getElementById("manual-provider-id");
    const providerInput = documentRef.getElementById("manual-provider");

    if (!modal || !closeButton || !form || !message) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    const open = () => {
      if (providerSelect) {
        providerSelect.innerHTML = getProviderOptionsHtml();
      }
      modal.classList.add("open");
    };
    const close = () => modal.classList.remove("open");

    bindManualModalEvents({
      modal,
      openButton,
      closeButton,
      form,
      resetButton,
      message,
      open,
      close,
    });
    bindLocationAutocomplete(modal);
    providerSelect?.addEventListener("change", () => {
      syncProviderField(providerSelect, providerInput);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      message.innerHTML = "";

      const formData = new FormData(form);
      const payload = buildManualNodePayload(formData);

      try {
        const response = await fetchImpl("/api/v1/nodes/manual", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.details?.join("，") || result.message || "保存失败");
        }

        upsertNode(result.node);
        await refreshRuntimeData?.();
        renderCurrentContent();
        message.innerHTML = '<div class="message success">节点已录入成功，列表已更新。</div>';
        setTimeout(() => {
          form.reset();
          message.innerHTML = "";
          close();
        }, 600);
      } catch (error) {
        message.innerHTML = `<div class="message error">${
          error instanceof Error ? error.message : "保存失败"
        }</div>`;
      }
    });

    bindEscapeClose(modal, close);
  }

  function setupAssetModal() {
    const modal = documentRef.getElementById("asset-modal");
    const openButton = documentRef.getElementById("open-asset-modal");
    const closeButton = documentRef.getElementById("close-asset-modal");
    const form = documentRef.getElementById("asset-form");
    const resetButton = documentRef.getElementById("asset-reset");
    const message = documentRef.getElementById("asset-message");
    const summary = documentRef.getElementById("asset-node-summary");

    if (!modal || !closeButton || !form || !message) return;

    const fillForm = () => {
      const node = getAssetEditorNode(appState.nodes);
      if (!node) {
        if (summary) {
          summary.textContent = "当前编辑节点：-";
        }
        return;
      }

      if (summary) {
        summary.textContent = `当前编辑节点：${getNodeDisplayName(node)} · ${node.id}`;
      }

      const assetProviderSelect = documentRef.getElementById("asset-provider-id");
      if (assetProviderSelect) {
        assetProviderSelect.innerHTML = getProviderOptionsHtml(node.provider_id || null);
      }
      documentRef.getElementById("asset-provider").value = node.labels?.provider || "";
      documentRef.getElementById("asset-region").value =
        normalizeLocationValue(node.labels?.region, { scope: "region" }) || "";
      documentRef.getElementById("asset-role").value = node.labels?.role || "";
      documentRef.getElementById("asset-public-ip").value = node.facts?.public_ipv4 || "";
      documentRef.getElementById("asset-public-ipv6").value = node.facts?.public_ipv6 || "";
      documentRef.getElementById("asset-private-ip").value = node.facts?.private_ipv4 || "";
      documentRef.getElementById("asset-billing").value = node.commercial?.billing_cycle || "";
      documentRef.getElementById("asset-billing-amount").value = node.commercial?.billing_amount ?? "";
      documentRef.getElementById("asset-billing-currency").value =
        node.commercial?.billing_currency || "";
      documentRef.getElementById("asset-amortization-months").value =
        node.commercial?.amortization_months ?? "";
      documentRef.getElementById("asset-overage-price").value =
        node.commercial?.overage_price_per_gb ?? "";
      documentRef.getElementById("asset-extra-fixed-cost").value =
        node.commercial?.extra_fixed_monthly_cost ?? "";
      documentRef.getElementById("asset-billing-started-at").value =
        formatDateInput(node.commercial?.billing_started_at);
      documentRef.getElementById("asset-expire").value = formatDateInput(node.commercial?.expires_at);
      documentRef.getElementById("asset-access-mode").value = node.networking?.access_mode || "direct";
      documentRef.getElementById("asset-entry-region").value =
        normalizeLocationValue(node.networking?.entry_region, { scope: "entry" }) || "";
      documentRef.getElementById("asset-entry-port").value = node.networking?.entry_port ?? "";
      documentRef.getElementById("asset-ssh-port").value =
        node.management?.ssh_port ?? node.facts?.ssh_port ?? 19822;
      documentRef.getElementById("asset-relay-node-id").value = node.networking?.relay_node_id || "";
      documentRef.getElementById("asset-relay-label").value = node.networking?.relay_label || "";
      documentRef.getElementById("asset-relay-region").value =
        normalizeLocationValue(node.networking?.relay_region, { scope: "region" }) || "";
      documentRef.getElementById("asset-management-access-mode").value =
        node.management?.access_mode || "direct";
      documentRef.getElementById("asset-management-ssh-user").value = node.management?.ssh_user || "";
      documentRef.getElementById("asset-management-relay-node-id").value =
        node.management?.relay_node_id || "";
      documentRef.getElementById("asset-management-relay-label").value =
        node.management?.relay_label || "";
      documentRef.getElementById("asset-management-relay-region").value =
        normalizeLocationValue(node.management?.relay_region, { scope: "region" }) || "";
      documentRef.getElementById("asset-management-proxy-host").value =
        node.management?.proxy_host || "";
      documentRef.getElementById("asset-management-proxy-port").value =
        node.management?.proxy_port ?? "";
      documentRef.getElementById("asset-management-proxy-user").value =
        node.management?.proxy_user || "";
      documentRef.getElementById("asset-management-proxy-label").value =
        node.management?.proxy_label || "";
      documentRef.getElementById("asset-auto-renew").checked = Boolean(node.commercial?.auto_renew);
      documentRef.getElementById("asset-bandwidth").value = node.commercial?.bandwidth_mbps ?? "";
      documentRef.getElementById("asset-traffic-quota").value = node.commercial?.traffic_quota_gb ?? "";
      documentRef.getElementById("asset-traffic-used").value = node.commercial?.traffic_used_gb ?? "";
      documentRef.getElementById("asset-route-note").value = node.networking?.route_note || "";
      documentRef.getElementById("asset-management-route-note").value =
        node.management?.route_note || "";
      documentRef.getElementById("asset-cost-note").value = node.commercial?.cost_note || "";
      documentRef.getElementById("asset-note").value = node.commercial?.note || "";
    };

    const open = () => {
      fillForm();
      message.innerHTML = "";
      modal.classList.add("open");
    };
    const close = () => {
      modal.classList.remove("open");
      if (page !== "node-detail") {
        setAssetEditorTargetNodeId(null);
      }
    };

    if (modal.dataset.coreBound !== "1") {
      modal.dataset.coreBound = "1";
      bindLocationAutocomplete(modal);
      documentRef.getElementById("asset-provider-id")?.addEventListener("change", () => {
        syncProviderField(
          documentRef.getElementById("asset-provider-id"),
          documentRef.getElementById("asset-provider"),
        );
      });
      bindAssetModalCoreEvents({
        modal,
        closeButton,
        close,
        resetButton,
        fillForm,
      });

      form.onsubmit = async (event) => {
        event.preventDefault();
        message.innerHTML = "";

        const formData = new FormData(form);
        const node = getAssetEditorNode(appState.nodes);
        if (!node) {
          message.innerHTML = '<div class="message error">当前节点不存在。</div>';
          return;
        }
        const payload = buildAssetPayload(formData);

        try {
          const response = await fetchImpl(`/api/v1/nodes/${encodeURIComponent(node.id)}/assets`, {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.details?.join("，") || result.message || "保存失败");
          }

          upsertNode(result.node);
          await refreshRuntimeData?.();
          renderCurrentContent();
          message.innerHTML = '<div class="message success">资产信息已更新。</div>';
          setTimeout(() => {
            message.innerHTML = "";
            close();
          }, 500);
        } catch (error) {
          message.innerHTML = `<div class="message error">${
            error instanceof Error ? error.message : "保存失败"
          }</div>`;
        }
      };

      bindEscapeClose(modal, close);
    }

    bindAssetModalOpenTriggers({
      openButton,
      onOpenCurrentNode: () => {
        const currentNode = getCurrentNode(appState.nodes);
        setAssetEditorTargetNodeId(currentNode?.id || null);
        open();
      },
      onOpenFromNodeId: (nodeId) => {
        setAssetEditorTargetNodeId(nodeId);
        open();
      },
    });
  }

  return {
    assetModalTemplate,
    manualModalTemplate,
    setupAssetModal,
    setupManualModal,
  };
}
