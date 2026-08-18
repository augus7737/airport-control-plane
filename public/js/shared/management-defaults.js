export const DEFAULT_NODE_SSH_PORT = 22;
export const DEFAULT_PROXY_SSH_PORT = 22;

export function normalizeSshPort(value, fallback = null) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}
