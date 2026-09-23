// 接入用户凭证的协议级格式校验（纯函数，不依赖 ctx / store）。
//
// 分工（避免对同一字段重复报错）：
// - validators.js 负责字段类型语义（credential 必须是对象、字段给了但为空串 /
//   非字符串、alter_id 给了但非非负整数等）。
// - 本模块负责**按协议的格式约束**：vless/vmess 给了 uuid 就必须形如 UUID；
//   hysteria2 给了 password 就必须 >= 8 位。
// - 两者都不做「必填」：buildAccessUserRecord（src/server.js）在凭证缺省时生成
//   uuid / 随机密码，「留空由服务端生成」是有意的前端流程，不是缺口。

const SUPPORTED_PROTOCOLS = new Set(["vless", "vmess", "hysteria2"]);

// 规范 8-4-4-4-12 形式的 UUID；大小写均可，连字符允许省略（32 位十六进制同样接受）。
const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

const MIN_HYSTERIA2_PASSWORD_LENGTH = 8;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// 未知/缺省协议按 vless 处理（与路由层 `?? "vless"` 的口径一致）。
export function normalizeCredentialProtocol(protocol) {
  const text = normalizeString(protocol)?.toLowerCase();
  return SUPPORTED_PROTOCOLS.has(text) ? text : "vless";
}

/**
 * 按协议校验已给出的凭证字段格式，返回错误消息数组（空数组即通过）。
 * 凭证缺省不报错：服务端 buildAccessUserRecord 会生成 uuid / 随机密码。
 * @param {{ protocol?: unknown, credential?: unknown }} options
 * @returns {string[]}
 */
export function validateAccessUserCredential({ protocol, credential } = {}) {
  const errors = [];
  const resolved = normalizeCredentialProtocol(protocol);

  // credential 缺失/为 null 时按空对象处理（无字段可校验，直接通过）；
  // 给出了但不是普通对象（字符串/数字/数组）由 validators.js 报
  // "credential must be an object"，此处不再重复。
  if (credential !== undefined && credential !== null && !isPlainObject(credential)) {
    return errors;
  }
  const cred = isPlainObject(credential) ? credential : {};

  if (resolved === "hysteria2") {
    const password = cred.password;
    if (typeof password === "string" && password.trim()) {
      if (password.trim().length < MIN_HYSTERIA2_PASSWORD_LENGTH) {
        errors.push("credential.password must be at least 8 characters for hysteria2 users");
      }
    }
    // 空串 / 非字符串的 password 由 validators.js 报类型错误，这里不重复。
    return errors;
  }

  // vless / vmess：给了 uuid 就必须是合法 UUID。
  const uuid = cred.uuid;
  if (typeof uuid === "string" && uuid.trim()) {
    if (!UUID_PATTERN.test(uuid.trim())) {
      errors.push("credential.uuid must be a valid UUID");
    }
  }
  // 空串 / 非字符串 / 缺省的 uuid 分别由 validators.js 与记录构造器处理，这里不重复。

  // alter_id 沿用 validators.js 的非负整数语义；这里补 vmess 的协议级口径，
  // 消息与 validators.js 完全一致，路由层合并 details 时去重即可。
  if (
    resolved === "vmess" &&
    cred.alter_id !== undefined &&
    cred.alter_id !== null &&
    (!Number.isInteger(cred.alter_id) || cred.alter_id < 0)
  ) {
    errors.push("credential.alter_id must be a non-negative integer");
  }

  return errors;
}

/**
 * 模拟 buildAccessUserRecord 的字段级合并语义：patch 里缺失/空串/非字符串的
 * 字段回落到 base（normalizeNullableString 口径），供 PATCH 校验「合并后的
 * 生效凭证」而不是孤立地看请求体。
 * @param {unknown} base 存量 credential
 * @param {unknown} patch 本次请求的 credential
 * @returns {unknown} patch 非普通对象时原样返回（交给 validators.js 报类型错误）
 */
export function mergeAccessUserCredential(base, patch) {
  const current = isPlainObject(base) ? base : {};
  if (!isPlainObject(patch)) {
    return patch ?? null;
  }

  const merged = { ...current };
  const uuid = normalizeString(patch.uuid);
  if (uuid) {
    merged.uuid = uuid;
  }
  const password = normalizeString(patch.password);
  if (password) {
    merged.password = password;
  }
  if (patch.alter_id !== undefined && patch.alter_id !== null) {
    merged.alter_id = patch.alter_id;
  }
  return merged;
}
