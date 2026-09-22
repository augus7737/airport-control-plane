const BASE_URL = (process.env.SEED_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const USERNAME = process.env.SEED_USERNAME ?? "admin";
const PASSWORD = process.env.SEED_PASSWORD ?? "devpass";

let sessionCookie = "";

function isoDate(daysFromNow) {
  const date = new Date(Date.now() + daysFromNow * 86400000);
  return date.toISOString().slice(0, 10);
}

async function api(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    sessionCookie = setCookie.map((entry) => entry.split(";")[0]).join("; ");
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  return { status: response.status, payload };
}

const created = [];
const skipped = [];
const failed = [];

async function step(label, pathname, body) {
  const { status, payload } = await api(pathname, { method: "POST", body });

  if (status >= 200 && status < 300) {
    const record = payload?.node ?? payload?.user ?? payload?.profile ?? payload?.group ?? payload?.provider ?? payload?.token ?? null;
    created.push({ label, id: record?.id ?? null });
    return record;
  }

  if (status === 409) {
    skipped.push(`${label} (${payload?.error ?? "conflict"})`);
    return null;
  }

  failed.push(`${label} -> ${status} ${JSON.stringify(payload?.details ?? payload?.error ?? payload?.message ?? payload)}`);
  return null;
}

async function main() {
  const login = await api("/api/v1/auth/login", {
    method: "POST",
    body: { username: USERNAME, password: PASSWORD },
  });

  if (login.status !== 200) {
    console.error(`登录失败 ${login.status}: ${JSON.stringify(login.payload)}`);
    console.error(`请确认服务已启动，或用 SEED_USERNAME / SEED_PASSWORD 指定凭据。`);
    process.exitCode = 1;
    return;
  }

  for (const provider of [
    {
      name: "Vultr",
      regions: ["SIN", "NRT", "HKG", "FRA", "IAD"],
      default_currency: "USD",
      website: "https://www.vultr.com",
      note: "按小时计费，余额充足",
    },
    {
      name: "BandwagonHost",
      regions: ["HKG", "TOKYO", "OSAKA"],
      default_currency: "USD",
      website: "https://www.bandwagonhost.net",
      note: "年付促销机，中转主力",
    },
    {
      name: "RackNerd",
      regions: ["LAX", "SJC", "NYC"],
      default_currency: "USD",
      website: "https://www.racknerd.com",
      note: "低价落地机，续费窗口需盯紧",
    },
  ]) {
    await step(`provider:${provider.name}`, "/api/v1/providers", provider);
  }

  const relayNode = await step(
    "node:hkg-relay-01",
    "/api/v1/nodes/manual",
    {
      hostname: "hkg-relay-01",
      provider: "BandwagonHost",
      region: "HKG",
      role: "relay",
      public_ipv4: "203.0.113.11",
      private_ipv4: "10.0.0.11",
      ssh_port: 22,
      cpu_cores: 1,
      memory_mb: 1024,
      disk_gb: 20,
      bandwidth_mbps: 1000,
      traffic_quota_gb: 2000,
      traffic_used_gb: 640,
      access_mode: "direct",
      entry_region: "中国大陆",
      expires_at: isoDate(210),
      auto_renew: true,
      billing_cycle: "年付",
      billing_amount: 95,
      billing_currency: "USD",
      note: "中转主力，承载日本/美西落地回程",
    },
  );

  const nodePlan = [
    {
      hostname: "sin-direct-01",
      provider: "Vultr",
      region: "SIN",
      role: "edge",
      public_ipv4: "203.0.113.21",
      private_ipv4: "10.0.0.21",
      ssh_port: 22,
      cpu_cores: 1,
      memory_mb: 512,
      disk_gb: 10,
      bandwidth_mbps: 500,
      traffic_quota_gb: 1000,
      traffic_used_gb: 180,
      access_mode: "direct",
      entry_region: "中国大陆",
      expires_at: isoDate(160),
      auto_renew: true,
      billing_cycle: "月付",
      billing_amount: 5,
      billing_currency: "USD",
      note: "新加坡 VLESS Reality 直连，主力出口",
    },
    {
      hostname: "nrt-landing-03",
      provider: "Vultr",
      region: "NRT",
      role: "edge",
      public_ipv4: "203.0.113.31",
      private_ipv4: "10.0.0.31",
      ssh_port: 2222,
      cpu_cores: 1,
      memory_mb: 1024,
      disk_gb: 25,
      bandwidth_mbps: 800,
      traffic_quota_gb: 3000,
      traffic_used_gb: 1420,
      access_mode: "relay",
      entry_region: "中国大陆",
      relay_label: "hkg-relay-01",
      relay_region: "HKG",
      relay_node_id: relayNode?.id ?? null,
      route_note: "中国大陆 -> 香港中转 -> 日本落地",
      expires_at: isoDate(95),
      auto_renew: false,
      billing_cycle: "月付",
      billing_amount: 7.5,
      billing_currency: "USD",
      note: "日本落地，走 HKG 中转回程",
    },
    {
      hostname: "sjc-direct-04",
      provider: "RackNerd",
      region: "SJC",
      role: "edge",
      public_ipv4: "203.0.113.41",
      private_ipv4: "10.0.0.41",
      ssh_port: 22,
      cpu_cores: 1,
      memory_mb: 512,
      disk_gb: 15,
      bandwidth_mbps: 300,
      traffic_quota_gb: 1500,
      traffic_used_gb: 1420,
      access_mode: "direct",
      entry_region: "中国大陆",
      expires_at: isoDate(9),
      auto_renew: false,
      billing_cycle: "年付",
      billing_amount: 12,
      billing_currency: "USD",
      note: "即将到期且流量接近上限，续费决策样例",
    },
    {
      hostname: "fra-direct-05",
      provider: "Vultr",
      region: "FRA",
      role: "edge",
      public_ipv4: "203.0.113.51",
      private_ipv4: "10.0.0.51",
      ssh_port: 22,
      cpu_cores: 2,
      memory_mb: 2048,
      disk_gb: 40,
      bandwidth_mbps: 1000,
      traffic_quota_gb: 5000,
      traffic_used_gb: 4980,
      access_mode: "direct",
      entry_region: "欧洲",
      expires_at: isoDate(120),
      auto_renew: true,
      billing_cycle: "月付",
      billing_amount: 15,
      billing_currency: "USD",
      note: "Hysteria2 机器，流量已用满用于验证配额告警",
    },
    {
      hostname: "iad-relay-06",
      provider: "Vultr",
      region: "IAD",
      role: "relay",
      public_ipv4: "203.0.113.61",
      private_ipv4: "10.0.0.61",
      ssh_port: 19822,
      cpu_cores: 1,
      memory_mb: 512,
      disk_gb: 10,
      bandwidth_mbps: 500,
      traffic_quota_gb: 1000,
      traffic_used_gb: 30,
      access_mode: "direct",
      entry_region: "北美",
      expires_at: isoDate(240),
      auto_renew: false,
      billing_cycle: "月付",
      billing_amount: 5,
      billing_currency: "USD",
      note: "美东中转候选，尚未完成初始化",
    },
  ];

  const nodes = [relayNode, ...(await Promise.all(nodePlan.map((node) => step(`node:${node.hostname}`, "/api/v1/nodes/manual", node))))].filter(Boolean);
  const nodeIds = nodes.map((node) => node.id).filter(Boolean);

  const profileSin = await step("profile:SIN VLESS Reality", "/api/v1/proxy-profiles", {
    name: "SIN VLESS Reality 443",
    protocol: "vless",
    listen_port: 443,
    transport: "tcp",
    security: "tls",
    tls_enabled: true,
    reality_enabled: true,
    server_name: "www.cloudflare.com",
    mux_enabled: false,
    status: "active",
    note: "新加坡 VLESS Reality 模板",
  });

  const profileNrt = await step("profile:NRT VMess WS TLS", "/api/v1/proxy-profiles", {
    name: "NRT VMess WS TLS",
    protocol: "vmess",
    listen_port: 443,
    transport: "ws",
    security: "tls",
    tls_enabled: true,
    reality_enabled: false,
    server_name: "cdn.example.com",
    mux_enabled: true,
    status: "active",
    note: "日本 VMess + WebSocket 模板",
    template: { transport: { type: "ws", path: "/ws" } },
  });

  const profileFra = await step("profile:FRA Hysteria2", "/api/v1/proxy-profiles", {
    name: "FRA Hysteria2 8443",
    protocol: "hysteria2",
    listen_port: 8443,
    security: "tls",
    tls_enabled: true,
    status: "active",
    note: "欧洲 Hysteria2 模板",
  });

  const groupAll = await step("group:全部纳管节点", "/api/v1/node-groups", {
    name: "全部纳管节点",
    type: "static",
    node_ids: nodeIds,
    note: "全量发布范围",
  });

  const groupDirect = await step("group:直连出口组", "/api/v1/node-groups", {
    name: "直连出口组",
    type: "static",
    node_ids: nodes.filter((node) => node?.networking?.access_mode !== "relay").map((node) => node.id),
    note: "仅直连机器，用于灰度发布",
  });

  const userPlan = [
    {
      name: "内部测试 A",
      protocol: "vless",
      profile_id: profileSin?.id ?? null,
      node_group_ids: [groupAll?.id, groupDirect?.id].filter(Boolean),
      status: "active",
      expires_at: isoDate(180),
      note: "长期自用的内部账号",
      credential: { uuid: "3f2504e0-4f89-41d3-9a0c-0305e82c3311" },
    },
    {
      name: "日本线路用户 B",
      protocol: "vmess",
      profile_id: profileNrt?.id ?? null,
      node_group_ids: [groupAll?.id].filter(Boolean),
      status: "active",
      expires_at: isoDate(45),
      note: "走中转的付费用户样例",
      credential: { uuid: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", alter_id: 0 },
    },
    {
      name: "欧洲体验用户 C",
      protocol: "hysteria2",
      profile_id: profileFra?.id ?? null,
      node_group_ids: [groupDirect?.id].filter(Boolean),
      status: "active",
      expires_at: isoDate(7),
      note: "即将到期的体验账号样例",
      credential: { password: "seed-hy2-password" },
    },
  ];

  for (const user of userPlan) {
    await step(`user:${user.name}`, "/api/v1/access-users", user);
  }

  await step("token:本地演示批次", "/api/v1/bootstrap-tokens", {
    label: "本地演示批次",
    expires_at: isoDate(30),
    max_uses: 5,
    note: "用于在本地验证 bootstrap 注册链路",
  });

  console.log(`\n播种完成（${BASE_URL}）`);
  console.log(`  新建 ${created.length} 条：${created.map((item) => item.label).join(", ") || "-"}`);
  if (skipped.length > 0) {
    console.log(`  已存在跳过 ${skipped.length} 条：${skipped.join(", ")}`);
  }
  if (failed.length > 0) {
    console.log(`  失败 ${failed.length} 条：`);
    for (const line of failed) {
      console.log(`    - ${line}`);
    }
    process.exitCode = 1;
  }
}

await main();
