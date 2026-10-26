import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSingBoxPublishScript,
  describeSingBoxTargetOutcome,
} from "../src/domain/releases/sing-box.js";

function buildScript() {
  return buildSingBoxPublishScript({
    release: { id: "release_boot", node_group_id: "group_boot" },
    manifest: { profile: { protocol: "vless", transport: "tcp" } },
    renderedConfig: { log: { level: "info" }, inbounds: [{ type: "vless", listen: "::", listen_port: 443 }] },
    renderPlan: {
      digest: "digest_boot",
      metadata: { config_path: "/etc/airport/managed/sing-box.json", security: "none" },
    },
  });
}

function buildBinaryInstallScript() {
  return buildSingBoxPublishScript({
    release: { id: "release_binary", node_group_id: "group_binary" },
    manifest: { profile: { protocol: "vless", transport: "tcp" } },
    renderedConfig: { log: { level: "info" }, inbounds: [{ type: "vless", listen: "::", listen_port: 443 }] },
    renderPlan: {
      digest: "digest_binary",
      metadata: { config_path: "/etc/sing-box/config.json", security: "none" },
    },
    binaryDistribution: {
      version: "1.13.19",
      install_path: "/usr/local/bin/sing-box",
      variants: [{ target: "linux-amd64", effective_url: "https://example.invalid/sing-box.tar.gz" }],
    },
  });
}

function outcomeWith(bootMarker) {
  const output = ["[publish] engine=sing-box", "[publish] validation=passed", "[publish] result=applied"];
  if (bootMarker) {
    output.push(`[publish] boot=${bootMarker}`);
  }
  return describeSingBoxTargetOutcome({ status: "success", output });
}

test("发布脚本在 enable 之后单独回读开机自启状态", () => {
  const script = buildScript();

  assert.match(script, /report_singbox_boot_state\(\) \{/);
  assert.match(script, /systemctl is-enabled sing-box/);
  assert.match(script, /rc-update show default/);
  assert.match(script, /\[publish\] boot=enabled/);
  assert.match(script, /\[publish\] boot=disabled/);
  assert.ok(
    script.indexOf('cp "$STAGED_CONFIG_FILE" "$SINGBOX_CONFIG_FILE"') < script.indexOf("report_singbox_boot_state || true"),
    "回读要落在配置切换之后、激活之前",
  );
  // 模板字面量会把 `\|` 吃成一个竖线，那样 ERE 变成"|空分支"，任何输出都算开机自启
  assert.ok(script.includes("sing-box[[:space:]]*[|]"), "rc-update 匹配要用字符类包住竖线");
  assert.ok(!script.includes("sing-box[[:space:]]*|'"), "不能留下恒真的备选分支");
});

test("applied 但开机自启未生效时不再输出无保留的绿灯文案", () => {
  assert.match(outcomeWith("enabled"), /已校验并重载。$/);
  assert.doesNotMatch(outcomeWith("enabled"), /开机自启/);
  assert.match(outcomeWith("disabled"), /未设为开机自启，重启后不会自动拉起/);
  assert.match(outcomeWith("unknown"), /开机自启状态未确认/);
  assert.match(outcomeWith(null), /已校验并重载。$/, "旧节点没有 boot 标记时保持原口径，不猜");
});

test("二进制安装使用磁盘临时目录并在完整校验后原子替换", () => {
  const script = buildBinaryInstallScript();

  assert.match(script, /mktemp -d \/var\/tmp\/airport-singbox\.XXXXXX/);
  assert.match(script, /INSTALL_TMP_FILE="\$\{SINGBOX_BIN_FILE\}\.airport\.tmp\.\$\$"/);
  assert.match(script, /"\$INSTALL_TMP_FILE" version/);
  assert.match(script, /binary_install=execution_check_failed/);
  assert.ok(
    script.indexOf('"$INSTALL_TMP_FILE" version') < script.indexOf('mv "$INSTALL_TMP_FILE" "$SINGBOX_BIN_FILE"'),
    "必须先执行完整性检查，再替换正式二进制",
  );
  assert.doesNotMatch(script, /cp "\$BINARY_FILE" "\$SINGBOX_BIN_FILE"/);
});
