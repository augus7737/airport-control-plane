import { getAccessMode, getNodeDisplayName } from "./node-formatters.js";
import {
  formatLocationDisplay,
  getLocationCode,
  getLocationCountry,
  normalizeLocationValue,
} from "./location-suggestions.js";

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
  const normalizedValue = normalizeLocationValue(value, { scope: "region" });
  if (!normalizedValue) {
    return { country: "未识别", code: "--" };
  }
  return {
    country: getLocationCountry(normalizedValue, { scope: "region" }),
    code: getLocationCode(normalizedValue, { scope: "region" }),
  };
}

export function getEntryLabel(node) {
  return normalizeLocationValue(node?.networking?.entry_region, { scope: "entry" }) || "中国大陆";
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
  const entryLabel = formatLocationDisplay(networking.entry_region || "中国大陆", {
    scope: "entry",
    style: "name",
  });
  if (networking.access_mode === "relay") {
    const relayName = getRelayDisplayName(node, nodes);
    const relayRegion = networking.relay_region
      ? ` (${formatLocationDisplay(networking.relay_region, { scope: "region", style: "compact" })})`
      : "";
    return `${entryLabel} -> ${relayName}${relayRegion} -> ${getNodeDisplayName(node)}`;
  }

  return `${entryLabel} -> ${getNodeDisplayName(node)}`;
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
        relayRegion:
          formatLocationDisplay(node.networking?.relay_region || relayNode?.labels?.region, {
            scope: "region",
            style: "compact",
          }) || "-",
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
    const normalizedRegion = normalizeLocationValue(node.labels?.region, { scope: "region" });
    if (normalizedRegion) {
      existing.regions.add(normalizedRegion);
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
