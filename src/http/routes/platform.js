import { createHash } from "node:crypto";
import { stat as statFile } from "node:fs/promises";
import path from "node:path";
import { validatePlatformSingBoxDistributionUpdate, validatePlatformSingBoxMirrorRequest } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

// sing-box 的 version 会参与镜像落盘路径与匿名下载路径拼接（domain 的 artifactFilePath 用的是
// path.join，不会自己吸收 `..`），所以进镜像流程前必须先锁成单个安全路径段。
const SAFE_ARTIFACT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

function isSafeArtifactVersion(version) {
  // 正则已经排除了 `/`、`\`、空字符与控制字符；`..` 字面上合法，需要单独挡掉。
  return typeof version === "string" && SAFE_ARTIFACT_VERSION.test(version) && !version.includes("..");
}

function readLengthPrefixedString(buffer, offset) {
  if (!Buffer.isBuffer(buffer) || offset + 4 > buffer.length) {
    return null;
  }

  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  if (length <= 0 || start + length > buffer.length) {
    return null;
  }

  return buffer.subarray(start, start + length).toString("utf8");
}

// 只从公钥文本派生「算法 + 指纹」。公钥 wire format 的第一段必须与行首的类型串一致，
// 否则视为不可信输入，不给出指纹。全程不读私钥、也不回传公钥本体。
function parseSshPublicKey(publicKey) {
  const text = String(publicKey ?? "").trim();
  if (!text) {
    return null;
  }

  const [keyType, body] = text.split(/\s+/);
  if (!keyType || !body) {
    return null;
  }

  let blob = null;
  try {
    blob = Buffer.from(body, "base64");
  } catch {
    return null;
  }

  if (!blob || blob.length === 0) {
    return null;
  }

  if (readLengthPrefixedString(blob, 0) !== keyType) {
    return null;
  }

  return {
    key_type: keyType,
    algorithm: keyType.replace(/^ssh-/, "").replace(/-cert-authority$/, ""),
    fingerprint: `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`,
  };
}

function toIsoTime(date) {
  if (!date || typeof date.getTime !== "function") {
    return null;
  }

  const ms = date.getTime();
  return Number.isFinite(ms) && ms > 0 ? date.toISOString() : null;
}

// 公钥文件的 birthtime/mtime 作为密钥对的 created_at/updated_at。
// 只对 `${private_key_path}.pub` 做 stat（与 domain 里 env/managed 两种来源的公钥命名一致），
// 不打开私钥，也不返回任何绝对路径。
async function readPublicKeyTimestamps(privateKeyPath) {
  if (!privateKeyPath) {
    return { created_at: null, updated_at: null };
  }

  try {
    const info = await statFile(`${privateKeyPath}.pub`);
    const updated = toIsoTime(info.mtime);
    return {
      created_at: toIsoTime(info.birthtime) ?? updated,
      updated_at: updated,
    };
  } catch {
    return { created_at: null, updated_at: null };
  }
}

export function buildPlatformSshKeyView(keyState, timestamps = {}) {
  const state = keyState ?? {};
  const source = state.source ?? "missing";
  const parsed = parseSshPublicKey(state.public_key);
  const privateKeyPath = state.private_key_path ?? null;

  return {
    // 与 platform-context 的 ssh_key.status 同一口径，前端/脚本可以互换着读
    status: state.ok
      ? state.bootstrap_ready
        ? "ready"
        : "partial"
      : state.reason_code === "platform_ssh_key_invalid"
        ? "invalid"
        : "missing",
    usable: Boolean(state.ok),
    managed: source === "managed",
    source,
    bootstrap_ready: Boolean(state.bootstrap_ready),
    can_generate: source !== "env",
    algorithm: parsed?.algorithm ?? null,
    key_type: parsed?.key_type ?? null,
    fingerprint: parsed?.fingerprint ?? null,
    public_key_available: Boolean(String(state.public_key ?? "").trim()),
    // 只给文件名/目录名：足够人工定位是哪一份密钥，绝对路径与文件内容都不出接口
    private_key_file_name: privateKeyPath ? path.basename(privateKeyPath) : null,
    private_key_dir_name: privateKeyPath ? path.basename(path.dirname(privateKeyPath)) : null,
    created_at: timestamps?.created_at ?? null,
    updated_at: timestamps?.updated_at ?? null,
    reason_code: state.reason_code ?? null,
    note: state.note ?? null,
  };
}

