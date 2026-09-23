import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRollbackRenderPlans,
  buildDeploymentPlanDigest,
  buildRollbackUserDiff,
} from "../src/domain/releases/rollback.js";

const REALITY_PLACEHOLDER = "__AIRPORT_REALITY_PRIVATE_KEY__";

function buildPlan() {
  return {
    digest: "liveplandigest",
    change_summary: "现场渲染的变更摘要",
    deploymentPlans: [
      {
        node_id: "node_a",
        node_name: "落地 A",
        route_roles: new Set(["landing", "entry"]),
        components: {
          sing_box: {
            engine: "sing-box",
            renderPlan: {
              config: { inbounds: [{ tag: "live" }] },
              digest: "livesingbox",
              eligibleUsers: [{ id: "u1" }, { id: "u2" }, { id: "u3" }],
              skippedUsers: [],
              metadata: {
                engine: "sing-box",
                config_path: "/etc/sing-box/config.json",
                security: "reality",
                reality_private_key_path: "/etc/airport/reality.key",
              },
            },
          },
          traffic_forwarder: {
            engine: "haproxy",
            renderPlan: {
              config: "global\n",
              digest: "livehaproxy",
              bindings: [{ entry_port: 8443 }],
              metadata: {
                engine: "haproxy",
                config_path: "/etc/haproxy/haproxy.cfg",
              },
            },
          },
        },
      },
    ],
  };
}

function buildSourceRelease(overrides = {}) {
  return {
    id: "release_old",
    version: "rel-old",
    profile_id: "profile_1",
    access_user_ids: ["u1", "u2"],
    deployment_node_ids: ["node_a"],
    summary: {
      active_user_count: 2,
      skipped_user_count: 1,
      config_digest_after: "oldplandigest",
    },
    deployments: [
      {
        node_id: "node_a",
        node_name: "落地 A",
        artifacts: {
          sing_box: {
            engine: "sing-box",
            config_digest: "oldsingbox",
            config_path: "/etc/sing-box/legacy.json",
            rendered_config: { inbounds: [{ tag: "old", users: [{ uuid: REALITY_PLACEHOLDER }] }] },
          },
          traffic_forwarder: {
            engine: "haproxy",
            config_digest: "oldhaproxy",
            config_path: "/etc/haproxy/legacy.cfg",
            rendered_config: "old global\n",
            bindings: [{ entry_port: 9443 }],
          },
        },
      },
    ],
    ...overrides,
  };
}

test("rollback replays stored artifacts and recomputes the plan digest", () => {
  const plan = buildPlan();
  const source = applyRollbackRenderPlans(plan, buildSourceRelease());

  const [deployment] = plan.deploymentPlans;
  assert.equal(deployment.components.sing_box.renderPlan.digest, "oldsingbox");
  assert.deepEqual(deployment.components.sing_box.renderPlan.config, {
    inbounds: [{ tag: "old", users: [{ uuid: REALITY_PLACEHOLDER }] }],
  });
  assert.equal(deployment.components.sing_box.renderPlan.metadata.config_path, "/etc/sing-box/legacy.json");
  assert.equal(deployment.components.sing_box.renderPlan.metadata.security, "reality");
  assert.equal(
    deployment.components.sing_box.renderPlan.metadata.reality_private_key_path,
    "/etc/airport/reality.key",
  );

  assert.equal(deployment.components.traffic_forwarder.renderPlan.digest, "oldhaproxy");
  assert.equal(deployment.components.traffic_forwarder.renderPlan.config, "old global\n");
  assert.deepEqual(deployment.components.traffic_forwarder.renderPlan.bindings, [{ entry_port: 9443 }]);
  assert.equal(
    deployment.components.traffic_forwarder.renderPlan.metadata.config_path,
    "/etc/haproxy/legacy.cfg",
  );

  assert.equal(plan.digest, buildDeploymentPlanDigest(plan.deploymentPlans));
  assert.match(plan.digest, /^[0-9a-f]{12}$/);
  assert.notEqual(plan.digest, "liveplandigest");
  assert.match(plan.change_summary, /回滚到 rel-old/);
  assert.deepEqual(source, {
    release_id: "release_old",
    version: "rel-old",
    config_digest: "oldplandigest",
  });
});

