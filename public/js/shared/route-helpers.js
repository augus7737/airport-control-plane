import { getAccessMode, getNodeDisplayName } from "./node-formatters.js";

export const locationCatalog = {
  HKG: { country: "中国香港", code: "HK" },
  HK: { country: "中国香港", code: "HK" },
  NRT: { country: "日本", code: "JP" },
  TYO: { country: "日本", code: "JP" },
  TOK: { country: "日本", code: "JP" },
  OSA: { country: "日本", code: "JP" },
  SIN: { country: "新加坡", code: "SG" },
  LAX: { country: "美国", code: "US" },
  SJC: { country: "美国", code: "US" },
  SEA: { country: "美国", code: "US" },
  NBG: { country: "德国", code: "DE" },
  FRA: { country: "德国", code: "DE" },
  HEL: { country: "芬兰", code: "FI" },
  ICN: { country: "韩国", code: "KR" },
  SEL: { country: "韩国", code: "KR" },
  TPE: { country: "中国台湾", code: "TW" },
  LON: { country: "英国", code: "UK" },
  AMS: { country: "荷兰", code: "NL" },
  PAR: { country: "法国", code: "FR" },
  SYD: { country: "澳大利亚", code: "AU" },
  "中国大陆": { country: "中国大陆", code: "CN" },
  中国: { country: "中国大陆", code: "CN" },
  香港: { country: "中国香港", code: "HK" },
  "中国香港": { country: "中国香港", code: "HK" },
  日本: { country: "日本", code: "JP" },
  新加坡: { country: "新加坡", code: "SG" },
  美国: { country: "美国", code: "US" },
  德国: { country: "德国", code: "DE" },
  芬兰: { country: "芬兰", code: "FI" },
  韩国: { country: "韩国", code: "KR" },
  英国: { country: "英国", code: "UK" },
  荷兰: { country: "荷兰", code: "NL" },
  法国: { country: "法国", code: "FR" },
  澳大利亚: { country: "澳大利亚", code: "AU" },
};

export function resolveRelayNode(node, nodes = []) {
  const relayId = node?.networking?.relay_node_id;
  if (!relayId) {
    return null;
  }

  return nodes.find((item) => item.id === relayId) || null;
}

export function getRelayDisplayName(node, nodes = []) {
  const relayNode = resolveRelayNode(node, nodes);
  if (relayNode) {
    return getNodeDisplayName(relayNode);
  }

  return node?.networking?.relay_label || node?.networking?.relay_node_id || "未指定中转机";
}

export function getLocationProfile(value) {
  if (!value) {
    return { country: "未识别", code: "--" };
  }

  const raw = String(value).trim();
  const upper = raw.toUpperCase();

  if (locationCatalog[raw]) {
    return locationCatalog[raw];
  }

  if (locationCatalog[upper]) {
    return locationCatalog[upper];
  }

  if (raw.includes("香港")) {
    return locationCatalog["中国香港"];
  }

  if (raw.includes("中国")) {
    return locationCatalog["中国大陆"];
  }

  if (raw.includes("日本")) {
    return locationCatalog["日本"];
  }

  if (raw.includes("新加坡")) {
    return locationCatalog["新加坡"];
  }

  if (raw.includes("美国")) {
    return locationCatalog["美国"];
  }

  return {
    country: raw,
    code: raw.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || raw.slice(0, 2),
  };
}

export function getEntryLabel(node) {
  return node?.networking?.entry_region || "中国大陆";
}

export function getNodeCountry(node) {
  return getLocationProfile(node?.labels?.country || node?.labels?.region).country;
}

export function getNodeCountryCode(node) {
  return getLocationProfile(node?.labels?.country || node?.labels?.region).code;
}

export function getCountryCode(country) {
  return getLocationProfile(country).code;
}

export function formatRouteSummary(node, nodes = []) {
  const networking = node?.networking || {};
  if (networking.access_mode === "relay") {
    const relayName = getRelayDisplayName(node, nodes);
    const relayRegion = networking.relay_region ? ` (${networking.relay_region})` : "";
    return `${networking.entry_region || "中国大陆"} -> ${relayName}${relayRegion} -> ${getNodeDisplayName(node)}`;
  }

  return `${networking.entry_region || "中国大陆"} -> ${getNodeDisplayName(node)}`;
}

export function buildRelayGroups(nodes = []) {
  const relayGroups = [];
  const relayMap = new Map();

  for (const node of nodes.filter((item) => getAccessMode(item) === "relay")) {
    const relayKey =
      node.networking?.relay_node_id ||
      node.networking?.relay_label ||
      `unassigned:${node.id}`;

    if (!relayMap.has(relayKey)) {
      const relayNode = resolveRelayNode(node, nodes);
      const group = {
        key: relayKey,
        relayNode,
        relayLabel: relayNode ? getNodeDisplayName(relayNode) : getRelayDisplayName(node, nodes),
        relayRegion: node.networking?.relay_region || relayNode?.labels?.region || "-",
        entryRegion: getEntryLabel(node),
        members: [],
      };
      relayMap.set(relayKey, group);
      relayGroups.push(group);
    }

    relayMap.get(relayKey).members.push(node);
  }

  relayGroups.sort((left, right) => right.members.length - left.members.length);
  return relayGroups;
}

