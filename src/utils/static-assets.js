import path from "node:path";

const PAGE_ALIASES = new Map([
  ["/", "/index.html"],
  ["/login", "/login.html"],
  ["/nodes", "/nodes.html"],
  ["/node", "/node.html"],
  ["/shell", "/shell.html"],
  ["/tasks", "/tasks.html"],
  ["/terminal", "/terminal.html"],
  ["/tokens", "/tokens.html"],
  ["/providers", "/providers.html"],
  ["/routes", "/routes.html"],
  ["/access-users", "/access-users.html"],
  ["/system-users", "/system-users.html"],
  ["/system-templates", "/system-templates.html"],
  ["/proxy-profiles", "/proxy-profiles.html"],
  ["/releases", "/releases.html"],
  ["/bootstrap", "/tokens.html"],
  ["/bootstrap.html", "/tokens.html"],
  ["/metrics", "/index.html"],
  ["/metrics.html", "/index.html"],
  ["/topology", "/routes.html"],
  ["/topology.html", "/routes.html"],
  ["/settings", "/providers.html"],
  ["/settings.html", "/providers.html"],
]);

export async function serveStaticFile(reply, filePath, contentType, deps = {}) {
  const readFileImpl = deps.readFile;
  const textResponseImpl = deps.textResponse;

  try {
    const file = await readFileImpl(filePath, "utf8");
    textResponseImpl(reply, 200, contentType, file);
    return true;
  } catch {
    return false;
  }
}

export function contentTypeForPath(filePath) {
  if (filePath.endsWith(".html")) return "text/html";
  if (filePath.endsWith(".css")) return "text/css";
  if (filePath.endsWith(".js")) return "application/javascript";
  if (filePath.endsWith(".json")) return "application/json";
  return "text/plain";
}

export function resolvePublicAssetPathname(pathname) {
  if (PAGE_ALIASES.has(pathname)) {
    return PAGE_ALIASES.get(pathname);
  }

  return pathname;
}

export function isHtmlPagePathname(pathname) {
  return resolvePublicAssetPathname(pathname).endsWith(".html");
}

export async function servePublicAsset(reply, pathname, deps = {}) {
  const publicDir = deps.publicDir;
  const statImpl = deps.stat;
  const cleanPath = resolvePublicAssetPathname(pathname);
  const assetPath = path.normalize(path.join(publicDir, cleanPath));

  if (!assetPath.startsWith(publicDir)) {
    return false;
  }

  try {
    const info = await statImpl(assetPath);
    if (!info.isFile()) {
      return false;
    }

    return await serveStaticFile(reply, assetPath, contentTypeForPath(assetPath), deps);
  } catch {
    return false;
  }
}
