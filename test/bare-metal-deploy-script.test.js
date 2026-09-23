import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const scriptPath = path.resolve("scripts/deploy-bare-metal.sh");
const docsPath = path.resolve("docs/deployment-bare-metal.md");

async function readScript() {
  return readFile(scriptPath, "utf8");
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

// start_pre 的闭括号顶格，functionBody 会在它之前截断，因此这里取到文件末尾。
function functionTail(script, name) {
  const start = script.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing ${name}`);
  return script.slice(start);
}

function heredocBody(script, marker) {
  const start = script.indexOf(`<<${marker}`);
  assert.notEqual(start, -1, `missing heredoc ${marker}`);
  const bodyStart = script.indexOf("\n", start) + 1;
  const end = script.indexOf(`\n${marker}`, bodyStart);
  assert.notEqual(end, -1, `unterminated heredoc ${marker}`);
  return script.slice(bodyStart, end);
}

function sectionBody(unit, sectionName) {
  const match = unit.match(new RegExp(`\\[${sectionName}\\]\\n([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`));
  assert.ok(match, `missing [${sectionName}]`);
  return match[1];
}

test("bare metal deploy script is container-free and supports install/update", async () => {
  const script = await readScript();

  assert.match(script, /^APP_USER="airport"$/m);
  assert.match(script, /^APP_DIR="\/opt\/airport-control-plane"$/m);
  assert.match(script, /^ENV_FILE="\$\{ENV_DIR\}\/airport\.env"$/m);
  assert.match(script, /install\|update\)/);
  assert.doesNotMatch(script, /^\s*(docker|docker-compose)\b/m);
  assert.doesNotMatch(script, /\bcompose\.production\.yml\b/);
});

test("os detection covers ubuntu/debian/alpine and refuses unknown systems", async () => {
  const script = await readScript();
  const detectBody = functionBody(script, "detect_os");

  assert.match(detectBody, /PKG_MANAGER="apt"/);
  assert.match(detectBody, /PKG_MANAGER="apk"/);
  assert.match(detectBody, /\*" alpine "\*\)/);
  assert.match(detectBody, /不支持的系统/);
  assert.match(detectBody, /x86_64\|amd64\|aarch64\|arm64\)/);
  assert.match(detectBody, /不支持的架构/);
});

test("init detection picks systemd or openrc and targets the matching service file", async () => {
  const script = await readScript();
  const detectBody = functionBody(script, "detect_init_system");

  assert.match(detectBody, /INIT_SYSTEM="systemd"/);
  assert.match(detectBody, /SERVICE_FILE="\/etc\/systemd\/system\/\$\{SERVICE_NAME\}\.service"/);
  assert.match(detectBody, /INIT_SYSTEM="openrc"/);
  assert.match(detectBody, /SERVICE_FILE="\/etc\/init\.d\/\$\{SERVICE_NAME\}"/);
  assert.match(detectBody, /未检测到可用的 systemd 或 OpenRC/);
});

test("package and node runtime installation branch per package manager", async () => {
  const script = await readScript();
  const pkgBody = functionBody(script, "pkg_install");
  const runtimeBody = functionBody(script, "ensure_node_runtime");
  const baseBody = functionBody(script, "ensure_base_packages");

  assert.match(pkgBody, /apt-get install -y --no-install-recommends/);
  assert.match(pkgBody, /apk add --no-cache/);
  assert.match(runtimeBody, /install_node_via_nodesource ;;\n\s*apk\) install_node_via_apk/);
  assert.match(functionBody(script, "install_node_via_nodesource"), /deb\.nodesource\.com\/node_%s\.x nodistro/);
  assert.match(functionBody(script, "install_node_via_apk"), /apk add --no-cache nodejs npm/);
  assert.match(baseBody, /NODE_BIN="\$\(command -v node\)"/);
});

test("app user creation branches because busybox has no useradd or getent", async () => {
  const script = await readScript();
  const userBody = functionBody(script, "ensure_app_user");

  assert.match(userBody, /groupadd --system "\$APP_GROUP"/);
  assert.match(userBody, /useradd --system --gid "\$APP_GROUP"/);
  assert.match(userBody, /addgroup -S "\$APP_GROUP"/);
  assert.match(userBody, /adduser -S -D -h "\$APP_DIR" -G "\$APP_GROUP" -s \/sbin\/nologin "\$APP_USER"/);
  assert.match(functionBody(script, "run_as_app_user"), /su -s \/bin\/sh "\$APP_USER"/);
});

test("script bootstraps bash so a bare alpine host can start it with sh", async () => {
  const script = await readScript();
  const preludeEnd = script.indexOf("set -Eeuo pipefail");

  assert.ok(preludeEnd > 0);
  const prelude = script.slice(0, preludeEnd);
  assert.match(prelude, /^#!\/bin\/sh$/m);
  assert.match(prelude, /if \[ -z "\$\{BASH_VERSION:-\}" \]; then/);
  assert.match(prelude, /apk add --no-cache bash/);
  assert.match(prelude, /apt-get install -y --no-install-recommends bash/);
  assert.match(prelude, /exec bash "\$0" "\$@"/);
});

test("cleanup never removes the caller's source tree", async () => {
  const script = await readScript();
  const cleanupBody = functionBody(script, "cleanup");

  assert.match(cleanupBody, /rm -rf "\$FETCHED_DIR"/);
  assert.doesNotMatch(cleanupBody, /rm -rf "\$SOURCE_DIR"/);
  assert.match(functionBody(script, "ensure_source_tree"), /SOURCE_DIR="\$FETCHED_DIR"/);
});

test("service control is abstracted so systemd and OpenRC share one flow", async () => {
  const script = await readScript();
  const restartBody = functionBody(script, "svc_restart");
  const enableBody = functionBody(script, "svc_enable");
  const runningBody = functionBody(script, "svc_is_running");

  assert.match(restartBody, /systemctl restart "\$\{SERVICE_NAME\}\.service"/);
  assert.match(restartBody, /rc-service "\$SERVICE_NAME" restart/);
  assert.match(enableBody, /systemctl enable "\$\{SERVICE_NAME\}\.service"/);
  assert.match(enableBody, /rc-update add "\$SERVICE_NAME" default/);
  assert.match(runningBody, /systemctl is-active --quiet/);
  assert.match(runningBody, /kill -0 "\$\(cat "\$SERVICE_PID_FILE"\)"/);

  for (const name of ["deploy", "wait_for_health", "rollback_activation", "restart_and_verify"]) {
    const body = functionBody(script, name);
    assert.doesNotMatch(body, /^\s*systemctl\b/m, `${name} must not call systemctl directly`);
  }
});

test("generated systemd unit keeps start limits and required hardening", async () => {
  const script = await readScript();
  const unit = heredocBody(functionBody(script, "write_systemd_unit"), "EOF");
  const unitSection = sectionBody(unit, "Unit");
  const serviceSection = sectionBody(unit, "Service");

  assert.match(unitSection, /^StartLimitIntervalSec=60$/m);
  assert.match(unitSection, /^StartLimitBurst=5$/m);
  assert.doesNotMatch(serviceSection, /^StartLimitIntervalSec=/m);
  assert.doesNotMatch(serviceSection, /^StartLimitBurst=/m);

  assert.match(serviceSection, /^User=\$\{APP_USER\}$/m);
  assert.match(serviceSection, /^Group=\$\{APP_GROUP\}$/m);
  assert.match(serviceSection, /^WorkingDirectory=\$\{APP_DIR\}$/m);
  assert.match(serviceSection, /^EnvironmentFile=\$\{ENV_FILE\}$/m);
  assert.match(serviceSection, /^ExecStart=\$\{NODE_BIN\} src\/server\.js$/m);
  assert.match(serviceSection, /^MemoryMax=\$\{MEMORY_MAX\}$/m);
  assert.match(serviceSection, /^NoNewPrivileges=true$/m);
  assert.match(serviceSection, /^ProtectSystem=strict$/m);
  assert.match(serviceSection, /^ReadWritePaths=\$\{DATA_DIR\}$/m);
});

test("openrc init script runs the same command as a daemon and exports the env file", async () => {
  const script = await readScript();
  const initd = heredocBody(functionTail(script, "write_openrc_init_script"), "EOF");

  assert.match(initd, /^#!\/sbin\/openrc-run$/m);
  assert.match(initd, /^command="\$\{NODE_BIN\}"$/m);
  assert.match(initd, /^command_args="src\/server\.js"$/m);
  assert.match(initd, /^directory="\$\{APP_DIR\}"$/m);
  assert.match(initd, /^command_user="\$\{APP_USER\}:\$\{APP_GROUP\}"$/m);
  assert.match(initd, /^command_background="yes"$/m);
  assert.match(initd, /^output_log="\$\{LOG_FILE\}"$/m);
  assert.match(initd, /export "\\\$airport_key=\\\$airport_value"$/m);
  // OpenRC 的 init 脚本必须逐行导出，而不是 source 环境文件；后者会让含空格的值被当成命令。
  assert.doesNotMatch(initd, /^\s*\.\s+"\$\{ENV_FILE\}"/m);
});

test("candidate uses low-memory verification by default and full tests are opt-in", async () => {
  const script = await readScript();
  const deployBody = functionBody(script, "deploy");
  const installIndex = deployBody.indexOf("install_candidate_dependencies");
  const verifyIndex = deployBody.indexOf("verify_candidate");
  const rollbackIndex = deployBody.indexOf("enable_deploy_rollback");
  const restartIndex = deployBody.indexOf("restart_and_verify");

  assert.ok(installIndex > -1, "missing dependency install step");
  assert.ok(verifyIndex > installIndex, "verification must run after npm ci --omit=dev");
  assert.ok(rollbackIndex > verifyIndex, "rollback boundary must start after candidate verification");
  assert.ok(restartIndex > rollbackIndex, "service restart must happen inside rollback boundary");

  assert.match(functionBody(script, "install_candidate_dependencies"), /npm ci --omit=dev/);
  const verifyBody = functionBody(script, "verify_candidate");
  assert.match(verifyBody, /npm run check/);
  assert.match(verifyBody, /is_truthy "\$RUN_FULL_TESTS"/);
  assert.match(verifyBody, /npm test/);
  assert.match(script, /--full-test\)/);
  assert.match(script, /^RUN_FULL_TESTS="\$\{AIRPORT_RUN_FULL_TESTS:-false\}"$/m);
});

test("source tree falls back to a pinned github tarball so hosts need no git", async () => {
  const script = await readScript();
  const sourceBody = functionBody(script, "ensure_source_tree");
  const downloadBody = functionBody(script, "download_to_stdout");

  assert.match(sourceBody, /if \[ -f "\$\{root\}\/src\/server\.js" \] && \[ -f "\$\{root\}\/package\.json" \]; then/);
  assert.match(sourceBody, /codeload\.github\.com\/\$\{REPO_SLUG\}\/tar\.gz\/\$\{SOURCE_REF\}/);
  assert.match(script, /^SOURCE_REF="\$\{AIRPORT_DEPLOY_REF:-main\}"$/m);
  assert.match(downloadBody, /curl -fsSL --proto '=https'/);
  assert.match(downloadBody, /wget -qO - "\$url"/);
  assert.doesNotMatch(sourceBody, /\bgit\b/);
});

test("environment validation reads the env file without shell sourcing", async () => {
  const script = await readScript();
  const validateBody = functionBody(script, "validate_env_file");
  const portBody = functionBody(script, "service_port");

  assert.match(script, /read_env_value\(\)/);
  assert.match(validateBody, /read_env_value CONTROL_PLANE_AUTH_PASSWORD/);
  assert.match(portBody, /read_env_value PORT/);
  assert.doesNotMatch(validateBody, /\.\s+"\$ENV_FILE"/);
  assert.doesNotMatch(portBody, /\.\s+"\$ENV_FILE"/);
});

test("existing bare-metal environment is migrated without rotating credentials", async () => {
  const script = await readScript();
  const envBody = functionBody(script, "write_env_file_if_missing");

  assert.match(script, /LEGACY_ENV_FILE="\$\{APP_DIR\}\/\.env\.production"/);
  assert.match(envBody, /if \[ -f "\$LEGACY_ENV_FILE" \]; then/);
  assert.match(envBody, /install -m 0640 -o root -g "\$APP_GROUP" "\$LEGACY_ENV_FILE" "\$ENV_FILE"/);
  assert.ok(
    envBody.indexOf('if [ -f "$LEGACY_ENV_FILE" ]') < envBody.indexOf("random_password"),
    "legacy credentials must be migrated before generating a new password",
  );
});

test("legacy docker data-prod migration is explicit and refuses to overwrite data", async () => {
  const script = await readScript();
  const parseBody = functionBody(script, "parse_args");
  const migrateBody = functionBody(script, "migrate_data_prod_if_requested");
  const deployBody = functionBody(script, "deploy");

  assert.match(script, /^MIGRATE_DATA_PROD_DIR="\$\{AIRPORT_MIGRATE_DATA_PROD:-\}"$/m);
  assert.match(parseBody, /--migrate-data-prod/);
  assert.match(migrateBody, /if \[ -z "\$MIGRATE_DATA_PROD_DIR" \]; then/);
  assert.match(migrateBody, /data_dir_has_content/);
  assert.match(migrateBody, /拒绝覆盖迁移/);
  assert.match(migrateBody, /tar -cf - \./);
  assert.match(migrateBody, /chown -R "\$APP_USER:\$APP_GROUP" "\$DATA_DIR"/);
  assert.ok(
    deployBody.indexOf("migrate_data_prod_if_requested") < deployBody.indexOf("write_env_file_if_missing"),
    "data migration should happen before deployment activation begins",
  );
});

test("explicit legacy environment migration refuses to overwrite airport.env", async () => {
  const script = await readScript();
  const parseBody = functionBody(script, "parse_args");
  const envBody = functionBody(script, "write_env_file_if_missing");

  assert.match(script, /^MIGRATE_ENV_FILE="\$\{AIRPORT_MIGRATE_ENV_FILE:-\}"$/m);
  assert.match(parseBody, /--migrate-env/);
  assert.match(envBody, /if \[ -f "\$ENV_FILE" \]; then/);
  assert.match(envBody, /拒绝覆盖显式迁移/);
  assert.match(envBody, /install -m 0640 -o root -g "\$APP_GROUP" "\$source_env" "\$ENV_FILE"/);
});

test("activation preserves git metadata and persistent data", async () => {
  const script = await readScript();
  const cleanBody = functionBody(script, "safe_clean_app_dir");
  const backupBody = functionBody(script, "create_rollback_backup");
  const permissionsBody = functionBody(script, "set_release_permissions");

  assert.match(cleanBody, /! -name data/);
  assert.match(cleanBody, /! -name data-prod/);
  assert.match(cleanBody, /! -name \.git/);
  assert.match(cleanBody, /! -name \.env\.production/);
  assert.match(backupBody, /--exclude='\.\/data'/);
  assert.match(backupBody, /--exclude='\.\/data-prod'/);
  assert.match(backupBody, /--exclude='\.\/\.git'/);
  assert.match(backupBody, /--exclude='\.\/\.env\.production'/);
  assert.match(permissionsBody, /! -name \.git/);
  assert.match(permissionsBody, /! -name data-prod/);
  assert.match(permissionsBody, /! -name \.env\.production/);
});

test("published code is root-owned read-only while data remains writable by airport", async () => {
  const script = await readScript();
  const permissionsBody = functionBody(script, "set_release_permissions");
  const activateBody = functionBody(script, "activate_candidate");
  const rollbackBody = functionBody(script, "rollback_activation");

  assert.match(permissionsBody, /-exec chown -R root:"\$APP_GROUP" \{\} \+/);
  assert.match(permissionsBody, /-exec chmod -R u=rwX,g=rX,o=rX \{\} \+/);
  assert.match(permissionsBody, /chown -R "\$APP_USER:\$APP_GROUP" "\$DATA_DIR"/);
  assert.match(permissionsBody, /chmod 0750 "\$DATA_DIR"/);
  assert.doesNotMatch(activateBody, /-exec chown -R "\$APP_USER:\$APP_GROUP" \{\} \+/);
  assert.match(activateBody, /set_release_permissions/);
  assert.match(rollbackBody, /set_release_permissions/);
});

test("low-memory defaults and local demo execution are safe", async () => {
  const script = await readScript();

  assert.match(script, /^MEMORY_MAX="\$\{AIRPORT_MEMORY_MAX:-256M\}"$/m);
  assert.match(script, /^AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT=\$\{AIRPORT_ENABLE_LOCAL_DEMO_TRANSPORT:-false\}$/m);
});

test("failed health checks do not report success and try rollback", async () => {
  const script = await readScript();
  const restartBody = functionBody(script, "restart_and_verify");
  const rollbackBody = functionBody(script, "rollback_activation");
  const deployBody = functionBody(script, "deploy");
  const failureBody = functionBody(script, "rollback_deploy_failure");

  assert.match(restartBody, /if ! wait_for_health; then/);
  assert.match(restartBody, /return 1/);
  assert.match(deployBody, /backup_service_file/);
  assert.match(deployBody, /create_rollback_backup/);
  assert.match(deployBody, /enable_deploy_rollback/);
  assert.ok(
    deployBody.indexOf("enable_deploy_rollback") < deployBody.indexOf("write_service_file"),
    "service definitions must be written inside the rollback boundary",
  );
  assert.ok(
    deployBody.indexOf("enable_deploy_rollback") < deployBody.indexOf("activate_candidate"),
    "activation must be inside rollback boundary",
  );
  assert.match(failureBody, /rollback_activation/);
  assert.match(rollbackBody, /恢复上一版代码并重启服务。/);
  assert.match(rollbackBody, /svc_stop/);
  assert.match(rollbackBody, /restore_service_file/);
});

test("service definition is backed up and restored on failed deployment", async () => {
  const script = await readScript();
  const writeBody = functionBody(script, "write_service_file");
  const systemdBody = functionBody(script, "write_systemd_unit");
  const openrcBody = functionTail(script, "write_openrc_init_script");
  const backupBody = functionBody(script, "backup_service_file");
  const restoreBody = functionBody(script, "restore_service_file");

  assert.match(writeBody, /systemd\) write_systemd_unit ;;/);
  assert.match(writeBody, /openrc\) write_openrc_init_script ;;/);
  assert.match(systemdBody, /mktemp \/tmp\/airport-control-plane\.service/);
  assert.match(systemdBody, /install -m 0644 "\$service_tmp" "\$SERVICE_FILE"/);
  assert.match(openrcBody, /install -m 0755 "\$service_tmp" "\$SERVICE_FILE"/);
  assert.match(backupBody, /cp -a "\$SERVICE_FILE" "\$SERVICE_ROLLBACK_FILE"/);
  assert.match(backupBody, /SERVICE_FILE_EXISTED=true/);
  assert.match(restoreBody, /cp -a "\$SERVICE_ROLLBACK_FILE" "\$SERVICE_FILE"/);
  assert.match(restoreBody, /svc_daemon_reload/);
  assert.match(restoreBody, /svc_disable/);
});

test("bare metal deployment documentation covers both init systems and three distros", async () => {
  const docs = await readFile(docsPath, "utf8");

  assert.match(docs, /裸机/);
  assert.match(docs, /禁止 Docker|不使用 Docker/);
  assert.match(docs, /sudo bash scripts\/deploy-bare-metal\.sh install/);
  assert.match(docs, /sudo bash scripts\/deploy-bare-metal\.sh update/);
  assert.match(docs, /\/opt\/airport-control-plane/);
  assert.match(docs, /\/etc\/airport-control-plane\/airport\.env/);
  assert.match(docs, /StartLimitIntervalSec/);
  assert.match(docs, /--migrate-data-prod/);
  assert.match(docs, /AIRPORT_RUN_FULL_TESTS=true|--full-test/);
  assert.match(docs, /root:airport/);
  assert.match(docs, /Alpine/);
  assert.match(docs, /OpenRC/);
  assert.match(docs, /arm64/);
});
