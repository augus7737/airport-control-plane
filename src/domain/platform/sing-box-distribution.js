import { createHash } from "node:crypto";
import path from "node:path";

const SUPPORTED_TARGETS = Object.freeze(["linux-amd64", "linux-arm64"]);
const DEFAULT_INSTALL_PATH = "/usr/local/bin/sing-box";
const DEFAULT_VERSION = "1.12.22";

function hasOwn(object, key) {
  return Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
}

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

function normalizeVersion(value, fallback = DEFAULT_VERSION) {
  const trimmed = normalizeString(value);
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/^v/i, "");
}

function releaseTag(version) {
  const normalized = normalizeVersion(version);
  return normalized.startsWith("v") ? normalized : `v${normalized}`;
}

function artifactFileName(version, target) {
  return `sing-box-${normalizeVersion(version)}-${target}.tar.gz`;
}

function defaultUpstreamUrl(version, target) {
  const normalizedVersion = normalizeVersion(version);
  return `https://dl.sing-box.org/releases/latest/${artifactFileName(normalizedVersion, target)}`;
}

function defaultVariant(version, target) {
  return {
    target,
    enabled: true,
    upstream_url: defaultUpstreamUrl(version, target),
    upstream_sha256: null,
    mirror_available: false,
    mirror_sha256: null,
    mirror_size_bytes: null,
    mirror_downloaded_at: null,
    note: null,
  };
}

