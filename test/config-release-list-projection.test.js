import assert from "node:assert/strict";
import test from "node:test";

import { projectConfigReleaseForDetail, projectConfigReleaseForList } from "../src/domain/releases/detail.js";

function releaseWith(deployments) {
  return {
    id: "rel_1",
    status: "success",
    deployments,
  };
}

function artifact(config, manifest) {
  return {
    engine: "sing-box",
    config_digest: "d1",
    config_path: "/etc/sing-box/config.json",
    rendered_config: config,
    ...(manifest ? { manifest } : {}),
  };
}

test("projectConfigReleaseForList 去掉逐节点渲染配置全文与 manifest 大块", () => {
  const projected = projectConfigReleaseForList(
    releaseWith([
      {
        node_id: "node_a",
        status: "success",
        artifacts: {
          sing_box: artifact(
            { padding: "p".repeat(700), inbounds: [{ password: "secret" }] },
            { huge: "x".repeat(4096) },
          ),
        },
      },
    ]),
  );

  const artifactView = projected.deployments[0].artifacts.sing_box;
  assert.equal("rendered_config" in artifactView, false);
  assert.equal("manifest" in artifactView, false);
  assert.equal(artifactView.manifest_omitted, true);
  assert.equal(artifactView.engine, "sing-box");
  assert.equal(artifactView.config_digest, "d1");
  assert.ok(artifactView.rendered_config_bytes > 0);
  assert.equal(artifactView.rendered_config_preview.includes("secret"), false, "预览只有 600 字节的开头");
  // 顶层字段原样保留，前端列表渲染不需要改
  assert.equal(projected.id, "rel_1");
  assert.equal(projected.status, "success");
  assert.equal(projected.deployments[0].node_id, "node_a");
  assert.equal(projected.deployments[0].status, "success");
});

test("列表投影与明细投影的 release 完全同构", () => {
  const release = releaseWith([
    {
      node_id: "node_a",
      artifacts: {
        sing_box: artifact("global-config-text", null),
        traffic_forwarder: artifact("forwarder-config-text", null),
      },
    },
  ]);

  assert.deepEqual(projectConfigReleaseForList(release), projectConfigReleaseForDetail(release).release);
});

test("rendered_config_total_bytes 累加同一节点的全部产物", () => {
  const singBox = artifact("A".repeat(1000), null);
  const forwarder = artifact("B".repeat(1000), null);
  const { detail } = projectConfigReleaseForDetail(
    releaseWith([{ node_id: "node_a", artifacts: { sing_box: singBox, traffic_forwarder: forwarder } }]),
  );

  assert.equal(detail.rendered_config_total_bytes, 2000);
});

test("投影容忍缺 deployments 与畸形产物条目", () => {
  assert.deepEqual(projectConfigReleaseForList({ id: "rel_x" }), { id: "rel_x", deployments: [] });
  assert.equal(projectConfigReleaseForList(null), null);

  const projected = projectConfigReleaseForList({
    id: "rel_y",
    deployments: [null, { node_id: "node_b", artifacts: { bad: null, ok: artifact("c", null) } }],
  });
  // 畸形 deployment 被丢掉，但保留下来的产物里只投影非空项
  assert.equal(projected.deployments.length, 1);
  assert.equal(projected.deployments[0].artifacts.ok.engine, "sing-box");
});
