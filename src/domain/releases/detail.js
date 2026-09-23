// 单条配置发布的明细投影：把内存里整条 release 记录映射成
//   1) 与 GET /api/v1/config-releases 列表项同构（保留全部顶层字段）的 release；
//   2) 有界的节点侧产物摘要，避免把 N 台节点的完整渲染配置/脚本字节整体塞进响应。
//
// 有界口径（详见交付报告）：
//   - 逐节点产物只保留 engine/config_digest/config_path 等标量与短摘要；
//   - rendered_config 不再原样返回，改为「长度 + 截断预览 + 截断标记」；
//   - manifest 内联大块只保留存在性标记；
//   - 完整脚本/配置全文指向既有 operations 通道（release.operation_id）与订阅通道。

const RENDERED_CONFIG_PREVIEW_BYTES = 600;

function toSerialized(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function byteLength(text) {
  return new TextEncoder().encode(text).length;
}

function truncate(text, limit) {
  if (text.length <= limit) {
    return { preview: text, truncated: false };
  }
  return { preview: text.slice(0, limit), truncated: true };
}

function projectArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }

  const hasRenderedConfig = Object.prototype.hasOwnProperty.call(artifact, "rendered_config");
  const serialized = hasRenderedConfig ? toSerialized(artifact.rendered_config) : "";
  const { preview, truncated } = truncate(serialized, RENDERED_CONFIG_PREVIEW_BYTES);

  return {
    engine: artifact.engine ?? null,
    config_digest: artifact.config_digest ?? null,
    config_path: artifact.config_path ?? null,
    // rendered_config 原样字节不外泄，只给长度 + 有界预览（供 UI 直接渲染摘要）。
    ...(hasRenderedConfig
      ? {
          rendered_config_bytes: byteLength(serialized),
          rendered_config_preview: preview,
          rendered_config_truncated: truncated,
        }
      : {}),
    manifest_omitted: Boolean(artifact.manifest),
    ...(Array.isArray(artifact.bindings) ? { bindings: artifact.bindings } : {}),
  };
}

function projectDeployment(deployment) {
  if (!deployment || typeof deployment !== "object") {
    return null;
  }

  const artifacts = {};
  for (const [key, artifact] of Object.entries(deployment.artifacts ?? {})) {
    const projected = projectArtifact(artifact);
    if (projected) {
      artifacts[key] = projected;
    }
  }

  return {
    ...deployment,
    artifacts,
  };
}

function summarizeDeployment(deployment) {
  const artifacts = deployment?.artifacts ?? {};
  return {
    node_id: deployment?.node_id ?? null,
    node_name: deployment?.node_name ?? null,
    status: deployment?.status ?? null,
    route_roles: Array.isArray(deployment?.route_roles) ? deployment.route_roles : [],
    components: Object.entries(artifacts).map(([key, artifact]) => ({
      key,
      engine: artifact?.engine ?? null,
      config_digest: artifact?.config_digest ?? null,
      config_path: artifact?.config_path ?? null,
      ...(typeof artifact?.rendered_config_bytes === "number"
        ? { rendered_config_bytes: artifact.rendered_config_bytes }
        : {}),
      rendered_config_truncated: Boolean(artifact?.rendered_config_truncated),
      manifest_omitted: Boolean(artifact?.manifest_omitted),
    })),
  };
}

export function projectConfigReleaseForDetail(release) {
  if (!release || typeof release !== "object") {
    return null;
  }

  const deployments = Array.isArray(release.deployments)
    ? release.deployments.map((deployment) => projectDeployment(deployment)).filter(Boolean)
    : [];

  const boundedRelease = {
    ...release,
    deployments,
  };

  const renderedConfigBytes = deployments.reduce((total, deployment) => {
    for (const artifact of Object.values(deployment.artifacts ?? {})) {
      if (typeof artifact?.rendered_config_bytes === "number") {
        return total + artifact.rendered_config_bytes;
      }
    }
    return total;
  }, 0);

  const detail = {
    release_id: release.id ?? null,
    version: release.version ?? null,
    profile_id: release.profile_id ?? null,
    status: release.status ?? null,
    operation_id: release.operation_id ?? null,
    deployment_count: deployments.length,
    // 全量渲染配置的真实字节数（用于 UI 说明「省略了多少」），响应内不含这些字节本体。
    rendered_config_total_bytes: renderedConfigBytes,
    rendered_config_preview_bytes: RENDERED_CONFIG_PREVIEW_BYTES,
    bounded: true,
    per_node: deployments.map((deployment) => summarizeDeployment(deployment)),
    full_artifact_reference: {
      // 完整脚本/逐节点配置全文走既有只读通道，明细接口不重复搬运。
      operations_endpoint: release.operation_id ? `/api/v1/operations/${release.operation_id}` : null,
      subscription_endpoint: "/sub/:shareToken",
      note: "逐节点渲染配置与下发脚本的全文通过 operations / 订阅通道获取，本响应只返回有界摘要。",
    },
  };

  return { release: boundedRelease, detail };
}