function defaultDistribution(nowIso) {
  const timestamp = nowIso();
  const version = DEFAULT_VERSION;

  return {
    enabled: true,
    version,
    install_path: DEFAULT_INSTALL_PATH,
    variants: Object.fromEntries(
      SUPPORTED_TARGETS.map((target) => [target, defaultVariant(version, target)]),
    ),
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function artifactFilePath(artifactsDir, version, target) {
  return path.join(artifactsDir, normalizeVersion(version), target, artifactFileName(version, target));
}

function artifactPublicPath(version, target) {
  return `/api/v1/artifacts/sing-box/${encodeURIComponent(normalizeVersion(version))}/${encodeURIComponent(target)}`;
}

function normalizeVariantRecord(version, target, value = {}, previous = null) {
  const defaultRecord = defaultVariant(version, target);
  const baseRecord = isPlainObject(previous) ? previous : defaultRecord;
  const patch = isPlainObject(value) ? value : {};
  const nextUpstreamUrl = hasOwn(patch, "upstream_url")
    ? normalizeString(patch.upstream_url) ?? defaultRecord.upstream_url
    : normalizeString(baseRecord.upstream_url) ?? defaultRecord.upstream_url;
  const nextUpstreamSha256 = hasOwn(patch, "upstream_sha256")
    ? normalizeString(patch.upstream_sha256)
    : normalizeString(baseRecord.upstream_sha256);
  const requestedMirrorAvailable = hasOwn(patch, "mirror_available")
    ? Boolean(patch.mirror_available)
    : Boolean(baseRecord.mirror_available);
  const requestedMirrorSha256 = hasOwn(patch, "mirror_sha256")
    ? normalizeString(patch.mirror_sha256)
    : normalizeString(baseRecord.mirror_sha256);
  const requestedMirrorSize = hasOwn(patch, "mirror_size_bytes")
    ? Number.isFinite(Number(patch.mirror_size_bytes))
      ? Number(patch.mirror_size_bytes)
      : null
    : Number.isFinite(Number(baseRecord.mirror_size_bytes))
      ? Number(baseRecord.mirror_size_bytes)
      : null;
  const requestedMirrorDownloadedAt = hasOwn(patch, "mirror_downloaded_at")
    ? normalizeString(patch.mirror_downloaded_at)
    : normalizeString(baseRecord.mirror_downloaded_at);
  const requestedNote = hasOwn(patch, "note")
    ? normalizeString(patch.note)
    : normalizeString(baseRecord.note);

  const upstreamChanged =
    normalizeString(baseRecord.upstream_url) !== nextUpstreamUrl ||
    normalizeString(baseRecord.upstream_sha256) !== nextUpstreamSha256;

  return {
    target,
    enabled: hasOwn(patch, "enabled") ? Boolean(patch.enabled) : Boolean(baseRecord.enabled ?? true),
    upstream_url: nextUpstreamUrl,
    upstream_sha256: nextUpstreamSha256,
    mirror_available: upstreamChanged ? false : requestedMirrorAvailable,
    mirror_sha256: upstreamChanged || !requestedMirrorAvailable ? null : requestedMirrorSha256,
    mirror_size_bytes: upstreamChanged || !requestedMirrorAvailable ? null : requestedMirrorSize,
    mirror_downloaded_at:
      upstreamChanged || !requestedMirrorAvailable ? null : requestedMirrorDownloadedAt,
    note: requestedNote,
  };
}

function normalizeDistributionRecord(value, nowIso, previous = null) {
  const fallback = previous || defaultDistribution(nowIso);
  const patch = isPlainObject(value) ? value : {};
  const nextVersion = hasOwn(patch, "version")
    ? normalizeVersion(patch.version, fallback.version)
    : normalizeVersion(fallback.version);
  const versionChanged = normalizeVersion(fallback.version) !== nextVersion;
  const variantsPatch = isPlainObject(patch.variants) ? patch.variants : {};
  const normalizedVariants = {};

  for (const target of SUPPORTED_TARGETS) {
    const existingVariant = versionChanged ? defaultVariant(nextVersion, target) : fallback.variants?.[target];
    normalizedVariants[target] = normalizeVariantRecord(
      nextVersion,
      target,
      variantsPatch[target],
      existingVariant,
    );
  }

  return {
    enabled: hasOwn(patch, "enabled") ? Boolean(patch.enabled) : Boolean(fallback.enabled),
    version: nextVersion,
    install_path: hasOwn(patch, "install_path")
      ? normalizeString(patch.install_path) ?? DEFAULT_INSTALL_PATH
      : normalizeString(fallback.install_path) ?? DEFAULT_INSTALL_PATH,
    variants: normalizedVariants,
    created_at: normalizeString(fallback.created_at) ?? nowIso(),
    updated_at: nowIso(),
  };
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && error.code === "ENOENT";
}

function buildEffectiveVariant(baseUrl, version, variant) {
  const artifactUrl =
    baseUrl && variant.mirror_available ? `${baseUrl}${artifactPublicPath(version, variant.target)}` : null;
  const effectiveUrl = artifactUrl || variant.upstream_url || null;
  const effectiveSha256 =
    normalizeString(variant.mirror_sha256) || normalizeString(variant.upstream_sha256) || null;

  return {
    ...variant,
    source_mode: artifactUrl ? "platform-mirror" : "upstream",
    mirrored_url: artifactUrl,
    effective_url: effectiveUrl,
    effective_sha256: effectiveSha256,
  };
}

export function createPlatformSingBoxDistributionDomain(dependencies = {}) {
  const {
    artifactsDir,
    distributionFile,
    mkdir,
    nowIso,
    readFile,
    spawn,
    stat,
    writeFile,
  } = dependencies;

  let distributionState = defaultDistribution(nowIso);

  async function ensureArtifactsDir() {
    await mkdir(artifactsDir, { recursive: true });
  }

  async function persistDistribution() {
    await ensureArtifactsDir();
    await writeFile(distributionFile, JSON.stringify(distributionState, null, 2), "utf8");
  }

  async function loadDistribution() {
    try {
      const raw = await readFile(distributionFile, "utf8");
      const payload = JSON.parse(raw);
      distributionState = normalizeDistributionRecord(payload, nowIso, distributionState);

      let mutated = false;
      for (const target of SUPPORTED_TARGETS) {
        const variant = distributionState.variants[target];
        if (!variant?.mirror_available) {
          continue;
        }

        try {
          const info = await stat(artifactFilePath(artifactsDir, distributionState.version, target));
          if (!info.isFile()) {
            throw new Error("artifact not a file");
          }
        } catch {
          distributionState.variants[target] = {
            ...variant,
            mirror_available: false,
            mirror_sha256: null,
            mirror_size_bytes: null,
            mirror_downloaded_at: null,
            note: "镜像文件缺失，已回退到上游下载。",
          };
          mutated = true;
        }
      }

      if (mutated) {
        await persistDistribution();
      }
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      distributionState = defaultDistribution(nowIso);
      await persistDistribution();
    }

    return distributionState;
  }

  function getDistribution() {
    return distributionState;
  }

  async function updateDistribution(payload = {}) {
    distributionState = normalizeDistributionRecord(payload, nowIso, distributionState);
    await persistDistribution();
    return distributionState;
  }

  function serializeDistribution(baseUrl = null) {
    return {
      enabled: distributionState.enabled,
      version: distributionState.version,
      install_path: distributionState.install_path,
      updated_at: distributionState.updated_at,
      created_at: distributionState.created_at,
      supported_targets: [...SUPPORTED_TARGETS],
      variants: SUPPORTED_TARGETS.map((target) =>
        buildEffectiveVariant(baseUrl, distributionState.version, distributionState.variants[target]),
      ),
    };
  }

  function buildPublishDistribution(baseUrl = null) {
    const serialized = serializeDistribution(baseUrl);
    return {
      enabled: serialized.enabled,
      version: serialized.version,
      install_path: serialized.install_path,
      variants: serialized.variants.filter((variant) => variant.enabled && variant.effective_url),
    };
  }

  async function mirrorArtifact(target) {
    if (!SUPPORTED_TARGETS.includes(target)) {
      throw new Error(`unsupported sing-box target: ${target}`);
    }

    const variant = distributionState.variants[target];
    if (!variant?.upstream_url) {
      throw new Error(`target ${target} is missing upstream_url`);
    }

    let buffer = null;
    try {
      const response = await fetch(variant.upstream_url, {
        redirect: "follow",
        headers: {
          "user-agent": "airport-control-plane",
        },
      });

      if (!response.ok) {
        throw new Error(`download failed with HTTP ${response.status}`);
      }

      buffer = Buffer.from(await response.arrayBuffer());
    } catch (fetchError) {
      if (typeof spawn !== "function") {
        throw fetchError;
      }

      buffer = await new Promise((resolve, reject) => {
        const child = spawn(
          "curl",
          ["-fsSL", "--connect-timeout", "20", "--max-time", "300", variant.upstream_url],
          {
          stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const chunks = [];
        let stderr = "";

        child.stdout.on("data", (chunk) => {
          chunks.push(Buffer.from(chunk));
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
          if (code === 0) {
            resolve(Buffer.concat(chunks));
            return;
          }

          reject(new Error(stderr.trim() || `curl exited with code ${code}`));
        });
      });
    }

    const sha256 = sha256Buffer(buffer);
    const targetFile = artifactFilePath(artifactsDir, distributionState.version, target);
    await mkdir(path.dirname(targetFile), { recursive: true });
    await writeFile(targetFile, buffer);

    distributionState = normalizeDistributionRecord(
      {
        variants: {
          [target]: {
            note: "镜像已同步到控制面。",
          },
        },
      },
      nowIso,
      {
        ...distributionState,
        variants: {
          ...distributionState.variants,
          [target]: {
            ...variant,
            mirror_available: true,
            mirror_sha256: sha256,
            mirror_size_bytes: buffer.byteLength,
            mirror_downloaded_at: nowIso(),
            note: "镜像已同步到控制面。",
          },
        },
      },
    );

    distributionState.variants[target] = {
      ...distributionState.variants[target],
      mirror_available: true,
      mirror_sha256: sha256,
      mirror_size_bytes: buffer.byteLength,
      mirror_downloaded_at: nowIso(),
      note: "镜像已同步到控制面。",
    };

    distributionState.updated_at = nowIso();
    await persistDistribution();

    return {
      target,
      version: distributionState.version,
      file_path: targetFile,
      file_name: artifactFileName(distributionState.version, target),
      sha256,
      size_bytes: buffer.byteLength,
      downloaded_at: distributionState.variants[target].mirror_downloaded_at,
    };
  }

  return {
    artifactFileName,
    artifactFilePath: (version, target) => artifactFilePath(artifactsDir, version, target),
    artifactPublicPath,
    buildPublishDistribution,
    buildUpstreamUrl: defaultUpstreamUrl,
    getDistribution,
    loadDistribution,
    mirrorArtifact,
    persistDistribution,
    serializeDistribution,
    supportedTargets: [...SUPPORTED_TARGETS],
    updateDistribution,
  };
}
