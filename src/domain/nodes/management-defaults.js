export const DEFAULT_LOCAL_SSH_PORT = 22;
export const DEFAULT_NODE_SSH_PORT = 22;
export const DEFAULT_PROXY_SSH_PORT = 22;
export const LEGACY_DEFAULT_NODE_SSH_PORT = 19822;

export function normalizeSshPort(value, fallback = null) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
