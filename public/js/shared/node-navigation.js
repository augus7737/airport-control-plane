export function createNodeNavigationModule(dependencies = {}) {
  const { windowRef = window } = dependencies;

  function getCurrentNode(nodes) {
    const params = new URLSearchParams(windowRef.location.search);
    const id = params.get("id") || params.get("node_id");
    return nodes.find((item) => item.id === id) || nodes[0];
  }

  function nodeDetailHref(nodeId) {
    return `/node.html?id=${encodeURIComponent(nodeId)}`;
  }

  function nodeShellHref(nodeId, options = {}) {
    const url = new URL("/shell.html", windowRef.location.origin);
    url.searchParams.set("node_id", nodeId);
    if (options.autoOpen !== false) {
      url.searchParams.set("auto_open_shell", "1");
    }
    return `${url.pathname}${url.search}`;
  }

  return {
    getCurrentNode,
    nodeDetailHref,
    nodeShellHref,
  };
}
