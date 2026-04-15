function normalizeString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function ensureScriptEnvelope(scriptBody) {
  const normalized = normalizeString(scriptBody);
  if (!normalized) {
    return `#!/bin/sh
set -eu

echo "[system-template] noop=true"
`;
  }

  if (normalized.startsWith("#!")) {
    return `${normalized}\n`;
  }

  return `#!/bin/sh
set -eu

${normalized}
`;
}

export function buildSystemTemplateApplyScript({ release, template }) {
  const script = ensureScriptEnvelope(template?.script_body);

  return `${script}
echo "[system-template] template_id=${String(template?.id || "")}"
echo "[system-template] template_name=${String(template?.name || "")}"
echo "[system-template] release_id=${String(release?.id || "")}"
`;
}
