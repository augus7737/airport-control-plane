export function createNodeFactsDomain(dependencies = {}) {
  const {
    normalizeNullableString,
    normalizeIpLiteral,
    isIP,
    isPublicIpv4,
    isPublicIpv6,
    store,
    index,
  } = dependencies;

  function buildPublicIpMeta(facts, existingFacts, familyKey, ipValue) {
    const sourceKey = `${familyKey}_source`;
    const locationKey = `${familyKey}_location`;
    const ownerKey = `${familyKey}_owner`;
    const previousIp = normalizeIpLiteral(existingFacts?.[familyKey]);
    const sameAddress = previousIp && ipValue && previousIp === ipValue;

    return {
      [sourceKey]: ipValue
        ? normalizeNullableString(facts?.[sourceKey]) ??
          (sameAddress ? normalizeNullableString(existingFacts?.[sourceKey]) : null)
        : null,
      [locationKey]: ipValue
        ? normalizeNullableString(facts?.[locationKey]) ??
          (sameAddress ? normalizeNullableString(existingFacts?.[locationKey]) : null)
        : null,
      [ownerKey]: ipValue
        ? normalizeNullableString(facts?.[ownerKey]) ??
          (sameAddress ? normalizeNullableString(existingFacts?.[ownerKey]) : null)
        : null,
    };
  }

  function normalizeMachineId(value) {
    const normalized = normalizeNullableString(value)?.toLowerCase().replace(/[^0-9a-f]/g, "") ?? null;
    return normalized || null;
  }

  function normalizeMacAddress(value) {
    const normalized = normalizeNullableString(value)?.toLowerCase().replace(/-/g, ":") ?? null;
    if (!normalized) {
      return null;
    }

    return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(normalized) ? normalized : null;
  }

  function normalizeNodeFacts(factsInput, options = {}) {
    const facts = factsInput && typeof factsInput === "object" ? factsInput : {};
    const existingFacts = options.existingFacts && typeof options.existingFacts === "object"
      ? options.existingFacts
      : null;

    let publicIpv4 = normalizeIpLiteral(facts.public_ipv4);
    let publicIpv6 = normalizeIpLiteral(facts.public_ipv6);
    let privateIpv4 = normalizeIpLiteral(facts.private_ipv4);

    if (publicIpv4 && !isPublicIpv4(publicIpv4)) {
      if (!privateIpv4 && isIP(publicIpv4) === 4) {
        privateIpv4 = publicIpv4;
      }
      publicIpv4 = null;
    }

    if (publicIpv6 && !isPublicIpv6(publicIpv6)) {
      publicIpv6 = null;
    }

    const remoteAddress = normalizeIpLiteral(options.remoteAddress);
    if (!publicIpv4 && !publicIpv6 && remoteAddress) {
      if (isPublicIpv4(remoteAddress)) {
        publicIpv4 = remoteAddress;
        if (!facts.public_ipv4_source) {
          facts.public_ipv4_source = "request-peer";
        }
      } else if (isPublicIpv6(remoteAddress)) {
        publicIpv6 = remoteAddress;
        if (!facts.public_ipv6_source) {
          facts.public_ipv6_source = "request-peer";
        }
      } else if (!privateIpv4 && isIP(remoteAddress) === 4) {
        privateIpv4 = remoteAddress;
      }
    }

    return {
      hostname: normalizeNullableString(facts.hostname),
      os_name: normalizeNullableString(facts.os_name),
      os_version: normalizeNullableString(facts.os_version),
      arch: normalizeNullableString(facts.arch),
      kernel_version: normalizeNullableString(facts.kernel_version),
      public_ipv4: publicIpv4,
      public_ipv6: publicIpv6,
      private_ipv4: privateIpv4,
      ...buildPublicIpMeta(facts, existingFacts, "public_ipv4", publicIpv4),
      ...buildPublicIpMeta(facts, existingFacts, "public_ipv6", publicIpv6),
      machine_id:
        normalizeMachineId(facts.machine_id) ?? normalizeMachineId(existingFacts?.machine_id),
      primary_mac:
        normalizeMacAddress(facts.primary_mac) ?? normalizeMacAddress(existingFacts?.primary_mac),
      cpu_cores: facts.cpu_cores ?? null,
      memory_mb: facts.memory_mb ?? null,
      disk_gb: facts.disk_gb ?? null,
      ssh_port: facts.ssh_port ?? 22,
    };
  }

  function normalizeFactNumberToken(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : null;
  }

  function buildLegacyRegistrationSignature(factsInput) {
    const facts = factsInput && typeof factsInput === "object" ? factsInput : {};
    const hostname = normalizeNullableString(facts.hostname)?.toLowerCase() ?? null;
    if (!hostname) {
      return null;
    }

    return [
      hostname,
      normalizeNullableString(facts.arch)?.toLowerCase() ?? "-",
      normalizeNullableString(facts.kernel_version)?.toLowerCase() ?? "-",
      normalizeFactNumberToken(facts.cpu_cores) ?? "-",
      normalizeFactNumberToken(facts.memory_mb) ?? "-",
      normalizeFactNumberToken(facts.disk_gb) ?? "-",
    ].join("|");
  }

  function registrationAddressMatch(nodeFactsInput, incomingFactsInput) {
    const nodeFacts = nodeFactsInput && typeof nodeFactsInput === "object" ? nodeFactsInput : {};
    const incomingFacts =
      incomingFactsInput && typeof incomingFactsInput === "object" ? incomingFactsInput : {};

    for (const field of ["public_ipv4", "public_ipv6", "private_ipv4"]) {
      const incomingValue = normalizeNullableString(incomingFacts[field]);
      const nodeValue = normalizeNullableString(nodeFacts[field]);
      if (incomingValue && nodeValue && incomingValue === nodeValue) {
        return true;
      }
    }

    return false;
  }

  function registrationHostnameMatch(nodeFactsInput, incomingFactsInput) {
    const nodeHostname = normalizeNullableString(nodeFactsInput?.hostname)?.toLowerCase() ?? null;
    const incomingHostname = normalizeNullableString(incomingFactsInput?.hostname)?.toLowerCase() ?? null;

    if (!nodeHostname || !incomingHostname) {
      return false;
    }

    return nodeHostname === incomingHostname;
  }

  function getNodeActivityTimestamp(node) {
    const value = Date.parse(node?.last_seen_at || node?.registered_at || "");
    return Number.isFinite(value) ? value : 0;
  }

  function findExistingBootstrapNode(payload) {
    const exactNodeId = index.get(payload.fingerprint);
    const exactNode = exactNodeId ? store.get(exactNodeId) : null;
    if (exactNode) {
      return exactNode;
    }

    const incomingFacts = payload?.facts && typeof payload.facts === "object" ? payload.facts : {};
    const bootstrapNodes = [...store.values()].filter((node) => node?.source === "bootstrap");
    const incomingMachineId = normalizeMachineId(incomingFacts.machine_id);
    if (incomingMachineId) {
      const machineIdMatches = bootstrapNodes.filter(
        (node) => normalizeMachineId(node?.facts?.machine_id) === incomingMachineId,
      );
      if (machineIdMatches.length === 1) {
        return machineIdMatches[0];
      }
    }

    const incomingPrimaryMac = normalizeMacAddress(incomingFacts.primary_mac);
    if (incomingPrimaryMac) {
      const macMatches = bootstrapNodes.filter(
        (node) => normalizeMacAddress(node?.facts?.primary_mac) === incomingPrimaryMac,
      );
      if (macMatches.length === 1) {
        return macMatches[0];
      }
    }

    const exactAddressMatches = bootstrapNodes.filter(
      (node) =>
        registrationHostnameMatch(node?.facts, incomingFacts) &&
        registrationAddressMatch(node?.facts, incomingFacts),
    );
    if (exactAddressMatches.length === 1) {
      return exactAddressMatches[0];
    }

    const legacySignature = buildLegacyRegistrationSignature(incomingFacts);
    if (!legacySignature) {
      return null;
    }

    const signatureMatches = bootstrapNodes.filter(
      (node) => buildLegacyRegistrationSignature(node?.facts) === legacySignature,
    );
    if (signatureMatches.length === 1) {
      return signatureMatches[0];
    }

    const signatureAddressMatches = signatureMatches.filter((node) =>
      registrationAddressMatch(node?.facts, incomingFacts),
    );
    if (signatureAddressMatches.length === 1) {
      return signatureAddressMatches[0];
    }

    if (signatureMatches.length > 1) {
      return [...signatureMatches].sort((left, right) => {
        return getNodeActivityTimestamp(right) - getNodeActivityTimestamp(left);
      })[0];
    }

    return null;
  }

  return {
    buildPublicIpMeta,
    normalizeNodeFacts,
    normalizeMachineId,
    normalizeMacAddress,
    normalizeFactNumberToken,
    buildLegacyRegistrationSignature,
    registrationAddressMatch,
    registrationHostnameMatch,
    getNodeActivityTimestamp,
    findExistingBootstrapNode,
  };
}
