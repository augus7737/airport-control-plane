import {
  setAccessUsers,
  setBootstrapTokens,
  setConfigReleases,
  setNodeGroups,
  setNodes,
  setOperations,
  setPlatformContext,
  setProviders,
  setProbes,
  setProxyProfiles,
  setSystemTemplateReleases,
  setSystemTemplates,
  setSystemUserReleases,
  setSystemUsers,
  setTasks,
} from "../store/runtime-store.js";
import { fetchWithAuth, isUnauthorizedError } from "../auth/auth-client.js";

const browserOrigin =
  typeof window !== "undefined" && window.location ? window.location.origin : "";

const emptyCollection = Object.freeze([]);

function createDefaultPlatformContext() {
  return {
    request_origin: browserOrigin,
    bootstrap_base_url: browserOrigin,
    detected_lan_ipv4: null,
    detected_lan_base_url: null,
    source: "browser",
    ssh_key: {
      status: "missing",
      available: false,
      bootstrap_ready: false,
      source: "missing",
      private_key_path: null,
      public_key: null,
      note: "平台还没有可用 SSH 私钥。",
      can_generate: true,
    },
    sing_box_distribution: {
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
    },
    probe_scheduler: {
      enabled: false,
      running: false,
      interval_ms: 0,
      batch_size: 0,
      min_probe_gap_ms: 0,
      jitter_ms: 0,
      next_run_at: null,
      last_run_at: null,
      last_finished_at: null,
      last_run_summary: null,
      last_error: null,
    },
  };
}

async function fetchCollection(url) {
  try {
    const response = await fetchWithAuth(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.items) ? payload.items : emptyCollection;
  } catch (error) {
    if (isUnauthorizedError(error)) {
      throw error;
    }
    return emptyCollection;
  }
}

