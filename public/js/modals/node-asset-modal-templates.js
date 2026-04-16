export function createNodeAssetModalTemplatesModule() {
  function manualModalTemplate() {
    return `
      <div class="modal-backdrop" id="manual-modal">
        <div class="modal wide">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>手动录入节点</h3>
                <p>在厂商 API 还没接入前，先把节点的经营信息和技术信息手工收进平台，后面再逐步切换成自动同步。</p>
              </div>
              <button class="close" id="close-manual-modal" aria-label="关闭">×</button>
            </div>

            <form id="manual-node-form" class="form-grid">
              <div class="field">
                <label for="manual-hostname">节点名称</label>
                <input id="manual-hostname" name="hostname" placeholder="例如 alpine-hkg-04" required />
              </div>
              <div class="field">
                <label for="manual-provider">云厂商</label>
                <input id="manual-provider" name="provider" placeholder="例如 Vultr / Oracle / DMIT" />
              </div>
              <div class="field">
                <label for="manual-region">区域</label>
                <input id="manual-region" name="region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
                <div class="field-note">支持中英文和常见机房代码联想，选择后会自动写成统一区域值。</div>
              </div>
              <div class="field">
                <label for="manual-role">用途标签</label>
                <input id="manual-role" name="role" placeholder="例如 edge / backup / test" />
              </div>
              <div class="field">
                <label for="manual-public-ip">公网 IP</label>
                <input id="manual-public-ip" name="public_ipv4" placeholder="例如 203.0.113.88" />
              </div>
              <div class="field">
                <label for="manual-public-ipv6">公网 IPv6</label>
                <input id="manual-public-ipv6" name="public_ipv6" placeholder="例如 2408:xxxx::88" />
              </div>
              <div class="field">
                <label for="manual-private-ip">内网 IP</label>
                <input id="manual-private-ip" name="private_ipv4" placeholder="例如 10.0.0.88" />
              </div>
              <div class="field">
                <label for="manual-ssh-port">SSH 端口</label>
                <input id="manual-ssh-port" name="ssh_port" type="number" min="1" max="65535" value="19822" placeholder="默认 19822，可按节点实际端口填写" />
              </div>
              <div class="field">
                <label for="manual-memory">内存 MB</label>
                <input id="manual-memory" name="memory_mb" type="number" min="0" placeholder="例如 1024" />
              </div>
              <div class="field">
                <label for="manual-bandwidth">带宽 Mbps</label>
                <input id="manual-bandwidth" name="bandwidth_mbps" type="number" min="0" placeholder="例如 300" />
              </div>
              <div class="field">
                <label for="manual-traffic-quota">流量总额 GB</label>
                <input id="manual-traffic-quota" name="traffic_quota_gb" type="number" min="0" placeholder="例如 2000" />
              </div>
              <div class="field">
                <label for="manual-traffic-used">已用流量 GB</label>
                <input id="manual-traffic-used" name="traffic_used_gb" type="number" min="0" placeholder="例如 320" />
              </div>
              <div class="field">
                <label for="manual-expire">到期时间</label>
                <input id="manual-expire" name="expires_at" type="date" />
              </div>
              <div class="field">
                <label for="manual-billing">计费周期</label>
                <select id="manual-billing" name="billing_cycle">
                  <option value="">未填写</option>
                  <option value="月付">月付</option>
                  <option value="季付">季付</option>
                  <option value="年付">年付</option>
                  <option value="一次性">一次性</option>
                </select>
              </div>
              <div class="field full">
                <label>业务链路</label>
                <div class="field-note">这里描述用户流量如何进入这条线路，例如直连，或“中国大陆 -> 香港入口 -> 美国落地”。</div>
              </div>
              <div class="field">
                <label for="manual-access-mode">业务接入方式</label>
                <select id="manual-access-mode" name="access_mode">
                  <option value="direct">直连</option>
                  <option value="relay">经中转</option>
                </select>
              </div>
              <div class="field">
                <label for="manual-entry-region">业务入口区域</label>
                <input id="manual-entry-region" name="entry_region" data-location-scope="entry" autocomplete="off" placeholder="例如 中国大陆 / Mainland China / 香港" />
              </div>
              <div class="field">
                <label for="manual-entry-port">业务入口端口</label>
                <input id="manual-entry-port" name="entry_port" type="number" min="1" max="65535" placeholder="中转入口监听端口，例如 443 / 8443" />
              </div>
              <div class="field">
                <label for="manual-relay-node-id">业务入口节点 ID</label>
                <input id="manual-relay-node-id" name="relay_node_id" placeholder="如果已纳管，可填写 node_xxx" />
              </div>
              <div class="field">
                <label for="manual-relay-label">业务入口节点名称</label>
                <input id="manual-relay-label" name="relay_label" placeholder="例如 alpine-hkg-01" />
              </div>
              <div class="field">
                <label for="manual-relay-region">业务入口区域补充</label>
                <input id="manual-relay-region" name="relay_region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
              </div>
              <div class="field full">
                <label for="manual-route-note">业务链路说明</label>
                <textarea id="manual-route-note" name="route_note" placeholder="例如：中国 -> 香港中转 -> 日本落地。"></textarea>
              </div>
              <div class="field full">
                <label>管理链路</label>
                <div class="field-note">这里描述控制面怎么 SSH 接管这台节点，例如直连、经纳管跳板节点，或经独立 SSH 代理主机。</div>
              </div>
              <div class="field">
                <label for="manual-management-access-mode">管理接入方式</label>
                <select id="manual-management-access-mode" name="management_access_mode">
                  <option value="direct">SSH 直连</option>
                  <option value="relay">SSH 经中转</option>
                </select>
              </div>
              <div class="field">
                <label for="manual-management-ssh-user">SSH 用户</label>
                <input id="manual-management-ssh-user" name="management_ssh_user" placeholder="例如 root / admin" />
              </div>
              <div class="field">
                <label for="manual-management-relay-node-id">管理跳板节点 ID</label>
                <input id="manual-management-relay-node-id" name="management_relay_node_id" placeholder="如果已纳管，可填写 node_xxx" />
              </div>
              <div class="field">
                <label for="manual-management-relay-label">管理跳板名称</label>
                <input id="manual-management-relay-label" name="management_relay_label" placeholder="例如 hk-jump-01" />
              </div>
              <div class="field">
                <label for="manual-management-relay-region">管理跳板区域</label>
                <input id="manual-management-relay-region" name="management_relay_region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
              </div>
              <div class="field">
                <label for="manual-management-proxy-host">SSH 代理主机</label>
                <input id="manual-management-proxy-host" name="management_proxy_host" placeholder="未纳管代理可填域名或 IP，例如 hk-proxy.example.com" />
              </div>
              <div class="field">
                <label for="manual-management-proxy-port">SSH 代理端口</label>
                <input id="manual-management-proxy-port" name="management_proxy_port" type="number" min="1" max="65535" placeholder="默认 22，按代理机实际端口填写" />
              </div>
              <div class="field">
                <label for="manual-management-proxy-user">SSH 代理用户</label>
                <input id="manual-management-proxy-user" name="management_proxy_user" placeholder="例如 jump / root" />
              </div>
              <div class="field">
                <label for="manual-management-proxy-label">SSH 代理备注名</label>
                <input id="manual-management-proxy-label" name="management_proxy_label" placeholder="例如 香港代理 / 东京堡垒机" />
              </div>
              <div class="field full">
                <label for="manual-management-route-note">管理链路说明</label>
                <textarea id="manual-management-route-note" name="management_route_note" placeholder="例如：控制面 -> 香港 SSH 代理 -> 目标节点。"></textarea>
              </div>
              <div class="field full">
                <label>续费方式</label>
                <label class="check-row">
                  <input id="manual-auto-renew" name="auto_renew" type="checkbox" />
                  <span>开启自动续费</span>
                </label>
              </div>
              <div class="field full">
                <label for="manual-note">备注</label>
                <textarea id="manual-note" name="note" placeholder="例如：月底到期，先观察质量，再决定是否续费。"></textarea>
                <div class="field-note">这一步先解决“账目和资产台账”问题，等接入厂商 API 后再做自动同步。</div>
              </div>
              <div class="field full">
                <div class="modal-actions">
                  <button class="button primary" type="submit">保存到节点清单</button>
                  <button class="button ghost" type="button" id="manual-reset">清空表单</button>
                </div>
                <div id="manual-message"></div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  function assetModalTemplate() {
    return `
      <div class="modal-backdrop" id="asset-modal">
        <div class="modal wide">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>编辑资产信息</h3>
                <p>自动注册节点和手工录入节点都走同一套资产字段，区别只是技术信息来自哪里。</p>
                <div class="field-note" id="asset-node-summary">当前编辑节点：-</div>
              </div>
              <button class="close" id="close-asset-modal" aria-label="关闭">×</button>
            </div>

            <form id="asset-form" class="form-grid">
              <div class="field">
                <label for="asset-provider">云厂商</label>
                <input id="asset-provider" name="provider" placeholder="例如 Vultr / Oracle / DMIT" />
              </div>
              <div class="field">
                <label for="asset-region">区域</label>
                <input id="asset-region" name="region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
                <div class="field-note">可直接输入中文、英文或代码，系统会统一成规范区域值。</div>
              </div>
              <div class="field">
                <label for="asset-role">用途标签</label>
                <input id="asset-role" name="role" placeholder="例如 edge / backup / test" />
              </div>
              <div class="field">
                <label for="asset-billing">计费周期</label>
                <select id="asset-billing" name="billing_cycle">
                  <option value="">未填写</option>
                  <option value="月付">月付</option>
                  <option value="季付">季付</option>
                  <option value="年付">年付</option>
                  <option value="一次性">一次性</option>
                </select>
              </div>
              <div class="field">
                <label for="asset-expire">到期时间</label>
                <input id="asset-expire" name="expires_at" type="date" />
              </div>
              <div class="field">
                <label for="asset-public-ip">公网 IPv4</label>
                <input id="asset-public-ip" name="public_ipv4" placeholder="例如 203.0.113.88" />
              </div>
              <div class="field">
                <label for="asset-public-ipv6">公网 IPv6</label>
                <input id="asset-public-ipv6" name="public_ipv6" placeholder="例如 2408:xxxx::88" />
              </div>
              <div class="field">
                <label for="asset-private-ip">内网 IPv4</label>
                <input id="asset-private-ip" name="private_ipv4" placeholder="例如 10.0.0.88" />
              </div>
              <div class="field full">
                <label>业务链路</label>
                <div class="field-note">只描述用户实际接入线路，不再给 SSH/探测复用。</div>
              </div>
              <div class="field">
                <label for="asset-access-mode">业务接入方式</label>
                <select id="asset-access-mode" name="access_mode">
                  <option value="direct">直连</option>
                  <option value="relay">经中转</option>
                </select>
              </div>
              <div class="field">
                <label for="asset-entry-region">业务入口区域</label>
                <input id="asset-entry-region" name="entry_region" data-location-scope="entry" autocomplete="off" placeholder="例如 中国大陆 / Mainland China / 香港" />
              </div>
              <div class="field">
                <label for="asset-entry-port">业务入口端口</label>
                <input id="asset-entry-port" name="entry_port" type="number" min="1" max="65535" placeholder="中转入口监听端口，例如 443 / 8443" />
              </div>
              <div class="field">
                <label for="asset-ssh-port">SSH 端口</label>
                <input id="asset-ssh-port" name="ssh_port" type="number" min="1" max="65535" placeholder="默认 19822，可按节点实际端口填写" />
              </div>
              <div class="field">
                <label for="asset-relay-node-id">业务入口节点 ID</label>
                <input id="asset-relay-node-id" name="relay_node_id" placeholder="如果已纳管，可填写 node_xxx" />
              </div>
              <div class="field">
                <label for="asset-relay-label">业务入口节点名称</label>
                <input id="asset-relay-label" name="relay_label" placeholder="例如 alpine-hkg-01" />
              </div>
              <div class="field">
                <label for="asset-relay-region">业务入口区域补充</label>
                <input id="asset-relay-region" name="relay_region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
              </div>
              <div class="field full">
                <label>续费方式</label>
                <label class="check-row">
                  <input id="asset-auto-renew" name="auto_renew" type="checkbox" />
                  <span>开启自动续费</span>
                </label>
              </div>
              <div class="field">
                <label for="asset-bandwidth">带宽 Mbps</label>
                <input id="asset-bandwidth" name="bandwidth_mbps" type="number" min="0" placeholder="例如 300" />
              </div>
              <div class="field">
                <label for="asset-traffic-quota">流量总额 GB</label>
                <input id="asset-traffic-quota" name="traffic_quota_gb" type="number" min="0" placeholder="例如 2000" />
              </div>
              <div class="field">
                <label for="asset-traffic-used">已用流量 GB</label>
                <input id="asset-traffic-used" name="traffic_used_gb" type="number" min="0" placeholder="例如 320" />
              </div>
              <div class="field full">
                <label for="asset-route-note">业务链路说明</label>
                <textarea id="asset-route-note" name="route_note" placeholder="例如：中国 -> 香港中转 -> 新加坡落地。"></textarea>
              </div>
              <div class="field full">
                <label>管理链路</label>
                <div class="field-note">专门描述控制面怎么 SSH 接管这台节点，可填纳管跳板，或未纳管的独立 SSH 代理主机。</div>
              </div>
              <div class="field">
                <label for="asset-management-access-mode">管理接入方式</label>
                <select id="asset-management-access-mode" name="management_access_mode">
                  <option value="direct">SSH 直连</option>
                  <option value="relay">SSH 经中转</option>
                </select>
              </div>
              <div class="field">
                <label for="asset-management-ssh-user">SSH 用户</label>
                <input id="asset-management-ssh-user" name="management_ssh_user" placeholder="例如 root / admin" />
              </div>
              <div class="field">
                <label for="asset-management-relay-node-id">管理跳板节点 ID</label>
                <input id="asset-management-relay-node-id" name="management_relay_node_id" placeholder="如果已纳管，可填写 node_xxx" />
              </div>
              <div class="field">
                <label for="asset-management-relay-label">管理跳板名称</label>
                <input id="asset-management-relay-label" name="management_relay_label" placeholder="例如 hk-jump-01" />
              </div>
              <div class="field">
                <label for="asset-management-relay-region">管理跳板区域</label>
                <input id="asset-management-relay-region" name="management_relay_region" data-location-scope="region" autocomplete="off" placeholder="例如 香港 / Hong Kong / HKG" />
              </div>
              <div class="field">
                <label for="asset-management-proxy-host">SSH 代理主机</label>
                <input id="asset-management-proxy-host" name="management_proxy_host" placeholder="未纳管代理可填域名或 IP，例如 hk-proxy.example.com" />
              </div>
              <div class="field">
                <label for="asset-management-proxy-port">SSH 代理端口</label>
                <input id="asset-management-proxy-port" name="management_proxy_port" type="number" min="1" max="65535" placeholder="默认 22，按代理机实际端口填写" />
              </div>
              <div class="field">
                <label for="asset-management-proxy-user">SSH 代理用户</label>
                <input id="asset-management-proxy-user" name="management_proxy_user" placeholder="例如 jump / root" />
              </div>
              <div class="field">
                <label for="asset-management-proxy-label">SSH 代理备注名</label>
                <input id="asset-management-proxy-label" name="management_proxy_label" placeholder="例如 香港代理 / 东京堡垒机" />
              </div>
              <div class="field full">
                <label for="asset-management-route-note">管理链路说明</label>
                <textarea id="asset-management-route-note" name="management_route_note" placeholder="例如：控制面 -> 香港 SSH 代理 -> 节点。"></textarea>
              </div>
              <div class="field full">
                <label for="asset-note">备注</label>
                <textarea id="asset-note" name="note" placeholder="例如：已自动注册，账目信息后补。"></textarea>
                <div class="field-note">自动注册节点的系统信息继续来自 bootstrap，上面这些资产字段则允许你后补和维护。</div>
              </div>
              <div class="field full">
                <div class="modal-actions">
                  <button class="button primary" type="submit">保存资产信息</button>
                  <button class="button ghost" type="button" id="asset-reset">恢复当前值</button>
                </div>
                <div id="asset-message"></div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  return {
    assetModalTemplate,
    manualModalTemplate,
  };
}
