export function createBootstrapTokenDomain(dependencies) {
  const {
    store,
    index,
    bootstrapTokensFile,
    ensureDataDir,
    readFile,
    writeFile,
    randomUUID,
    nowIso,
    nowMs = () => Date.now(),
  } = dependencies;

  function normalizeBootstrapTimestamp(value) {
    if (value === undefined || value === null) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }

  function registerBootstrapToken(token) {
    store.set(token.id, token);
    index.set(token.token, token.id);
    return token;
  }

  async function persistBootstrapTokens() {
    await ensureDataDir();
    const payload = {
      items: [...store.values()],
    };
    await writeFile(bootstrapTokensFile, JSON.stringify(payload, null, 2), "utf8");
  }

  async function loadBootstrapTokens() {
    try {
      const raw = await readFile(bootstrapTokensFile, "utf8");
      const payload = JSON.parse(raw);
      const items = Array.isArray(payload.items) ? payload.items : [];

      store.clear();
      index.clear();

      for (const item of items) {
        if (!item?.id || !item?.token) {
          continue;
        }
        registerBootstrapToken({
          id: item.id,
          token: item.token,
          label: item.label ?? null,
          status: item.status ?? "active",
          created_at: item.created_at ?? null,
          expires_at: item.expires_at ?? null,
          max_uses: item.max_uses ?? null,
          uses: item.uses ?? 0,
          last_used_at: item.last_used_at ?? null,
          last_used_node_id: item.last_used_node_id ?? null,
          note: item.note ?? null,
        });
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        await ensureDataDir();
        store.clear();
        index.clear();
        await persistBootstrapTokens();
        return;
      }
      throw error;
    }
  }

  function generateBootstrapTokenValue() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = randomUUID().replace(/-/g, "").slice(0, 24);
      if (!index.has(candidate)) {
        return candidate;
      }
    }

    throw new Error("无法生成唯一的 bootstrap token");
  }

  function findBootstrapTokenByValue(value) {
    if (!value) {
      return null;
    }

    const id = index.get(String(value));
    return id ? store.get(id) : null;
  }

  function bootstrapTokenError(token) {
    if (!token) {
      return {
        code: "bootstrap_token_missing",
        message: "没有匹配的 bootstrap token",
      };
    }

    if (token.status !== "active") {
      return {
        code: "bootstrap_token_inactive",
        message: "bootstrap token 已被停用或过期",
      };
    }

    if (token.expires_at) {
      const expiresAt = Date.parse(token.expires_at);
      if (!Number.isNaN(expiresAt) && nowMs() > expiresAt) {
        return {
          code: "bootstrap_token_expired",
          message: "bootstrap token 已过期",
        };
      }
    }

    if (Number.isFinite(token.max_uses) && token.max_uses !== null && token.uses >= token.max_uses) {
      return {
        code: "bootstrap_token_exhausted",
        message: "bootstrap token 已达到最大使用次数",
      };
    }

    return null;
  }

  function recordBootstrapTokenUsage(token, nodeId) {
    const previousUses = Number.isFinite(token.uses) ? token.uses : 0;
    token.uses = previousUses + 1;
    token.last_used_at = nowIso();
    token.last_used_node_id = nodeId;
    if (Number.isFinite(token.max_uses) && token.max_uses !== null && token.uses >= token.max_uses) {
      token.status = "exhausted";
    }
  }

  function buildBootstrapTokenRecord(payload, existingToken = null) {
    const now = nowIso();
    const expiresAt = normalizeBootstrapTimestamp(
      payload.expires_at ?? existingToken?.expires_at ?? null,
    );
    const rawMaxUses =
      payload.max_uses !== undefined
        ? payload.max_uses
        : existingToken?.max_uses ?? null;
    const maxUses =
      rawMaxUses === null || rawMaxUses === undefined ? null : Number(rawMaxUses);

    const explicitToken =
      typeof payload.token === "string" && payload.token.trim().length > 0
        ? payload.token.trim()
        : null;

    return {
      id: existingToken?.id ?? payload.id ?? `token_${randomUUID()}`,
      token:
        existingToken?.token ??
        explicitToken ??
        generateBootstrapTokenValue(),
      label: payload.label ?? existingToken?.label ?? "Bootstrap 令牌",
      status: payload.status ?? existingToken?.status ?? "active",
      created_at: existingToken?.created_at ?? payload.created_at ?? now,
      expires_at: expiresAt,
      max_uses: Number.isFinite(maxUses) ? maxUses : null,
      uses: existingToken?.uses ?? payload.uses ?? 0,
      last_used_at: existingToken?.last_used_at ?? payload.last_used_at ?? null,
      last_used_node_id:
        existingToken?.last_used_node_id ?? payload.last_used_node_id ?? null,
      note: payload.note ?? existingToken?.note ?? null,
    };
  }

  function serializeBootstrapToken(token) {
    return {
      id: token.id,
      token: token.token,
      label: token.label,
      status: token.status,
      note: token.note ?? null,
      created_at: token.created_at,
      expires_at: token.expires_at,
      max_uses: token.max_uses ?? null,
      uses: token.uses ?? 0,
      last_used_at: token.last_used_at ?? null,
      last_used_node_id: token.last_used_node_id ?? null,
    };
  }

  return {
    normalizeBootstrapTimestamp,
    registerBootstrapToken,
    persistBootstrapTokens,
    loadBootstrapTokens,
    generateBootstrapTokenValue,
    findBootstrapTokenByValue,
    bootstrapTokenError,
    recordBootstrapTokenUsage,
    buildBootstrapTokenRecord,
    serializeBootstrapToken,
  };
}
