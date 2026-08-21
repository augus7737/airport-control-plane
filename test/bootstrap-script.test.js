import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const bootstrapPath = path.resolve("scripts/bootstrap.sh");

async function readBootstrapScript() {
  return readFile(bootstrapPath, "utf8");
}

function functionBody(script, name) {
  const startToken = new RegExp(`^${name}\\(\\) \\{\\r?$`, "m");
  const startMatch = script.match(startToken);
  const start = startMatch?.index ?? -1;
  assert.notEqual(start, -1, `missing ${name}`);

  const bodyStart = start + startMatch[0].length;
  const endMatch = script.slice(bodyStart).match(/^\}\r?$/m);
  assert.ok(endMatch, `unterminated ${name}`);
  return script.slice(bodyStart, bodyStart + endMatch.index);
}

test("bootstrap default ssh setup does not harden existing login policy", async () => {
  const script = await readBootstrapScript();
  const readyBody = functionBody(script, "ensure_ssh_server_ready");

  assert.match(readyBody, /\[ "\$HARDEN_SSH" = true \]/);
  assert.match(readyBody, /harden_ssh_server_config/);
  assert.doesNotMatch(readyBody, /ensure_sshd_config_line .*PermitRootLogin/);
  assert.doesNotMatch(readyBody, /ensure_sshd_config_line .*PasswordAuthentication/);
  assert.doesNotMatch(readyBody, /^[ \t]*write_sshd_dropin_config\b/m);
});

test("ssh hardening is opt-in and guarded by backup plus sshd validation", async () => {
  const script = await readBootstrapScript();
  const hardenBody = functionBody(script, "harden_ssh_server_config");

  assert.match(script, /--harden-ssh\)/);
  assert.match(script, /HARDEN_SSH=true/);

  assert.match(hardenBody, /if ! MAIN_BACKUP="\$\(backup_file_if_present "\$MAIN_CONFIG"\)"; then/);
  assert.match(hardenBody, /if ! DROPIN_BACKUP="\$\(backup_file_if_present "\$DROPIN_FILE"\)"; then/);
  assert.match(hardenBody, /if ! validate_sshd_config; then/);
  assert.match(hardenBody, /PasswordAuthentication no/);
  assert.match(hardenBody, /PermitRootLogin prohibit-password/);
  assert.match(hardenBody, /restore_file_from_backup "\$MAIN_CONFIG" "\$MAIN_BACKUP"/);
  assert.match(hardenBody, /restore_file_from_backup "\$DROPIN_FILE" "\$DROPIN_BACKUP"/);
});
