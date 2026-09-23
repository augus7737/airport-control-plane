import { normalizeNullableString } from "../../utils/network.js";

// 操作台账的只读查询口径。这里只有读侧的排序/过滤/单资源定位，
// 不触碰 src/domain/operations/executor.js 的并发与超时执行口径。

// 列表口径：按 created_at 倒序（与搬迁前 server.js 里的内联比较器逐字一致）。
export function sortOperationsByCreatedDesc(operations) {
  const items = Array.isArray(operations) ? [...operations] : [];
  return items.sort((a, b) => String(b?.created_at).localeCompare(String(a?.created_at)));
}

// 一条操作的逐节点结果里是否包含指定节点。targets 是执行器写入的逐节点数组，
// 缺 targets（历史脏数据/裁剪后的记录）视为不匹配。
export function operationTargetsNode(operation, nodeId) {
  const normalizedNodeId = normalizeNullableString(nodeId);
  if (!normalizedNodeId) {
    return false;
  }

  const targets = Array.isArray(operation?.targets) ? operation.targets : [];
  return targets.some((target) => normalizeNullableString(target?.node_id) === normalizedNodeId);
}

// 按节点过滤：只挑出 targets 含该节点的整条记录，**不裁剪** targets 数组内容，
// 因此一条多节点操作在任一节点视图下都是完整返回的。nodeId 为空时原样返回。
export function filterOperationsByNode(operations, nodeId) {
  const items = Array.isArray(operations) ? [...operations] : [];
  const normalizedNodeId = normalizeNullableString(nodeId);
  if (!normalizedNodeId) {
    return items;
  }

  return items.filter((operation) => operationTargetsNode(operation, normalizedNodeId));
}

// 单资源读取：命中返回台账里的原对象（与列表同构，不做二次序列化），否则 null。
export function findOperationById(operations, operationId) {
  const normalizedId = normalizeNullableString(operationId);
  if (!normalizedId) {
    return null;
  }

  const items = Array.isArray(operations) ? operations : [];
  return items.find((operation) => operation?.id === normalizedId) ?? null;
}