async function requestJson(url, options = {}) {
  const response = await fetchWithAuth(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload?.details?.join("，") || payload?.message || `HTTP ${response.status}`,
    );
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function jsonRequest(body, method = "POST") {
  return {
    method,
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

function pickEntity(payload, keys = []) {
  for (const key of keys) {
    if (payload && payload[key]) {
      return payload[key];
    }
  }
  return null;
}

export function getLiveNodes() {
  return fetchCollection("/api/v1/nodes");
}

export function getLiveTasks() {
  return fetchCollection("/api/v1/tasks");
}

export function getLiveProbes() {
  return fetchCollection("/api/v1/probes");
}

export function getLiveOperations() {
  return fetchCollection("/api/v1/operations");
}

export function getLiveBootstrapTokens() {
  return fetchCollection("/api/v1/bootstrap-tokens");
}

export function getLiveAccessUsers() {
  return fetchCollection("/api/v1/access-users");
}

export function getLiveSystemUsers() {
  return fetchCollection("/api/v1/system-users");
}

export function getLiveSystemTemplates() {
  return fetchCollection("/api/v1/system-templates");
}

export function getLiveProxyProfiles() {
  return fetchCollection("/api/v1/proxy-profiles");
}

export function getLiveNodeGroups() {
  return fetchCollection("/api/v1/node-groups");
}

export function getLiveProviders() {
  return fetchCollection("/api/v1/providers");
}

export function getLiveConfigReleases() {
  return fetchCollection("/api/v1/config-releases");
}

export function getLiveSystemTemplateReleases() {
  return fetchCollection("/api/v1/system-template-releases");
}

export function getLiveSystemUserReleases() {
  return fetchCollection("/api/v1/system-user-releases");
}

export async function getPlatformContext() {
  try {
    const response = await fetchWithAuth("/api/v1/platform-context");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (isUnauthorizedError(error)) {
      throw error;
    }
    return createDefaultPlatformContext();
  }
}

export async function refreshRuntimeData() {
  const [
    nodes,
    tasks,
    probes,
    operations,
    accessUsers,
    systemUsers,
    systemTemplates,
    proxyProfiles,
    nodeGroups,
    providers,
    configReleases,
    systemTemplateReleases,
    systemUserReleases,
    platformContext,
  ] =
    await Promise.all([
    getLiveNodes(),
    getLiveTasks(),
    getLiveProbes(),
    getLiveOperations(),
    getLiveAccessUsers(),
    getLiveSystemUsers(),
    getLiveSystemTemplates(),
    getLiveProxyProfiles(),
    getLiveNodeGroups(),
    getLiveProviders(),
    getLiveConfigReleases(),
    getLiveSystemTemplateReleases(),
    getLiveSystemUserReleases(),
    getPlatformContext(),
  ]);
  setPlatformContext(platformContext);
  setNodes(nodes);
  setTasks(tasks);
  setProbes(probes);
  setOperations(operations);
  setAccessUsers(accessUsers);
  setSystemUsers(systemUsers);
  setSystemTemplates(systemTemplates);
  setProxyProfiles(proxyProfiles);
  setNodeGroups(nodeGroups);
  setProviders(providers);
  setConfigReleases(configReleases);
  setSystemTemplateReleases(systemTemplateReleases);
  setSystemUserReleases(systemUserReleases);
}

export async function hydrateRuntimeStore() {
  const [
    nodes,
    tasks,
    probes,
    operations,
    tokens,
    platformContext,
    accessUsers,
    systemUsers,
    systemTemplates,
    proxyProfiles,
    nodeGroups,
    providers,
    configReleases,
    systemTemplateReleases,
    systemUserReleases,
  ] = await Promise.all([
    getLiveNodes(),
    getLiveTasks(),
    getLiveProbes(),
    getLiveOperations(),
    getLiveBootstrapTokens(),
    getPlatformContext(),
    getLiveAccessUsers(),
    getLiveSystemUsers(),
    getLiveSystemTemplates(),
    getLiveProxyProfiles(),
    getLiveNodeGroups(),
    getLiveProviders(),
    getLiveConfigReleases(),
    getLiveSystemTemplateReleases(),
    getLiveSystemUserReleases(),
  ]);
  setPlatformContext(platformContext);
  setNodes(nodes);
  setTasks(tasks);
  setProbes(probes);
  setOperations(operations);
  setBootstrapTokens(tokens);
  setAccessUsers(accessUsers);
  setSystemUsers(systemUsers);
  setSystemTemplates(systemTemplates);
  setProxyProfiles(proxyProfiles);
  setNodeGroups(nodeGroups);
  setProviders(providers);
  setConfigReleases(configReleases);
  setSystemTemplateReleases(systemTemplateReleases);
  setSystemUserReleases(systemUserReleases);
}

export async function refreshOperations() {
  const operations = await getLiveOperations();
  setOperations(operations);
}

export async function createAccessUser(payload) {
  const result = await requestJson("/api/v1/access-users", jsonRequest(payload));
  return pickEntity(result, ["access_user", "user", "item"]) || result;
}

export async function updateAccessUser(id, payload) {
  const result = await requestJson(
    `/api/v1/access-users/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["access_user", "user", "item"]) || result;
}

export async function deleteAccessUser(id) {
  return requestJson(`/api/v1/access-users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function getAccessUserShare(id) {
  return requestJson(`/api/v1/access-users/${encodeURIComponent(id)}/share`);
}

export async function regenerateAccessUserShareToken(id) {
  return requestJson(`/api/v1/access-users/${encodeURIComponent(id)}/share-token/regenerate`, {
    method: "POST",
  });
}

export async function createProxyProfile(payload) {
  const result = await requestJson("/api/v1/proxy-profiles", jsonRequest(payload));
  return pickEntity(result, ["proxy_profile", "profile", "item"]) || result;
}

export async function updateProxyProfile(id, payload) {
  const result = await requestJson(
    `/api/v1/proxy-profiles/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["proxy_profile", "profile", "item"]) || result;
}

export async function deleteProxyProfile(id) {
  return requestJson(`/api/v1/proxy-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createSystemUser(payload) {
  const result = await requestJson("/api/v1/system-users", jsonRequest(payload));
  return pickEntity(result, ["system_user", "user", "item"]) || result;
}

export async function updateSystemUser(id, payload) {
  const result = await requestJson(
    `/api/v1/system-users/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["system_user", "user", "item"]) || result;
}

export async function deleteSystemUser(id) {
  return requestJson(`/api/v1/system-users/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createSystemTemplate(payload) {
  const result = await requestJson("/api/v1/system-templates", jsonRequest(payload));
  return pickEntity(result, ["system_template", "template", "item"]) || result;
}

export async function updateSystemTemplate(id, payload) {
  const result = await requestJson(
    `/api/v1/system-templates/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["system_template", "template", "item"]) || result;
}

export async function deleteSystemTemplate(id) {
  return requestJson(`/api/v1/system-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createNodeGroup(payload) {
  const result = await requestJson("/api/v1/node-groups", jsonRequest(payload));
  return pickEntity(result, ["node_group", "group", "item"]) || result;
}

export async function createProvider(payload) {
  const result = await requestJson("/api/v1/providers", jsonRequest(payload));
  return pickEntity(result, ["provider", "item"]) || result;
}

export async function updateProvider(id, payload) {
  const result = await requestJson(
    `/api/v1/providers/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["provider", "item"]) || result;
}

export async function deleteProvider(id) {
  return requestJson(`/api/v1/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function updateNodeGroup(id, payload) {
  const result = await requestJson(
    `/api/v1/node-groups/${encodeURIComponent(id)}`,
    jsonRequest(payload, "PATCH"),
  );
  return pickEntity(result, ["node_group", "group", "item"]) || result;
}

export async function deleteNodeGroup(id) {
  return requestJson(`/api/v1/node-groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createConfigRelease(payload) {
  const result = await requestJson("/api/v1/config-releases", jsonRequest(payload));
  return {
    release: pickEntity(result, ["config_release", "release", "item"]) || result.release || result,
    task: result.task || null,
    operation: result.operation || null,
  };
}

export async function applySystemUsers(payload) {
  const result = await requestJson("/api/v1/system-users/apply", jsonRequest(payload));
  return {
    release:
      pickEntity(result, ["system_user_release", "release", "item"]) || result.release || result,
    operation: result.operation || null,
  };
}

export async function applySystemTemplate(payload) {
  const result = await requestJson("/api/v1/system-templates/apply", jsonRequest(payload));
  return {
    release:
      pickEntity(result, ["system_template_release", "release", "item"]) || result.release || result,
    operation: result.operation || null,
  };
}
