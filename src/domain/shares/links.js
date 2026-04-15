import { isIP } from "node:net";
import QRCode from "qrcode";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeStringArray(value) {
  if (typeof value === "string") {
    return normalizeString(value) ? [normalizeString(value)] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map((item) => String(item)))];
}

function parseJsonBlock(value) {
  const text = normalizeString(value);
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractEmbeddedJsonBlock(scriptBody, marker) {
  const body = String(scriptBody || "");
  const pattern = new RegExp(`<<'${marker}'\\r?\\n([\\s\\S]*?)\\r?\\n${marker}`);
  const match = body.match(pattern);
  return match ? parseJsonBlock(match[1]) : null;
}

function getNodeDisplayName(node) {
  return (
    normalizeString(node?.name) ??
    normalizeString(node?.hostname) ??
    normalizeString(node?.facts?.hostname) ??
    normalizeString(node?.id) ??
    "未知节点"
  );
}

function getNodeProvider(node) {
  return normalizeString(node?.labels?.provider) ?? null;
}

function getNodeRegion(node) {
  return normalizeString(node?.labels?.region) ?? null;
}

function resolveEndpointHost(node) {
  return (
    normalizeString(node?.facts?.public_ipv4) ??
    normalizeString(node?.facts?.public_ipv6) ??
    normalizeString(node?.facts?.private_ipv4) ??
    null
  );
}

function formatUriHost(host) {
  const normalized = normalizeString(host);
  if (!normalized) {
    return null;
  }

  return isIP(normalized) === 6 ? `[${normalized}]` : normalized;
}

function resolveRequestOrigin(url) {
  return normalizeString(`${url.protocol}//${url.host}`) ?? "";
}

function cleanBaseUrl(baseUrl, normalizeBaseUrl) {
  const normalized = normalizeString(baseUrl);
  if (!normalized) {
    return "";
  }

  return typeof normalizeBaseUrl === "function"
    ? normalizeBaseUrl(normalized)
    : normalized.replace(/\/+$/, "");
}

function getPrimaryInbound(renderedConfig) {
  const inbounds = Array.isArray(renderedConfig?.inbounds) ? renderedConfig.inbounds : [];
  return isPlainObject(inbounds[0]) ? inbounds[0] : null;
}

function inferSecurity(inbound, profile) {
  if (inbound?.tls?.reality?.enabled) {
    return "reality";
  }

  if (inbound?.tls?.enabled) {
    return "tls";
  }

  return normalizeString(profile?.security)?.toLowerCase() ?? "none";
}

function inferTransport(inbound, profile) {
  return (
    normalizeString(inbound?.transport?.type)?.toLowerCase() ??
    normalizeString(profile?.transport)?.toLowerCase() ??
    "tcp"
  );
}

function inferTlsServerName(inbound, profile) {
  return normalizeString(inbound?.tls?.server_name) ?? normalizeString(profile?.server_name) ?? null;
}

function inferAlpn(inbound) {
  const values = Array.isArray(inbound?.tls?.alpn) ? inbound.tls.alpn : [];
  return uniqueStrings(values.map((item) => normalizeString(item)).filter(Boolean));
}

function inferRealityBlock(inbound) {
  return isPlainObject(inbound?.tls?.reality) ? inbound.tls.reality : {};
}

function inferTransportBlock(inbound) {
  return isPlainObject(inbound?.transport) ? inbound.transport : {};
}

function inferRenderedUser(inbound, manifestUser, protocol) {
  const users = Array.isArray(inbound?.users) ? inbound.users.filter(isPlainObject) : [];
  const expectedUuid = normalizeString(manifestUser?.credential?.uuid);
  if (!expectedUuid) {
    return null;
  }

  const expectedAlterId =
    protocol === "vmess" &&
    Number.isInteger(Number(manifestUser?.credential?.alter_id)) &&
    Number(manifestUser.credential.alter_id) >= 0
      ? Number(manifestUser.credential.alter_id)
      : 0;

  return (
    users.find((user) => {
      if (normalizeString(user?.uuid) !== expectedUuid) {
        return false;
      }

      if (protocol !== "vmess") {
        return true;
      }

      const alterId =
        Number.isInteger(Number(user?.alterId)) && Number(user.alterId) >= 0
          ? Number(user.alterId)
          : 0;
      return alterId === expectedAlterId;
    }) || null
  );
}

function findManifestUser(manifest, accessUserId) {
  const items = Array.isArray(manifest?.access_users) ? manifest.access_users : [];
  return items.find((item) => item?.id === accessUserId) || null;
}

function buildTargetLabel(nodeName, protocol, security, transport) {
  return `${nodeName} / ${String(protocol || "vless").toUpperCase()} ${String(
    security || "none",
  ).toUpperCase()} ${String(transport || "tcp").toUpperCase()}`;
}

function buildSubscriptionContent(targets, nodeId = null) {
  const relevantTargets = nodeId
    ? targets.filter((target) => target.node_id === nodeId)
    : targets;

  return relevantTargets
    .map((target) => normalizeString(target?.share_url))
    .filter(Boolean)
    .join("\n");
}

function isDateOnlyValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function isAccessUserExpired(accessUser, nowValue = Date.now()) {
  const expiresAt = normalizeString(accessUser?.expires_at);
  if (!expiresAt) {
    return false;
  }

  if (isDateOnlyValue(expiresAt)) {
    const today = new Date(nowValue).toISOString().slice(0, 10);
    return expiresAt < today;
  }

  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed < nowValue : false;
}

function getAccessUserAvailabilityWarnings(accessUser, nowValue = Date.now()) {
  const warnings = [];
  const displayName = normalizeString(accessUser?.name) ?? normalizeString(accessUser?.id) ?? "当前接入用户";
  const status = normalizeString(accessUser?.status)?.toLowerCase() ?? "active";

  if (status !== "active") {
    warnings.push(`${displayName} 当前状态为 ${status}，公开订阅不会继续下发任何节点。`);
  }

  if (isAccessUserExpired(accessUser, nowValue)) {
    warnings.push(`${displayName} 已过期，公开订阅不会继续下发任何节点。`);
  }

  return warnings;
}

export function createSharesDomain(dependencies = {}) {
  const {
    clientPublicBaseUrl = "",
    platformPublicBaseUrl = "",
    normalizeBaseUrl = (value) => String(value || "").trim(),
    resolveTrafficRoute = null,
  } = dependencies;

  const snapshotCache = new Map();

  function resolvePublicBaseUrl(requestOrigin = "") {
    return (
      cleanBaseUrl(clientPublicBaseUrl, normalizeBaseUrl) ||
      cleanBaseUrl(platformPublicBaseUrl, normalizeBaseUrl) ||
      cleanBaseUrl(requestOrigin, normalizeBaseUrl)
    );
  }

  function buildAggregateSubscriptionUrl(token, options = {}) {
    const baseUrl = resolvePublicBaseUrl(options.requestOrigin);
    if (!baseUrl || !token) {
      return null;
    }

    return new URL(`/sub/${encodeURIComponent(token)}`, `${baseUrl}/`).toString();
  }

  function buildNodeSubscriptionUrl(token, nodeId, options = {}) {
    const baseUrl = resolvePublicBaseUrl(options.requestOrigin);
    if (!baseUrl || !token || !nodeId) {
      return null;
    }

    const url = new URL(`/sub/${encodeURIComponent(token)}`, `${baseUrl}/`);
    url.searchParams.set("node_id", nodeId);
    return url.toString();
  }

  function extractSnapshotFromScriptBody(scriptBody) {
    const manifest = extractEmbeddedJsonBlock(scriptBody, "EOF_MANIFEST");
    const renderedConfig = extractEmbeddedJsonBlock(scriptBody, "EOF_CONFIG");
    const inbound = getPrimaryInbound(renderedConfig);
    return manifest && renderedConfig && inbound
      ? {
          manifest,
          rendered_config: renderedConfig,
          inbound,
        }
      : null;
  }

  function extractReleaseSnapshot(operation, target = null) {
    if (!operation?.id) {
      return null;
    }

    const cacheKey = `${operation.id}:${target?.node_id ?? "operation"}`;
    if (snapshotCache.has(cacheKey)) {
      return snapshotCache.get(cacheKey);
    }

    const snapshot =
      extractSnapshotFromScriptBody(target?.script_body) ??
      extractSnapshotFromScriptBody(operation.script_body);

    snapshotCache.set(cacheKey, snapshot);
    return snapshot;
  }

  function extractReleaseDeploymentSnapshot(release, nodeId) {
    const deployments = Array.isArray(release?.deployments) ? release.deployments : [];
    const deployment = deployments.find((item) => item?.node_id === nodeId) || null;
    const artifact = deployment?.artifacts?.sing_box;
    if (!artifact?.manifest || !artifact?.rendered_config) {
      return null;
    }

    const inbound = getPrimaryInbound(artifact.rendered_config);
    if (!inbound) {
      return null;
    }

    return {
      manifest: artifact.manifest,
      rendered_config: artifact.rendered_config,
      inbound,
    };
  }

  function findReleaseRoute(release, snapshot, nodeId) {
    const routes = Array.isArray(release?.routes)
      ? release.routes
      : Array.isArray(snapshot?.manifest?.routes)
        ? snapshot.manifest.routes
        : [];
    return routes.find((item) => item?.node_id === nodeId) || null;
  }

  function resolveDeploymentStatus(release, operation, nodeId) {
    const deployments = Array.isArray(release?.deployments) ? release.deployments : [];
    const deployment = deployments.find((item) => item?.node_id === nodeId) || null;
    if (deployment?.status) {
      return String(deployment.status).toLowerCase();
    }

    if (operation && Array.isArray(operation.targets)) {
      const target = operation.targets.find((item) => item?.node_id === nodeId) || null;
      if (target?.status) {
        return String(target.status).toLowerCase();
      }
    }

    return null;
  }

  function findLatestSuccessfulReleaseForNode(nodeId, releases, operationsById) {
    const candidates = [];

    for (const release of Array.isArray(releases) ? releases : []) {
      if (!release?.id || !Array.isArray(release.node_ids) || !release.node_ids.includes(nodeId)) {
        continue;
      }

      const operation = release.operation_id ? operationsById.get(release.operation_id) : null;
      const target =
        operation && Array.isArray(operation.targets)
          ? operation.targets.find(
              (item) => item?.node_id === nodeId && String(item?.status || "").toLowerCase() === "success",
            )
          : null;

      if (!target) {
        continue;
      }

      const sortTimestamp =
        Date.parse(target.finished_at || target.started_at || release.finished_at || release.created_at || "") ||
        0;

      candidates.push({
        release,
        operation,
        target,
        snapshot:
          extractReleaseDeploymentSnapshot(release, nodeId) ??
          extractReleaseSnapshot(operation, target),
        sort_timestamp: sortTimestamp,
      });
    }

    candidates.sort(
      (left, right) =>
        right.sort_timestamp - left.sort_timestamp ||
        String(right.release?.created_at || "").localeCompare(String(left.release?.created_at || "")),
    );

    return candidates[0] || null;
  }

  function buildVlessShareUrl(target) {
    const endpointHost = formatUriHost(target.endpoint_host);
    const endpointPort =
      Number.isInteger(Number(target.endpoint_port)) && Number(target.endpoint_port) > 0
        ? Number(target.endpoint_port)
        : null;
    const uuid = normalizeString(target.rendered_user?.uuid ?? target.manifest_user?.credential?.uuid);
    if (!endpointHost || !endpointPort || !uuid) {
      return null;
    }

    const params = new URLSearchParams();
    params.set("encryption", "none");
    params.set("type", target.transport);
    params.set("security", target.security);

    const serverName = inferTlsServerName(target.inbound, target.profile);
    if (serverName) {
      params.set("sni", serverName);
    }

    const flow = normalizeString(target.rendered_user?.flow ?? target.profile?.flow);
    if (flow) {
      params.set("flow", flow);
    }

    const alpn = inferAlpn(target.inbound);
    if (alpn.length > 0) {
      params.set("alpn", alpn.join(","));
    }

    const transport = inferTransportBlock(target.inbound);
    const transportHostList = normalizeStringArray(transport?.host).join(",");
    const transportHost =
      normalizeString(transport?.headers?.Host) ??
      normalizeString(transport?.headers?.host) ??
      (transportHostList || null);
    const transportPath = normalizeString(transport?.path);

    if (transportHost) {
      params.set("host", transportHost);
    }

    if (transportPath) {
      params.set("path", transportPath);
    }

    if (target.transport === "grpc") {
      const serviceName = normalizeString(transport?.service_name);
      if (serviceName) {
        params.set("serviceName", serviceName);
      }
    }

    if (target.security === "reality") {
      const reality = inferRealityBlock(target.inbound);
      const publicKey = normalizeString(reality?.public_key);
      if (!publicKey) {
        return null;
      }

      params.set("pbk", publicKey);

      const shortId = normalizeStringArray(reality?.short_id)[0] ?? null;
      if (shortId) {
        params.set("sid", shortId);
      }

      const fingerprint = normalizeString(reality?.client_fingerprint);
      if (fingerprint) {
        params.set("fp", fingerprint);
      }
    }

    const query = params.toString();
    const label = encodeURIComponent(target.label);
    return `vless://${uuid}@${endpointHost}:${endpointPort}${query ? `?${query}` : ""}#${label}`;
  }

  function buildVmessShareUrl(target) {
    const endpointHost = normalizeString(target.endpoint_host);
    const endpointPort =
      Number.isInteger(Number(target.endpoint_port)) && Number(target.endpoint_port) > 0
        ? Number(target.endpoint_port)
        : null;
    const uuid = normalizeString(target.rendered_user?.uuid ?? target.manifest_user?.credential?.uuid);
    if (!endpointHost || !endpointPort || !uuid) {
      return null;
    }

    const transport = inferTransportBlock(target.inbound);
    const transportHostList = normalizeStringArray(transport?.host).join(",");
    const transportHost =
      normalizeString(transport?.headers?.Host) ??
      normalizeString(transport?.headers?.host) ??
      (transportHostList || null);
    const transportPath =
      normalizeString(transport?.service_name) ??
      normalizeString(transport?.path) ??
      "";
    const serverName = inferTlsServerName(target.inbound, target.profile) ?? "";
    const alpn = inferAlpn(target.inbound);
    const alterId =
      Number.isInteger(Number(target.rendered_user?.alterId ?? target.manifest_user?.credential?.alter_id))
        ? Number(target.rendered_user?.alterId ?? target.manifest_user?.credential?.alter_id)
        : 0;

    const payload = {
      v: "2",
      ps: target.label,
      add: endpointHost,
      port: String(endpointPort),
      id: uuid,
      aid: String(alterId),
      scy: "auto",
      net: target.transport,
      type: "none",
      host: transportHost,
      path: transportPath,
      tls: target.security === "tls" ? "tls" : "",
      sni: serverName,
      alpn: alpn.join(","),
    };

    return `vmess://${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
  }

  async function buildQrSvg(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return null;
    }

    return QRCode.toString(normalized, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 256,
    });
  }

  function findEffectiveUserTargets(input) {
    const {
      accessUser,
      nodes = [],
      releases = [],
      operations = [],
      requestOrigin = "",
    } = input;

    const operationsById = new Map(
      (Array.isArray(operations) ? operations : [])
        .filter((item) => item?.id)
        .map((item) => [item.id, item]),
    );
    const nowValue = Date.now();
    const warnings = getAccessUserAvailabilityWarnings(accessUser, nowValue);
    const targets = [];

    if (warnings.length > 0) {
      return {
        request_origin: requestOrigin,
        targets,
        warnings: uniqueStrings(warnings),
      };
    }

    for (const node of [...nodes].sort((left, right) =>
      getNodeDisplayName(left).localeCompare(getNodeDisplayName(right), "zh-CN")
    )) {
      const latest = findLatestSuccessfulReleaseForNode(node.id, releases, operationsById);
      if (!latest) {
        continue;
      }

      const snapshot = latest.snapshot;
      if (!snapshot) {
        warnings.push(
          `${getNodeDisplayName(node)} 的最近成功发布缺少可解析快照，暂无法生成分享信息。`,
        );
        continue;
      }

      const manifestUser = findManifestUser(snapshot.manifest, accessUser.id);
      if (!manifestUser) {
        continue;
      }

      const protocol =
        normalizeString(snapshot.manifest?.profile?.protocol)?.toLowerCase() ?? "vless";
      const renderedUser = inferRenderedUser(snapshot.inbound, manifestUser, protocol);
      if (!renderedUser) {
        continue;
      }

      const security = inferSecurity(snapshot.inbound, snapshot.manifest?.profile);
      const transport = inferTransport(snapshot.inbound, snapshot.manifest?.profile);
      const routeRecord = findReleaseRoute(latest.release, snapshot, node.id);
      const route =
        typeof resolveTrafficRoute === "function"
          ? resolveTrafficRoute(node, nodes, snapshot.manifest?.profile ?? {})
          : null;
      const effectiveAccessMode = route?.access_mode ?? routeRecord?.access_mode ?? "direct";
      const endpointHost =
        route?.entry_endpoint?.host ?? normalizeString(routeRecord?.entry_endpoint) ?? resolveEndpointHost(node);
      const endpointPort =
        route?.entry_port ??
        (Number.isInteger(Number(routeRecord?.entry_port)) ? Number(routeRecord.entry_port) : null) ??
        (Number.isInteger(Number(snapshot.inbound?.listen_port))
          ? Number(snapshot.inbound.listen_port)
          : Number(snapshot.manifest?.profile?.listen_port ?? 0) || null);
      const nodeName = getNodeDisplayName(node);
      const routeLabel = route?.route_label ?? routeRecord?.route_label ?? nodeName;
      const label = buildTargetLabel(routeLabel, protocol, security, transport);

      if (route && !route.publishable) {
        warnings.push(
          `${nodeName} 当前业务线路不可发布：${route.problems.join(" / ") || "入口地址或入口端口不可用"}。`,
        );
        continue;
      }

      if (effectiveAccessMode === "relay") {
        const entryNodeId = normalizeString(routeRecord?.entry_node_id) ?? route?.entry_node?.id ?? null;
        const entryNodeName =
          normalizeString(routeRecord?.entry_node_name) ??
          getNodeDisplayName(route?.entry_node) ??
          entryNodeId ??
          "入口节点";
        if (!entryNodeId) {
          warnings.push(`${nodeName} 的最近发布缺少入口节点信息，当前无法生成可用订阅。`);
          continue;
        }

        const entryStatus = resolveDeploymentStatus(latest.release, latest.operation, entryNodeId);
        if (entryStatus !== "success") {
          warnings.push(`${nodeName} 的入口节点 ${entryNodeName} 最近发布未成功，当前线路不应对外分享。`);
          continue;
        }
      }

      const target = {
        node_id: node.id,
        node_name: nodeName,
        provider: getNodeProvider(node),
        region: getNodeRegion(node),
        endpoint_host: endpointHost,
        endpoint_port: endpointPort,
        published: true,
        protocol,
        transport,
        security,
        label,
        access_mode: effectiveAccessMode,
        route_label: routeLabel,
        latest_release_id: latest.release.id,
        latest_release_created_at: latest.release.created_at ?? null,
        manifest_user: manifestUser,
        rendered_user: renderedUser,
        profile: snapshot.manifest?.profile ?? {},
        inbound: snapshot.inbound,
      };

      if (security === "reality" && !normalizeString(inferRealityBlock(snapshot.inbound)?.public_key)) {
        warnings.push(`${nodeName} 的 Reality 模板缺少 public_key，暂无法生成客户端分享链接。`);
      }

      if (!endpointHost) {
        warnings.push(`${nodeName} 当前缺少可用入口地址，暂无法生成直连分享链接。`);
      }

      targets.push(target);
    }

    return {
      request_origin: requestOrigin,
      targets,
      warnings: uniqueStrings(warnings),
    };
  }

  async function buildAccessUserShareResponse(input) {
    const options =
      input && typeof input === "object" && !Array.isArray(input) ? input.options ?? {} : {};
    const {
      accessUser,
      nodes = [],
      releases = [],
      operations = [],
      requestOrigin = "",
    } = input;
    const includeQr = options.includeQr !== false;

    const effective = findEffectiveUserTargets({
      accessUser,
      nodes,
      releases,
      operations,
      requestOrigin,
    });
    const aggregateSubscriptionUrl = buildAggregateSubscriptionUrl(accessUser?.share_token, {
      requestOrigin,
    });
    const aggregateQrSvg = includeQr ? await buildQrSvg(aggregateSubscriptionUrl) : null;

    const targets = await Promise.all(
      effective.targets.map(async (target) => {
        const nodeSubscriptionUrl = buildNodeSubscriptionUrl(accessUser?.share_token, target.node_id, {
          requestOrigin,
        });
        const subscriptionQrSvg = includeQr ? await buildQrSvg(nodeSubscriptionUrl) : null;
        const shareUrl =
          target.protocol === "vmess" ? buildVmessShareUrl(target) : buildVlessShareUrl(target);
        const shareQrSvg = includeQr ? await buildQrSvg(shareUrl) : null;

        return {
          node_id: target.node_id,
          node_name: target.node_name,
          provider: target.provider,
          region: target.region,
          endpoint_host: target.endpoint_host,
          endpoint_port: target.endpoint_port,
          published: true,
          protocol: target.protocol,
          transport: target.transport,
          security: target.security,
          label: target.label,
          access_mode: target.access_mode,
          route_label: target.route_label,
          subscription_url: nodeSubscriptionUrl,
          subscription_qr_svg: subscriptionQrSvg,
          share_url: shareUrl,
          share_qr_svg: shareQrSvg,
          latest_release_id: target.latest_release_id,
          latest_release_created_at: target.latest_release_created_at,
        };
      }),
    );

    return {
      access_user: accessUser,
      aggregate: {
        subscription_url: aggregateSubscriptionUrl,
        subscription_qr_svg: aggregateQrSvg,
        target_count: targets.length,
      },
      targets,
      warnings: effective.warnings,
    };
  }

  return {
    buildAccessUserShareResponse,
    buildAggregateSubscriptionUrl,
    buildNodeSubscriptionUrl,
    buildQrSvg,
    buildSubscriptionContent,
    buildVlessShareUrl,
    buildVmessShareUrl,
    findEffectiveUserTargets,
    findLatestSuccessfulReleaseForNode,
    resolvePublicBaseUrl,
    resolveRequestOrigin,
  };
}
