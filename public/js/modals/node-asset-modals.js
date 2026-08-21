import { createNodeAssetModalEventsModule } from "./node-asset-modal-events.js";
import { createNodeAssetModalPayloadsModule } from "./node-asset-modal-payloads.js";
import { createNodeAssetModalTemplatesModule } from "./node-asset-modal-templates.js";
import {
  createLocationSuggestionsModule,
  formatLocationDisplay,
  normalizeLocationValue,
} from "../shared/location-suggestions.js";
import { ensureCurrencySelectValue } from "../shared/currency-options.js";
import { DEFAULT_NODE_SSH_PORT } from "../shared/management-defaults.js";

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
    findNodeById: (nodeId) => appState.nodes.find((node) => node.id === nodeId) || null,
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
    const options = [
      '<option value="">未绑定厂商台账</option>',
      ...appState.providers.map((provider) => {
        const providerId = String(provider.id || "");
        const selected = providerId === normalizedSelectedId ? " selected" : "";
        const label = provider.account_name
          ? `${provider.name || provider.id} · ${provider.account_name}`
          : provider.name || provider.id;
        return `<option value="${escapeHtml(providerId)}"${selected}>${escapeHtml(label)}</option>`;
      }),
    ];
    if (
      normalizedSelectedId &&
      !appState.providers.some((provider) => String(provider.id || "") === normalizedSelectedId)
    ) {
      options.push(
        `<option value="${escapeHtml(normalizedSelectedId)}" selected>${escapeHtml(
          `${normalizedSelectedId} · 当前台账已不存在`,
        )}</option>`,
      );
    }
    return options.join("");
  }

  function syncProviderField(selectElement, inputElement) {
    if (!selectElement || !inputElement) {
      return;
    }

    const selectedProvider = appState.providers.find(
      (provider) => provider.id === selectElement.value,
    );
    if (selectedProvider) {
      inputElement.value = selectedProvider.name || "";
      inputElement.readOnly = true;
      inputElement.dataset.lockedByProvider = "1";
      return;
    }

    if (inputElement.dataset.lockedByProvider === "1") {
      inputElement.value = "";
    }

    inputElement.readOnly = false;
    delete inputElement.dataset.lockedByProvider;
  }

  function setLocationFieldValue(inputElement, value, scope) {
    if (!inputElement) {
      return;
    }

    inputElement.value =
      normalizeLocationValue(value, { scope }) || String(value || "").trim() || "";
  }

  function getRelayNodeOptionsHtml(selectedId = null, options = {}) {
    const normalizedSelectedId = String(selectedId || "").trim();
    const excludeNodeId = String(options.excludeNodeId || "").trim();
    const placeholder = options.placeholder || "未选择已纳管节点";

    const sortedNodes = [...appState.nodes]
      .filter((node) => String(node?.id || "") !== excludeNodeId)
      .sort((left, right) => getNodeDisplayName(left).localeCompare(getNodeDisplayName(right), "zh-Hans-CN"));

    return [
      `<option value="">${escapeHtml(placeholder)}</option>`,
      ...sortedNodes.map((node) => {
        const nodeId = String(node?.id || "");
        const selected = nodeId === normalizedSelectedId ? " selected" : "";
        const regionLabel = formatLocationDisplay(node?.labels?.region, {
          scope: "region",
          style: "compact",
          fallback: "未标记国家",
        });
        const optionLabel = `${getNodeDisplayName(node)} · ${regionLabel}`;
        return `<option value="${escapeHtml(nodeId)}"${selected}>${escapeHtml(optionLabel)}</option>`;
      }),
      ...(
        normalizedSelectedId &&
        !sortedNodes.some((node) => String(node?.id || "") === normalizedSelectedId)
          ? [
              `<option value="${escapeHtml(normalizedSelectedId)}" selected>${escapeHtml(
                `${normalizedSelectedId} · 当前节点台账里已不存在`,
              )}</option>`,
            ]
          : []
      ),
    ].join("");
  }

  function syncRouteFieldVisibility(root, options = {}) {
    if (!root) {
      return;
    }

    const businessMode = options.businessModeSelector
      ? root.querySelector(options.businessModeSelector)
      : null;
    const managementMode = options.managementModeSelector
      ? root.querySelector(options.managementModeSelector)
      : null;

    root.querySelectorAll("[data-business-relay-field]").forEach((element) => {
      element.hidden = businessMode ? businessMode.value !== "relay" : false;
    });

    root.querySelectorAll("[data-management-relay-field]").forEach((element) => {
      element.hidden = managementMode ? managementMode.value !== "relay" : false;
    });
  }

  function shouldOpenRoutingAdvanced(options = {}) {
    const managementPort = toNumberOrNull(options.managementPort);
    const managementInternalPort = toNumberOrNull(options.managementInternalPort);
    return Boolean(
      String(options.businessMode || "").trim() === "relay" ||
        String(options.managementMode || "").trim() === "relay" ||
        String(options.proxyHost || "").trim() ||
        String(options.routeDirection || "").trim() ||
        String(options.entryHost || "").trim() ||
        String(options.entryPort || "").trim() ||
        String(options.businessInternalHost || "").trim() ||
        String(options.businessInternalPort || "").trim() ||
        String(options.serviceListenHost || "").trim() ||
        String(options.serviceListenPort || "").trim() ||
        String(options.managementHost || "").trim() ||
        (managementPort !== null && managementPort !== DEFAULT_NODE_SSH_PORT) ||
        String(options.managementInternalHost || "").trim() ||
        (managementInternalPort !== null && managementInternalPort !== DEFAULT_NODE_SSH_PORT),
    );
  }

  function setFieldValue(id, value) {
    const element = documentRef.getElementById(id);
    if (element) {
      element.value = value ?? "";
    }
  }

  function endpointHost(endpoint = {}) {
    return endpoint.external_host || endpoint.host || "";
  }

  function endpointPort(endpoint = {}) {
    return endpoint.external_port ?? endpoint.port ?? null;
  }

  function endpointInternalHost(endpoint = {}) {
    return endpoint.internal_host || "";
  }

  function endpointInternalPort(endpoint = {}) {
    return endpoint.internal_port ?? null;
  }

  function serviceListenHost(endpoint = {}) {
    return endpoint.listen_host || endpoint.host || endpoint.internal_host || "";
  }

  function serviceListenPort(endpoint = {}) {
    return endpoint.listen_port ?? endpoint.port ?? endpoint.internal_port ?? null;
  }

  function bindRoutingAdvancedAutoOpen(routingAdvanced, getOptions, controls = []) {
    if (!routingAdvanced || typeof getOptions !== "function") {
      return;
    }

    const maybeOpen = () => {
      if (shouldOpenRoutingAdvanced(getOptions())) {
        routingAdvanced.open = true;
      }
    };

    controls.forEach((element) => {
      element?.addEventListener("input", maybeOpen);
      element?.addEventListener("change", maybeOpen);
    });
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
    const regionInput = documentRef.getElementById("manual-region");
    const entryRegionInput = documentRef.getElementById("manual-entry-region");
    const relayNodeSelect = documentRef.getElementById("manual-relay-node-id");
    const managementRelayNodeSelect = documentRef.getElementById("manual-management-relay-node-id");
    const businessModeSelect = documentRef.getElementById("manual-access-mode");
    const managementModeSelect = documentRef.getElementById("manual-management-access-mode");
    const routeDirectionSelect = documentRef.getElementById("manual-route-direction");
    const entryHostInput = documentRef.getElementById("manual-entry-host");
    const entryPortInput = documentRef.getElementById("manual-entry-port");
    const businessInternalHostInput = documentRef.getElementById("manual-business-internal-host");
    const businessInternalPortInput = documentRef.getElementById("manual-business-internal-port");
    const serviceListenHostInput = documentRef.getElementById("manual-service-listen-host");
    const serviceListenPortInput = documentRef.getElementById("manual-service-listen-port");
    const managementSshHostInput = documentRef.getElementById("manual-management-ssh-host");
    const managementSshPortInput = documentRef.getElementById("manual-management-ssh-port");
    const managementInternalHostInput = documentRef.getElementById("manual-management-internal-host");
    const managementInternalPortInput = documentRef.getElementById("manual-management-internal-port");
    const managementProxyHostInput = documentRef.getElementById("manual-management-proxy-host");
    const routingAdvanced = documentRef.getElementById("manual-routing-advanced");

    if (!modal || !closeButton || !form || !message) return;
    if (modal.dataset.bound === "1") return;
    modal.dataset.bound = "1";

    const manualAdvancedOptions = () => ({
      businessMode: businessModeSelect?.value,
      managementMode: managementModeSelect?.value,
      proxyHost: managementProxyHostInput?.value,
      routeDirection: routeDirectionSelect?.value,
      entryHost: entryHostInput?.value,
      entryPort: entryPortInput?.value,
      businessInternalHost: businessInternalHostInput?.value,
      businessInternalPort: businessInternalPortInput?.value,
      serviceListenHost: serviceListenHostInput?.value,
      serviceListenPort: serviceListenPortInput?.value,
      managementHost: managementSshHostInput?.value,
      managementPort: managementSshPortInput?.value,
      managementInternalHost: managementInternalHostInput?.value,
      managementInternalPort: managementInternalPortInput?.value,
    });

    const refreshManualSelects = () => {
      if (providerSelect) {
        providerSelect.innerHTML = getProviderOptionsHtml(providerSelect.value || null);
      }
      setLocationFieldValue(regionInput, regionInput?.value, "region");
      setLocationFieldValue(entryRegionInput, entryRegionInput?.value, "entry");
      if (relayNodeSelect) {
        relayNodeSelect.innerHTML = getRelayNodeOptionsHtml(relayNodeSelect.value || null, {
          placeholder: "未选择已纳管入口节点",
        });
      }
      if (managementRelayNodeSelect) {
        managementRelayNodeSelect.innerHTML = getRelayNodeOptionsHtml(
          managementRelayNodeSelect.value || null,
          {
            placeholder: "未选择已纳管跳板",
          },
        );
      }
      syncProviderField(providerSelect, providerInput);
      syncRouteFieldVisibility(form, {
        businessModeSelector: "#manual-access-mode",
        managementModeSelector: "#manual-management-access-mode",
      });
      if (routingAdvanced) {
        routingAdvanced.open = shouldOpenRoutingAdvanced(manualAdvancedOptions());
      }
    };

    const open = () => {
      refreshManualSelects();
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
    businessModeSelect?.addEventListener("change", () => {
      syncRouteFieldVisibility(form, {
        businessModeSelector: "#manual-access-mode",
        managementModeSelector: "#manual-management-access-mode",
      });
      if (
        routingAdvanced &&
        shouldOpenRoutingAdvanced(manualAdvancedOptions())
      ) {
        routingAdvanced.open = true;
      }
    });
    managementModeSelect?.addEventListener("change", () => {
      syncRouteFieldVisibility(form, {
        businessModeSelector: "#manual-access-mode",
        managementModeSelector: "#manual-management-access-mode",
      });
      if (
        routingAdvanced &&
        shouldOpenRoutingAdvanced(manualAdvancedOptions())
      ) {
        routingAdvanced.open = true;
      }
    });
    managementProxyHostInput?.addEventListener("input", () => {
      if (
        routingAdvanced &&
        shouldOpenRoutingAdvanced(manualAdvancedOptions())
      ) {
        routingAdvanced.open = true;
      }
    });
    bindRoutingAdvancedAutoOpen(routingAdvanced, manualAdvancedOptions, [
      routeDirectionSelect,
      entryHostInput,
      entryPortInput,
      businessInternalHostInput,
      businessInternalPortInput,
      serviceListenHostInput,
      serviceListenPortInput,
      managementSshHostInput,
      managementSshPortInput,
      managementInternalHostInput,
      managementInternalPortInput,
      managementProxyHostInput,
    ]);
    resetButton?.addEventListener("click", () => {
      setTimeout(refreshManualSelects, 0);
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
    const providerSelect = documentRef.getElementById("asset-provider-id");
    const providerInput = documentRef.getElementById("asset-provider");
    const regionInput = documentRef.getElementById("asset-region");
    const entryRegionInput = documentRef.getElementById("asset-entry-region");
    const relayNodeSelect = documentRef.getElementById("asset-relay-node-id");
    const managementRelayNodeSelect = documentRef.getElementById("asset-management-relay-node-id");
    const businessModeSelect = documentRef.getElementById("asset-access-mode");
    const managementModeSelect = documentRef.getElementById("asset-management-access-mode");
    const routeDirectionSelect = documentRef.getElementById("asset-route-direction");
    const entryHostInput = documentRef.getElementById("asset-entry-host");
    const entryPortInput = documentRef.getElementById("asset-entry-port");
    const businessInternalHostInput = documentRef.getElementById("asset-business-internal-host");
    const businessInternalPortInput = documentRef.getElementById("asset-business-internal-port");
    const serviceListenHostInput = documentRef.getElementById("asset-service-listen-host");
    const serviceListenPortInput = documentRef.getElementById("asset-service-listen-port");
    const managementSshHostInput = documentRef.getElementById("asset-management-ssh-host");
    const managementSshPortInput = documentRef.getElementById("asset-management-ssh-port");
    const managementInternalHostInput = documentRef.getElementById("asset-management-internal-host");
    const managementInternalPortInput = documentRef.getElementById("asset-management-internal-port");
    const managementProxyHostInput = documentRef.getElementById("asset-management-proxy-host");
    const routingAdvanced = documentRef.getElementById("asset-routing-advanced");

    if (!modal || !closeButton || !form || !message) return;

    const assetAdvancedOptions = () => ({
      businessMode: businessModeSelect?.value,
      managementMode: managementModeSelect?.value,
      proxyHost: managementProxyHostInput?.value,
      routeDirection: routeDirectionSelect?.value,
      entryHost: entryHostInput?.value,
      entryPort: entryPortInput?.value,
      businessInternalHost: businessInternalHostInput?.value,
      businessInternalPort: businessInternalPortInput?.value,
      serviceListenHost: serviceListenHostInput?.value,
      serviceListenPort: serviceListenPortInput?.value,
      managementHost: managementSshHostInput?.value,
      managementPort: managementSshPortInput?.value,
      managementInternalHost: managementInternalHostInput?.value,
      managementInternalPort: managementInternalPortInput?.value,
    });

    const fillForm = () => {
      const node = getAssetEditorNode(appState.nodes);
      if (!node) {
        if (summary) {
          summary.textContent = "当前编辑节点：-";
        }
        return;
      }

      const managementEndpoint = node.endpoints?.management || {};
      const businessEndpoint = node.endpoints?.business_ingress || {};
      const serviceEndpoint = node.endpoints?.service_listen || {};
      const managementHost =
        endpointHost(managementEndpoint) || node.management?.ssh_host || node.ssh_host || "";
      const managementPort =
        endpointPort(managementEndpoint) ??
        node.management?.ssh_port ??
        node.ssh_port ??
        node.facts?.ssh_port ??
        DEFAULT_NODE_SSH_PORT;
      const managementInternalHost =
        endpointInternalHost(managementEndpoint) ||
        node.management?.ssh_internal_host ||
        node.management?.internal_ssh_host ||
        node.management?.internal_host ||
        "";
      const managementInternalPort =
        endpointInternalPort(managementEndpoint) ??
        node.management?.ssh_internal_port ??
        node.management?.internal_ssh_port ??
        node.management?.internal_port ??
        "";
      const businessHost =
        endpointHost(businessEndpoint) || node.networking?.entry_host || "";
      const businessPort =
        endpointPort(businessEndpoint) ?? node.networking?.entry_port ?? "";
      const businessInternalHost =
        endpointInternalHost(businessEndpoint) || node.networking?.internal_host || "";
      const businessInternalPort =
        endpointInternalPort(businessEndpoint) ?? node.networking?.internal_port ?? "";
      const serviceHost = serviceListenHost(serviceEndpoint);
      const servicePort = serviceListenPort(serviceEndpoint);

      if (summary) {
        summary.textContent = `当前编辑节点：${getNodeDisplayName(node)} · ${node.id}`;
      }

      if (providerSelect) {
        providerSelect.innerHTML = getProviderOptionsHtml(node.provider_id || null);
      }
      setLocationFieldValue(regionInput, node.labels?.region, "region");
      setLocationFieldValue(entryRegionInput, node.networking?.entry_region, "entry");
      if (relayNodeSelect) {
        relayNodeSelect.innerHTML = getRelayNodeOptionsHtml(node.networking?.relay_node_id || null, {
          excludeNodeId: node.id,
          placeholder: "未选择已纳管入口节点",
        });
      }
      if (managementRelayNodeSelect) {
        managementRelayNodeSelect.innerHTML = getRelayNodeOptionsHtml(
          node.management?.relay_node_id || null,
          {
            excludeNodeId: node.id,
            placeholder: "未选择已纳管跳板",
          },
        );
      }
      documentRef.getElementById("asset-provider").value = node.labels?.provider || "";
      documentRef.getElementById("asset-role").value = node.labels?.role || "";
      documentRef.getElementById("asset-public-ip").value = node.facts?.public_ipv4 || "";
      documentRef.getElementById("asset-public-ipv6").value = node.facts?.public_ipv6 || "";
      documentRef.getElementById("asset-private-ip").value = node.facts?.private_ipv4 || "";
      documentRef.getElementById("asset-billing").value = node.commercial?.billing_cycle || "";
      documentRef.getElementById("asset-billing-amount").value = node.commercial?.billing_amount ?? "";
      ensureCurrencySelectValue(
        documentRef.getElementById("asset-billing-currency"),
        node.commercial?.billing_currency || "",
      );
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
      setFieldValue("asset-route-direction", node.networking?.route_direction || "");
      setFieldValue("asset-entry-host", businessHost);
      setFieldValue("asset-entry-port", businessPort);
      setFieldValue("asset-business-internal-host", businessInternalHost);
      setFieldValue("asset-business-internal-port", businessInternalPort);
      setFieldValue("asset-service-listen-host", serviceHost);
      setFieldValue("asset-service-listen-port", servicePort);
      setFieldValue("asset-management-ssh-host", managementHost);
      setFieldValue("asset-management-ssh-port", managementPort);
      documentRef.getElementById("asset-management-access-mode").value =
        node.management?.access_mode || "direct";
      documentRef.getElementById("asset-management-ssh-user").value = node.management?.ssh_user || "";
      setFieldValue("asset-management-internal-host", managementInternalHost);
      setFieldValue("asset-management-internal-port", managementInternalPort);
      documentRef.getElementById("asset-management-relay-strategy").value =
        node.management?.relay_strategy || "auto";
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
      syncProviderField(providerSelect, providerInput);
      syncRouteFieldVisibility(form, {
        businessModeSelector: "#asset-access-mode",
        managementModeSelector: "#asset-management-access-mode",
      });
      if (routingAdvanced) {
        routingAdvanced.open = shouldOpenRoutingAdvanced(assetAdvancedOptions());
      }
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
      providerSelect?.addEventListener("change", () => {
        syncProviderField(providerSelect, providerInput);
      });
      businessModeSelect?.addEventListener("change", () => {
        syncRouteFieldVisibility(form, {
          businessModeSelector: "#asset-access-mode",
          managementModeSelector: "#asset-management-access-mode",
        });
        if (
          routingAdvanced &&
          shouldOpenRoutingAdvanced(assetAdvancedOptions())
        ) {
          routingAdvanced.open = true;
        }
      });
      managementModeSelect?.addEventListener("change", () => {
        syncRouteFieldVisibility(form, {
          businessModeSelector: "#asset-access-mode",
          managementModeSelector: "#asset-management-access-mode",
        });
        if (
          routingAdvanced &&
          shouldOpenRoutingAdvanced(assetAdvancedOptions())
        ) {
          routingAdvanced.open = true;
        }
      });
      managementProxyHostInput?.addEventListener("input", () => {
        if (
          routingAdvanced &&
          shouldOpenRoutingAdvanced(assetAdvancedOptions())
        ) {
          routingAdvanced.open = true;
        }
      });
      bindRoutingAdvancedAutoOpen(routingAdvanced, assetAdvancedOptions, [
        routeDirectionSelect,
        entryHostInput,
        entryPortInput,
        businessInternalHostInput,
        businessInternalPortInput,
        serviceListenHostInput,
        serviceListenPortInput,
        managementSshHostInput,
        managementSshPortInput,
        managementInternalHostInput,
        managementInternalPortInput,
        managementProxyHostInput,
      ]);
      resetButton?.addEventListener("click", () => {
        setTimeout(fillForm, 0);
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

        const submitButton = form.querySelector('button[type="submit"]');
        if (submitButton?.dataset.submitting === "true") {
          return;
        }

        const formData = new FormData(form);
        const node = getAssetEditorNode(appState.nodes);
        if (!node) {
          message.innerHTML = '<div class="message error">当前节点不存在。</div>';
          return;
        }
        const payload = buildAssetPayload(formData);

        if (submitButton) {
          submitButton.dataset.submitting = "true";
          submitButton.disabled = true;
        }

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
        } finally {
          if (submitButton) {
            delete submitButton.dataset.submitting;
            submitButton.disabled = false;
          }
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