test("plan digest follows the rolled-back component digests", () => {
  const replayed = buildPlan();
  applyRollbackRenderPlans(replayed, buildSourceRelease());

  const republished = buildPlan();
  applyRollbackRenderPlans(republished, buildSourceRelease());
  republished.deploymentPlans[0].components.sing_box.renderPlan.digest = "otherdigest";

  assert.notEqual(replayed.digest, buildDeploymentPlanDigest(republished.deploymentPlans));
});

test("rollback keeps the live config path when the stored artifact has none", () => {
  const plan = buildPlan();
  const source = buildSourceRelease();
  delete source.deployments[0].artifacts.sing_box.config_path;
  applyRollbackRenderPlans(plan, source);

  assert.equal(
    plan.deploymentPlans[0].components.sing_box.renderPlan.metadata.config_path,
    "/etc/sing-box/config.json",
  );
});

test("rollback skips the reality branch when the stored config has no placeholder", () => {
  const plan = buildPlan();
  const source = buildSourceRelease();
  source.deployments[0].artifacts.sing_box.rendered_config = { inbounds: [{ tag: "old" }] };
  applyRollbackRenderPlans(plan, source);

  const metadata = plan.deploymentPlans[0].components.sing_box.renderPlan.metadata;
  assert.notEqual(metadata.security, "reality");
});

test("rollback refuses to run when the current profile lost the reality key path", () => {
  const plan = buildPlan();
  delete plan.deploymentPlans[0].components.sing_box.renderPlan.metadata.reality_private_key_path;

  assert.throws(
    () => applyRollbackRenderPlans(plan, buildSourceRelease()),
    /Reality 私钥路径/,
  );
});

test("rollback refuses when the topology drifted in either direction", () => {
  const missingTarget = buildPlan();
  missingTarget.deploymentPlans.push({
    node_id: "node_b",
    node_name: "落地 B",
    route_roles: new Set(["landing"]),
    components: {},
  });
  assert.throws(
    () => applyRollbackRenderPlans(missingTarget, buildSourceRelease()),
    /目标发布没有覆盖这些节点/,
  );

  const droppedNode = buildPlan();
  const sourceWithExtra = buildSourceRelease();
  sourceWithExtra.deployments.push({
    node_id: "node_gone",
    node_name: "已移除的入口",
    artifacts: {},
  });
  assert.throws(
    () => applyRollbackRenderPlans(droppedNode, sourceWithExtra),
    /当前线路拓扑与目标发布不一致/,
  );
});

test("rollback refuses when a stored component artifact is missing or unusable", () => {
  const noArtifact = buildPlan();
  const sourceWithoutForwarder = buildSourceRelease();
  delete sourceWithoutForwarder.deployments[0].artifacts.traffic_forwarder;
  assert.throws(
    () => applyRollbackRenderPlans(noArtifact, sourceWithoutForwarder),
    /缺少 haproxy 组件产物/,
  );

  const noDigest = buildPlan();
  const sourceWithoutDigest = buildSourceRelease();
  delete sourceWithoutDigest.deployments[0].artifacts.sing_box.config_digest;
  assert.throws(
    () => applyRollbackRenderPlans(noDigest, sourceWithoutDigest),
    /缺少配置摘要/,
  );
});

test("rollback user diff names who loses and who regains access", () => {
  const users = {
    u1: { id: "u1", name: "首发用户" },
    u2: { id: "u2", name: "二号用户" },
    u3: { id: "u3", name: "后加用户" },
    u4: { id: "u4", name: "已删除用户" },
  };
  const diff = buildRollbackUserDiff({
    currentRelease: { id: "release_new", version: "rel-new", access_user_ids: ["u1", "u2", "u3"] },
    targetRelease: { id: "release_old", version: "rel-old", access_user_ids: ["u1", "u2", "u4"] },
    findUser: (id) => users[id] ?? null,
  });

  assert.equal(diff.target_version, "rel-old");
  assert.equal(diff.current_version, "rel-new");
  assert.deepEqual(diff.lost_users, [{ id: "u3", name: "后加用户" }]);
  assert.deepEqual(diff.restored_users, [{ id: "u4", name: "已删除用户" }]);
});

test("rollback user diff tolerates missing releases", () => {
  const diff = buildRollbackUserDiff({
    currentRelease: null,
    targetRelease: { id: "release_old", version: "rel-old", deployment_node_ids: ["node_a"] },
    findUser: () => null,
  });

  assert.deepEqual(diff.lost_users, []);
  assert.deepEqual(diff.restored_users, []);
  assert.equal(diff.current_version, null);
  assert.equal(diff.target_node_count, 1);
});
