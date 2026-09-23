import { createAccessUsersRoutes } from "./access-users.js";
import { createBootstrapTokensRoutes } from "./bootstrap-tokens.js";
import { createConfigReleasesRoutes } from "./config-releases.js";
import { createCostsRoutes } from "./costs.js";
import { createDiagnosticsRoutes } from "./diagnostics.js";
import { createNodeGroupsRoutes } from "./node-groups.js";
import { createNodesRoutes } from "./nodes.js";
import { createOperationsRoutes } from "./operations.js";
import { createPlatformRoutes } from "./platform.js";
import { createProbesRoutes } from "./probes.js";
import { createProvidersRoutes } from "./providers.js";
import { createProxyProfilesRoutes } from "./proxy-profiles.js";
import { createShellRoutes } from "./shell.js";
import { createSystemTemplatesRoutes } from "./system-templates.js";
import { createSystemUsersRoutes } from "./system-users.js";
import { createTasksRoutes } from "./tasks.js";

// 每个业务命名空间一个文件，返回单个 handler；handler 内部逐字沿用搬迁前的路由块，
// 命中即写出响应并 return，由 server.js 依据 reply 是否已开始输出来决定是否继续派发。
// 顺序 = 各命名空间首个路由块搬迁前在 server.js 中的出现顺序；命名空间内部保持原顺序。
// 鉴权门、/healthz、/bootstrap.sh、/bootstrap/enroll.sh、/sub/:token、产物下载、
// 静态资源与最终 404 仍在 server.js 内，先于本表执行。
export function createApiRoutes(ctx) {
  return [
    createPlatformRoutes(ctx),
    createNodesRoutes(ctx),
    createTasksRoutes(ctx),
    createProbesRoutes(ctx),
    createDiagnosticsRoutes(ctx),
    createBootstrapTokensRoutes(ctx),
    createAccessUsersRoutes(ctx),
    createSystemTemplatesRoutes(ctx),
    createSystemUsersRoutes(ctx),
    createProxyProfilesRoutes(ctx),
    createNodeGroupsRoutes(ctx),
    createProvidersRoutes(ctx),
    createCostsRoutes(ctx),
    createConfigReleasesRoutes(ctx),
    createOperationsRoutes(ctx),
    createShellRoutes(ctx),
  ];
}
