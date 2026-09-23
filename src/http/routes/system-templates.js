import { validateSystemTemplateApply, validateSystemTemplateCreate, validateSystemTemplateUpdate } from "../../http/validators.js";
import { jsonResponse, readJsonBody } from "../../utils/http.js";

export function createSystemTemplatesRoutes(ctx) {
  const {
    buildSystemTemplateRecord,
    executeSystemTemplateApply,
    findNodeGroupById,
    findSystemTemplateById,
    hasOwn,
    missingIds,
    persistSystemTemplateStore,
    safeDecodePathSegment,
    sortByUpdatedAt,
    systemTemplateReleaseStore,
    systemTemplateStore,
    uniqueStringList,
  } = ctx;

  return async function handleSystemTemplatesRoutes({ request, reply, url }) {
    if (request.method === "GET" && url.pathname === "/api/v1/system-templates") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(systemTemplateStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system-templates") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateSystemTemplateCreate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const groupIds = hasOwn(payload, "node_group_ids") ? uniqueStringList(payload.node_group_ids) : [];
        const missingGroupIds = missingIds(groupIds, findNodeGroupById);
        if (missingGroupIds.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
          });
          return;
        }

        const template = buildSystemTemplateRecord(payload);
        systemTemplateStore.unshift(template);
        await persistSystemTemplateStore();

        jsonResponse(reply, 201, {
          system_template: template,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    const systemTemplateMatch = url.pathname.match(/^\/api\/v1\/system-templates\/([^/]+)$/);
    if (systemTemplateMatch && request.method === "GET") {
      const templateId = safeDecodePathSegment(systemTemplateMatch[1]);

      if (!templateId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid system template id",
        });
        return;
      }

      const existingTemplate = findSystemTemplateById(templateId);

      if (!existingTemplate) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system template not found",
        });
        return;
      }

      jsonResponse(reply, 200, {
        template: existingTemplate,
      });
      return;
    }

    if (systemTemplateMatch && request.method === "PATCH") {
      try {
        const templateId = safeDecodePathSegment(systemTemplateMatch[1]);

        if (!templateId) {
          jsonResponse(reply, 400, {
            error: "bad_request",
            message: "invalid system template id",
          });
          return;
        }

        const existingTemplate = findSystemTemplateById(templateId);

        if (!existingTemplate) {
          jsonResponse(reply, 404, {
            error: "not_found",
            message: "system template not found",
          });
          return;
        }

        const payload = await readJsonBody(request);
        const errors = validateSystemTemplateUpdate(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        if (hasOwn(payload, "node_group_ids")) {
          const missingGroupIds = missingIds(uniqueStringList(payload.node_group_ids), findNodeGroupById);
          if (missingGroupIds.length > 0) {
            jsonResponse(reply, 400, {
              error: "validation_failed",
              details: [`unknown node group ids: ${missingGroupIds.join(", ")}`],
            });
            return;
          }
        }

        const updatedTemplate = buildSystemTemplateRecord(payload, existingTemplate);
        const index = systemTemplateStore.findIndex((item) => item.id === templateId);
        systemTemplateStore[index] = updatedTemplate;
        await persistSystemTemplateStore();

        jsonResponse(reply, 200, {
          system_template: updatedTemplate,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }

    if (systemTemplateMatch && request.method === "DELETE") {
      const templateId = safeDecodePathSegment(systemTemplateMatch[1]);

      if (!templateId) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: "invalid system template id",
        });
        return;
      }

      const existingTemplate = findSystemTemplateById(templateId);

      if (!existingTemplate) {
        jsonResponse(reply, 404, {
          error: "not_found",
          message: "system template not found",
        });
        return;
      }

      const referencedRelease = systemTemplateReleaseStore.find((release) => release.template_id === templateId);
      if (referencedRelease) {
        jsonResponse(reply, 409, {
          error: "conflict",
          message: `system template is referenced by release ${referencedRelease.id}`,
        });
        return;
      }

      const nextTemplates = systemTemplateStore.filter((item) => item.id !== templateId);
      systemTemplateStore.length = 0;
      systemTemplateStore.push(...nextTemplates);
      await persistSystemTemplateStore();

      jsonResponse(reply, 200, {
        ok: true,
        deleted_system_template_id: templateId,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/v1/system-template-releases") {
      jsonResponse(reply, 200, {
        items: sortByUpdatedAt(systemTemplateReleaseStore),
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/v1/system-templates/apply") {
      try {
        const payload = await readJsonBody(request);
        const errors = validateSystemTemplateApply(payload);

        if (errors.length > 0) {
          jsonResponse(reply, 400, {
            error: "validation_failed",
            details: errors,
          });
          return;
        }

        const result = await executeSystemTemplateApply(payload);
        jsonResponse(reply, 201, {
          release: result.release,
          operation: result.operation,
        });
      } catch (error) {
        jsonResponse(reply, 400, {
          error: "bad_request",
          message: error instanceof Error ? error.message : "unknown error",
        });
      }
      return;
    }
  };
}