export function createPlatformRoutes(ctx) {
  const {
    buildPlatformContext,
    buildPublishDistribution,
    generateManagedPlatformSshKey,
    hasOwn,
    mirrorPlatformSingBoxArtifact,
    platformSshKeyState,
    updatePlatformSingBoxDistribution,
  } = ctx;

  return async function handlePlatformRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/platform-context") {
      jsonResponse(reply, 200, await buildPlatformContext(url));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/platform/sing-box-distribution") {
      jsonResponse(reply, 200, {
        sing_box_distribution: (await buildPlatformContext(url)).sing_box_distribution,
      });
      return;
    }

    if (request.method === "PATCH" && url.pathname === "/api/v1/platform/sing-box-distribution") {
      try {
        const payload = await readJsonBody(request);
        const mappedPayload = {
          ...(hasOwn(payload, "enabled") ? { enabled: payload.enabled } : {}),
          ...(hasOwn(payload, "version")
            ? { version: payload.version }
            : hasOwn(payload, "default_version")
              ? { version: payload.default_version }
              : {}),
          ...(hasOwn(payload, "install_path") ? { install_path: payload.install_path } : {}),
          ...(hasOwn(payload, "variants") ? { variants: payload.variants } : {}),
        };
        const errors = validatePlatformSingBoxDistributionUpdate(mappedPayload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        await updatePlatformSingBoxDistribution(mappedPayload);
        jsonResponse(reply, 200, {
          message: "sing-box 分发配置已更新。",
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (
      request.method === "POST" &&
      ["/api/v1/platform/sing-box-distribution/mirror", "/api/v1/platform/sing-box-distribution/sync"].includes(
        url.pathname,
      )
    ) {
      try {
        const payload = await readJsonBody(request);
        if (hasOwn(payload, "target")) {
          const errors = validatePlatformSingBoxMirrorRequest(payload);
          if (errors.length > 0) {
            jsonResponse(reply, 400, {
              error: "validation_failed",
              details: errors,
            });
            return;
          }
        }

        const distribution = buildPublishDistribution(null);
        const targets = hasOwn(payload, "target")
          ? [String(payload.target).trim()]
          : distribution.variants.map((variant) => variant.target);

        if (targets.length === 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: ["no enabled sing-box variants configured"],
          });
          return;
        }

        // version 参与镜像落盘路径拼接：一旦被改成 `../..` 形态，镜像下载会把制品写到 artifacts 目录之外。
        if (!isSafeArtifactVersion(distribution.version)) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: ["configured sing-box version is not a safe artifact path segment"],
          });
          return;
        }

        const results = [];
        for (const target of targets) {
          results.push(await mirrorPlatformSingBoxArtifact(target));
        }

        jsonResponse(reply, 201, {
          message: `已同步 ${results.length} 个 sing-box 镜像。`,
          results,
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/platform/ssh-key/generate") {
      try {
        await generateManagedPlatformSshKey();
        jsonResponse(reply, 201, {
          message: "平台 SSH 密钥已生成，新的 bootstrap 将自动注入这把公钥。",
          platform_context: await buildPlatformContext(url),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        const exists = message.includes("已存在");
        // 状态码与错误码必须成对：409 走文档化的 conflict（前端只取 message，不取 error）
        jsonResponse(reply, exists ? 409 : 400, {
          error: exists ? "conflict" : "bad_request",
          message,
        });
      }
      return;
    }

    // 只读复查口：ssh-key/generate 是单向的，生成后原来只能靠 platform-context 的整包首屏数据回看。
    // 这里刻意不复用 buildPlatformContext —— 那份响应带着公钥本体与私钥绝对路径（首屏契约，不能改），
    // 本接口只输出状态类信息：既不含私钥内容/路径，也不含公钥本体。
    if (request.method === "GET" && url.pathname === "/api/v1/platform/ssh-key") {
      const keyState = await platformSshKeyState();
      const timestamps = await readPublicKeyTimestamps(keyState?.private_key_path ?? null);
      jsonResponse(reply, 200, {
        platform_ssh_key: buildPlatformSshKeyView(keyState, timestamps),
      });
      return;
    }
  };
}
