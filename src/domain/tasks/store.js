export function createTaskStoreDomain(dependencies) {
  const {
    findSystemTemplateById = () => null,
    initTemplates,
    nowIso,
    randomUUID,
    taskStore,
  } = dependencies;

  function systemTemplateTaskKey(templateId) {
    const resolvedId = String(templateId || "").trim();
    return resolvedId ? `system-template:${resolvedId}` : "";
  }

  function parseSystemTemplateTaskKey(templateName) {
    const normalized = String(templateName || "").trim();
    if (!normalized.startsWith("system-template:")) {
      return null;
    }

    return normalized.slice("system-template:".length).trim() || null;
  }

  function resolveBuiltinInitTemplate(templateName) {
    const resolvedName = String(templateName || "alpine-base").trim() || "alpine-base";
    const builtin = initTemplates[resolvedName] || initTemplates["alpine-base"];
    return {
      name: resolvedName,
      display_name: builtin?.title || resolvedName,
      source_kind: "builtin",
      ...builtin,
    };
  }

  function normalizeTemplateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return null;
    }

    const scriptBody = typeof snapshot.script_body === "string" ? snapshot.script_body.trim() : "";
    if (!scriptBody) {
      return null;
    }

    const name = String(snapshot.name || "").trim();
    const displayName =
      String(
        snapshot.display_name ||
          snapshot.system_template_name ||
          snapshot.title ||
          snapshot.script_name ||
          name,
      ).trim() || "初始化模板";
    const title = String(snapshot.title || "").trim() || `初始化 · ${displayName}`;
    const taskType = String(snapshot.task_type || "init_alpine").trim() || "init_alpine";

    return {
      name: name || systemTemplateTaskKey(snapshot.system_template_id) || "snapshot:init",
      display_name: displayName,
      title,
      task_type: taskType,
      script_name: String(snapshot.script_name || displayName).trim() || displayName,
      script_body: String(snapshot.script_body || ""),
      source_kind:
        String(snapshot.source_kind || "").trim().toLowerCase() === "system-template"
          ? "system-template"
          : "snapshot",
      system_template_id: String(snapshot.system_template_id || "").trim() || null,
      system_template_name: String(snapshot.system_template_name || displayName).trim() || displayName,
    };
  }

  function buildSystemTemplateSnapshot(template) {
    if (!template?.system_template_id) {
      return null;
    }

    return {
      source_kind: template.source_kind || "system-template",
      system_template_id: template.system_template_id,
      system_template_name: template.system_template_name || template.display_name || template.title,
      name: template.name,
      display_name: template.display_name || template.title,
      title: template.title,
      task_type: template.task_type,
      script_name: template.script_name,
      script_body: template.script_body,
    };
  }

  function resolveSystemTemplateInitTemplate(systemTemplateId, fallbackSnapshot = null) {
    const resolvedId = String(systemTemplateId || "").trim();
    if (!resolvedId) {
      return fallbackSnapshot;
    }

    const systemTemplate = findSystemTemplateById(resolvedId);
    if (!systemTemplate) {
      return fallbackSnapshot;
    }

    const displayName = String(systemTemplate.name || resolvedId).trim() || resolvedId;

    return {
      name: systemTemplateTaskKey(resolvedId),
      display_name: displayName,
      title: `初始化 · ${displayName}`,
      task_type: "init_alpine",
      script_name:
        String(systemTemplate.script_name || systemTemplate.name || "初始化模板").trim() ||
        "初始化模板",
      script_body: String(systemTemplate.script_body || ""),
      source_kind: "system-template",
      system_template_id: resolvedId,
      system_template_name: displayName,
    };
  }

  function resolveInitTemplate(descriptor = {}) {
    if (typeof descriptor === "string") {
      return resolveBuiltinInitTemplate(descriptor);
    }

    const templateName =
      typeof descriptor.template === "string" ? descriptor.template.trim() : "";
    const snapshot = normalizeTemplateSnapshot(descriptor.template_snapshot);
    const systemTemplateId =
      String(descriptor.system_template_id || "").trim() ||
      parseSystemTemplateTaskKey(templateName);

    if (systemTemplateId) {
      return (
        resolveSystemTemplateInitTemplate(systemTemplateId, snapshot) ||
        resolveBuiltinInitTemplate("alpine-base")
      );
    }

    if (snapshot) {
      return snapshot;
    }

    return resolveBuiltinInitTemplate(templateName);
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) =>
      String(b.scheduled_at ?? b.created_at ?? "").localeCompare(
        String(a.scheduled_at ?? a.created_at ?? ""),
      ),
    );
  }

  function listNodeTasks(nodeId, type = null) {
    return taskStore.filter((task) => {
      if (task.node_id !== nodeId) {
        return false;
      }

      if (type && task.type !== type) {
        return false;
      }

      return true;
    });
  }

  function latestNodeTask(nodeId, type = null) {
    return sortTasks(listNodeTasks(nodeId, type))[0] || null;
  }

  function latestNodeTaskByTrigger(nodeId, type, trigger) {
    return (
      sortTasks(
        listNodeTasks(nodeId, type).filter((task) => {
          return (
            String(task.trigger || "").toLowerCase() === String(trigger || "").toLowerCase() ||
            String(task.payload?.reason || "").toLowerCase() === String(trigger || "").toLowerCase()
          );
        }),
      )[0] || null
    );
  }

  function bootstrapProbeTaskForInitTask(nodeId, initTaskId) {
    if (!initTaskId) {
      return null;
    }

    return (
      sortTasks(
        listNodeTasks(nodeId, "probe_node").filter((task) => {
          return (
            String(task.trigger || "").toLowerCase() === "bootstrap_auto_probe" &&
            String(task.payload?.init_task_id || "") === String(initTaskId)
          );
        }),
      )[0] || null
    );
  }

  function buildTaskRecord(node, options = {}) {
    const scheduledAt = options.scheduled_at ?? nowIso();
    return {
      id: `task_${randomUUID()}`,
      node_id: node.id,
      type: options.type ?? "task",
      title: options.title ?? "平台任务",
      status: options.status ?? "new",
      template: options.template ?? null,
      trigger: options.trigger ?? "system",
      payload: options.payload && typeof options.payload === "object" ? options.payload : {},
      attempt: Number(options.attempt ?? 0) || 0,
      scheduled_at: scheduledAt,
      created_at: options.created_at ?? scheduledAt,
      updated_at: scheduledAt,
      started_at: options.started_at ?? null,
      finished_at: options.finished_at ?? null,
      operation_id: options.operation_id ?? null,
      note: options.note ?? null,
      log_excerpt: Array.isArray(options.log_excerpt) ? options.log_excerpt : [],
    };
  }

  function upsertTaskRecord(task) {
    const index = taskStore.findIndex((item) => item.id === task.id);
    task.updated_at = nowIso();

    if (index >= 0) {
      taskStore[index] = task;
    } else {
      taskStore.unshift(task);
    }

    if (taskStore.length > 200) {
      taskStore.length = 200;
    }

    return task;
  }

  function ensureNodeInitTask(node, options = {}) {
    const template = resolveInitTemplate({
      template: options.template,
      system_template_id: options.system_template_id,
      template_snapshot: options.template_snapshot,
    });
    const latestTask = latestNodeTask(node.id, template.task_type);

    if (
      latestTask &&
      (latestTask.template || latestTask.payload?.template || "alpine-base") === template.name &&
      ["new", "running", "failed"].includes(String(latestTask.status || "new").toLowerCase()) &&
      !options.force_new
    ) {
      return latestTask;
    }

    const task = buildTaskRecord(node, {
      type: template.task_type,
      title: options.title ?? template.title,
      template: template.name,
      trigger: options.trigger ?? "bootstrap_register",
      note:
        options.note ??
        "等待节点确认平台 SSH 公钥写入完成，随后自动执行初始化模板。",
      payload: {
        template: template.name,
        template_label: template.display_name ?? template.title,
        ...(template.system_template_id
          ? {
              system_template_id: template.system_template_id,
            }
          : {}),
        ...(buildSystemTemplateSnapshot(template)
          ? {
              template_snapshot: buildSystemTemplateSnapshot(template),
            }
          : {}),
        reason: options.reason ?? "bootstrap_register",
      },
    });

    upsertTaskRecord(task);
    return task;
  }

  return {
    bootstrapProbeTaskForInitTask,
    buildTaskRecord,
    ensureNodeInitTask,
    latestNodeTask,
    latestNodeTaskByTrigger,
    listNodeTasks,
    resolveInitTemplate,
    sortTasks,
    upsertTaskRecord,
  };
}
