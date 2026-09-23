// 判定口径 C 的前端一面：release.status 只代表「配置在节点生效」，
// 业务端口可达性必须单独露出来，否则 "可用" 会被读成 "用户能连"。
import test from "node:test";
import assert from "node:assert/strict";

import { getReleaseReachability } from "../public/js/shared/core-formatters.js";

function releaseWith(summary, verification) {
  return {
    id: "rel_1",
    status: "success",
    ...(summary ? { summary } : {}),
    ...(verification ? { verification } : {}),
  };
}

test("生效层成功但可达层失败时给出降调警示与节点/原因样本", () => {
  const view = getReleaseReachability(
    releaseWith({
      reachability_status: "failed",
      reachability_failures: [
        { node_id: "node_a", check: "tcp_port", reason_code: "port_unreachable", message: "8443 不通" },
        { node_id: "node_b", check: "tcp_port", reason_code: "port_unreachable", message: "8443 不通" },
      ],
    }),
  );

  assert.equal(view.status, "failed");
  assert.equal(view.warn, true);
  assert.equal(view.label, "入口可达未通过");
  assert.deepEqual(view.nodeIds, ["node_a", "node_b"]);
  assert.deepEqual(view.reasonCodes, ["port_unreachable"]);
  assert.match(view.detail, /2 台节点/);
  assert.match(view.detail, /port_unreachable/);
  assert.match(view.detail, /配置已生效/);
});

test("可达层部分未确认时不写成全量失败", () => {
  const view = getReleaseReachability(
    releaseWith({
      reachability_status: "partial",
      reachability_failures: [{ node_id: "node_c", reason_code: "probe_timeout" }],
    }),
  );

  assert.equal(view.warn, true);
  assert.equal(view.label, "入口可达部分通过");
  assert.match(view.detail, /其余节点已通过/);
});

test("复检跳过业务端口时说明「可用」只是生效", () => {
  const view = getReleaseReachability(releaseWith({ reachability_status: "skipped" }));

  assert.equal(view.warn, false);
  assert.equal(view.label, "入口可达未复检");
  assert.match(view.detail, /只表示配置已在节点生效/);
});

test("可达层验证通过时不额外占用列表行", () => {
  const view = getReleaseReachability(releaseWith({ reachability_status: "success" }));

  assert.equal(view.status, "success");
  assert.equal(view.warn, false);
  assert.equal(view.detail, "");
});

test("缺失复检字段的历史记录不臆测可达性", () => {
  assert.equal(getReleaseReachability(releaseWith({})), null);
  assert.equal(getReleaseReachability({ id: "rel_old", status: "success" }), null);
  assert.equal(getReleaseReachability(null), null);
});

test("summary 缺失时回退到 verification 上的可达层结论", () => {
  const view = getReleaseReachability(releaseWith({}, { reachability_status: "failed" }));

  assert.equal(view.status, "failed");
  assert.equal(view.warn, true);
});