export function getCountryStats(nodes = []) {
  const stats = new Map();

  for (const node of nodes) {
    const country = getNodeCountry(node);
    const existing = stats.get(country) || {
      country,
      code: getNodeCountryCode(node),
      total: 0,
      direct: 0,
      relay: 0,
      providers: new Set(),
      regions: new Set(),
    };

    existing.total += 1;
    if (getAccessMode(node) === "relay") {
      existing.relay += 1;
    } else {
      existing.direct += 1;
    }
    if (node.labels?.provider) {
      existing.providers.add(node.labels.provider);
    }
    if (node.labels?.region) {
      existing.regions.add(node.labels.region);
    }

    stats.set(country, existing);
  }

  return [...stats.values()]
    .map((item) => ({
      ...item,
      providers: item.providers.size,
      regions: item.regions.size,
    }))
    .sort((left, right) => right.total - left.total || left.country.localeCompare(right.country));
}

export function calculateLanePositions(items = [], x) {
  if (items.length === 0) {
    return [];
  }

  if (items.length === 1) {
    return [{ ...items[0], x, y: 50 }];
  }

  const top = 18;
  const bottom = 82;
  const step = (bottom - top) / (items.length - 1);

  return items.map((item, index) => ({
    ...item,
    x,
    y: Number((top + step * index).toFixed(2)),
  }));
}

export function buildCurvePath(start, end) {
  const c1x = start.x + (end.x - start.x) * 0.34;
  const c2x = start.x + (end.x - start.x) * 0.66;
  return `M ${start.x} ${start.y} C ${c1x} ${start.y}, ${c2x} ${end.y}, ${end.x} ${end.y}`;
}

export function buildRouteGraph(nodes = []) {
  const relayGroups = buildRelayGroups(nodes);
  const directNodes = nodes.filter((node) => getAccessMode(node) !== "relay");
  const entryMap = new Map();
  const relayMap = new Map();
  const countryMap = new Map();
  const lines = [];

  for (const group of relayGroups) {
    const entryKey = `entry:${group.entryRegion}`;
    const relayKey = `relay:${group.key}`;

    const entryNode = entryMap.get(entryKey) || {
      key: entryKey,
      label: group.entryRegion,
      code: getLocationProfile(group.entryRegion).code,
      count: 0,
      type: "entry",
    };
    entryNode.count += group.members.length;
    entryMap.set(entryKey, entryNode);

    const relayNode = relayMap.get(relayKey) || {
      key: relayKey,
      label: group.relayLabel,
      code: getLocationProfile(group.relayRegion).code,
      count: 0,
      type: "relay",
      meta: group.relayRegion || "未标记区域",
    };
    relayNode.count += group.members.length;
    relayMap.set(relayKey, relayNode);

    lines.push({
      from: entryKey,
      to: relayKey,
      weight: group.members.length,
      type: "relay",
    });

    const destinationMap = new Map();
    for (const member of group.members) {
      const country = getNodeCountry(member);
      destinationMap.set(country, (destinationMap.get(country) || 0) + 1);
    }

    for (const [country, weight] of destinationMap) {
      const countryKey = `country:${country}`;
      const countryNode = countryMap.get(countryKey) || {
        key: countryKey,
        label: country,
        code: getCountryCode(country),
        count: 0,
        direct: 0,
        relay: 0,
        type: "country",
      };
      countryNode.count += weight;
      countryNode.relay += weight;
      countryMap.set(countryKey, countryNode);

      lines.push({
        from: relayKey,
        to: countryKey,
        weight,
        type: "relay",
      });
    }
  }

  const directMap = new Map();
  for (const node of directNodes) {
    const entry = getEntryLabel(node);
    const country = getNodeCountry(node);
    const linkKey = `${entry}::${country}`;
    directMap.set(linkKey, (directMap.get(linkKey) || 0) + 1);

    const entryKey = `entry:${entry}`;
    const entryNode = entryMap.get(entryKey) || {
      key: entryKey,
      label: entry,
      code: getLocationProfile(entry).code,
      count: 0,
      type: "entry",
    };
    entryNode.count += 1;
    entryMap.set(entryKey, entryNode);

    const countryKey = `country:${country}`;
    const countryNode = countryMap.get(countryKey) || {
      key: countryKey,
      label: country,
      code: getCountryCode(country),
      count: 0,
      direct: 0,
      relay: 0,
      type: "country",
    };
    countryNode.count += 1;
    countryNode.direct += 1;
    countryMap.set(countryKey, countryNode);
  }

  for (const [linkKey, weight] of directMap) {
    const [entry, country] = linkKey.split("::");
    lines.push({
      from: `entry:${entry}`,
      to: `country:${country}`,
      weight,
      type: "direct",
    });
  }

  const entryNodes = calculateLanePositions(
    [...entryMap.values()].sort((left, right) => right.count - left.count),
    14,
  );
  const relayNodes = calculateLanePositions(
    [...relayMap.values()].sort((left, right) => right.count - left.count),
    49,
  );
  const countryNodes = calculateLanePositions(
    [...countryMap.values()].sort((left, right) => right.count - left.count),
    84,
  );

  const nodeIndex = new Map(
    [...entryNodes, ...relayNodes, ...countryNodes].map((item) => [item.key, item]),
  );

  return {
    entryNodes,
    relayNodes,
    countryNodes,
    lines,
    nodeIndex,
  };
}
