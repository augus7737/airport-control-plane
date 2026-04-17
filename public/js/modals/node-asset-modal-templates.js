export function createNodeAssetModalTemplatesModule() {
  function manualModalTemplate() {
    return `
      <div class="modal-backdrop" id="manual-modal">
        <div class="modal wide asset-editor-modal">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>手动录入节点</h3>
                <p>在厂商 API 还没接入前，先把节点的经营信息和技术信息手工收进平台，后面再逐步切换成自动同步。</p>
              </div>
              <button class="close" id="close-manual-modal" aria-label="关闭">×</button>
            </div>

            <form id="manual-node-form" class="form-grid node-asset-form">
              <div class="field full section-intro">
                <label>资产归属</label>
                <div class="field-note">先录稳定台账：名称、厂商、国家和基础公网信息；业务入口与 SSH 跳板收进高级区，避免首次录入被链路字段淹没。</div>
              </div>
              <div class="field">
                <label for="manual-hostname">节点名称</label>
                <input id="manual-hostname" name="hostname" placeholder="例如 alpine-hkg-04" required />
              </div>
              <div class="field">
                <label for="manual-provider">云厂商</label>
                <input id="manual-provider" name="provider" placeholder="未建档厂商时再手填展示名" />
              </div>
              <div class="field">
                <label for="manual-provider-id">厂商台账</label>
                <select id="manual-provider-id" name="provider_id">
                  <option value="">未绑定厂商台账</option>
                </select>
                <div class="field-note">优先绑定稳定 provider_id，云厂商文本继续保留给兼容展示。</div>
              </div>
              <div class="field">
                <label for="manual-region">国家</label>
                <input
                  id="manual-region"
                  name="region"
                  data-location-scope="region"
                  placeholder="支持输入国家、英文或 ISO，例如 越南 / Vietnam / VN"
                  spellcheck="false"
                />
                <div class="field-note">支持中文、英文、机场码和 ISO 代码联想，保存后统一归一成国家级标签。</div>
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
                <label for="manual-memory">内存 MB</label>
                <input id="manual-memory" name="memory_mb" type="number" min="0" placeholder="例如 1024" />
              </div>
              <div class="field full section-intro">
                <label>账单成本</label>
                <div class="field-note">月成本、超额成本和厂商汇总都以这里的原始账单字段实时折算。</div>
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
                  <option value="周付">周付</option>
                  <option value="日付">日付</option>
                  <option value="小时付">小时付</option>
                  <option value="一次性">一次性</option>
                </select>
              </div>
              <div class="field">
                <label for="manual-billing-amount">账单金额</label>
                <input id="manual-billing-amount" name="billing_amount" type="number" min="0" step="0.01" placeholder="例如 12.5" />
              </div>
              <div class="field">
                <label for="manual-billing-currency">币种</label>
                <select id="manual-billing-currency" name="billing_currency">
                  <option value="">未填写</option>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="EUR">EUR</option>
                  <option value="HKD">HKD</option>
                  <option value="JPY">JPY</option>
                  <option value="GBP">GBP</option>
                  <option value="SGD">SGD</option>
                </select>
              </div>
              <div class="field">
                <label for="manual-amortization-months">折旧月数</label>
                <input id="manual-amortization-months" name="amortization_months" type="number" min="1" step="1" placeholder="一次性账单常用，例如 24" />
              </div>
              <div class="field">
                <label for="manual-overage-price">超额单价 / GB</label>
                <input id="manual-overage-price" name="overage_price_per_gb" type="number" min="0" step="0.01" placeholder="例如 0.8" />
              </div>
              <div class="field">
                <label for="manual-extra-fixed-cost">额外月固定成本</label>
                <input id="manual-extra-fixed-cost" name="extra_fixed_monthly_cost" type="number" min="0" step="0.01" placeholder="例如 3" />
              </div>
              <div class="field">
                <label for="manual-billing-started-at">账单开始时间</label>
                <input id="manual-billing-started-at" name="billing_started_at" type="date" />
              </div>
              <div class="field full">
                <details class="modal-advanced-section" id="manual-routing-advanced">
                  <summary>
                    <span>高级链路配置</span>
                    <span class="tiny">仅在做入口或 SSH 跳板时展开</span>
                  </summary>
                  <div class="modal-advanced-grid">
                    <div class="field full">
                      <label>业务链路</label>
                      <div class="field-note">只描述用户流量如何进入线路，例如直连，或“中国大陆 -> 香港入口 -> 美国落地”。</div>
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
                      <input
                        id="manual-entry-region"
                        name="entry_region"
                        data-location-scope="entry"
                        placeholder="支持输入 香港 / HK / HKG / Japan"
                        spellcheck="false"
                      />
                    </div>
                    <div class="field" data-business-relay-field>
                      <label for="manual-entry-port">业务入口端口</label>
                      <input id="manual-entry-port" name="entry_port" type="number" min="1" max="65535" placeholder="中转入口监听端口，例如 443 / 8443" />
                    </div>
                    <div class="field" data-business-relay-field>
                      <label for="manual-relay-node-id">业务入口节点</label>
                      <select id="manual-relay-node-id" name="relay_node_id">
                        <option value="">未选择已纳管入口节点</option>
                      </select>
                    </div>
                    <div class="field full" data-business-relay-field>
                      <label for="manual-route-note">业务链路说明</label>
                      <textarea id="manual-route-note" name="route_note" placeholder="例如：中国 -> 香港中转 -> 日本落地。"></textarea>
                    </div>
                    <div class="field full">
                      <label>管理链路</label>
                      <div class="field-note">这里只描述控制面如何 SSH 接管节点。管理入口填写平台真正连接的主机和端口；节点内部 sshd 监听端口通常仍是 22，不要和外部映射端口混填。</div>
                    </div>
                    <div class="field">
                      <label for="manual-management-access-mode">管理接入方式</label>
                      <select id="manual-management-access-mode" name="management_access_mode">
                        <option value="direct">SSH 直连</option>
                        <option value="relay">SSH 经中转</option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="manual-management-ssh-host">管理入口主机</label>
                      <input id="manual-management-ssh-host" name="management_ssh_host" placeholder="例如 151.242.85.89；留空时按节点公网/内网自动推导" />
                    </div>
                    <div class="field">
                      <label for="manual-management-ssh-port">管理入口端口</label>
                      <input id="manual-management-ssh-port" name="management_ssh_port" type="number" min="1" max="65535" value="19822" placeholder="平台对外连接入口，例如 19822" />
                      <div class="field-note">这里填控制面真正要连的外部端口，不是容器内 sshd 监听端口。</div>
                    </div>
                    <div class="field">
                      <label for="manual-management-ssh-user">SSH 用户</label>
                      <input id="manual-management-ssh-user" name="management_ssh_user" placeholder="例如 root / admin" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-relay-strategy">管理中转策略</label>
                      <select id="manual-management-relay-strategy" name="management_relay_strategy">
                        <option value="auto">自动</option>
                        <option value="tcp_forward">TCP 转发</option>
                        <option value="exec_nc">NC 桥接</option>
                      </select>
                      <div class="field-note">自动模式会优先使用标准 SSH TCP 转发；如果跳板禁用 tcp forwarding，会自动退回到 NC 桥接。</div>
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-relay-node-id">管理跳板节点</label>
                      <select id="manual-management-relay-node-id" name="management_relay_node_id">
                        <option value="">未选择已纳管跳板</option>
                      </select>
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-proxy-host">SSH 代理主机</label>
                      <input id="manual-management-proxy-host" name="management_proxy_host" placeholder="未纳管代理可填域名或 IP，例如 hk-proxy.example.com" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-proxy-port">SSH 代理端口</label>
                      <input id="manual-management-proxy-port" name="management_proxy_port" type="number" min="1" max="65535" placeholder="默认 22，按代理机实际端口填写" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-proxy-user">SSH 代理用户</label>
                      <input id="manual-management-proxy-user" name="management_proxy_user" placeholder="例如 jump / root" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="manual-management-proxy-label">SSH 代理备注名</label>
                      <input id="manual-management-proxy-label" name="management_proxy_label" placeholder="例如 香港代理 / 东京堡垒机" />
                    </div>
                    <div class="field full" data-management-relay-field>
                      <label for="manual-management-route-note">管理链路说明</label>
                      <textarea id="manual-management-route-note" name="management_route_note" placeholder="例如：控制面 -> 香港 SSH 代理 -> 目标节点。"></textarea>
                    </div>
                  </div>
                </details>
              </div>
              <div class="field full">
                <label>续费方式</label>
                <label class="check-row">
                  <input id="manual-auto-renew" name="auto_renew" type="checkbox" />
                  <span>开启自动续费</span>
                </label>
              </div>
              <div class="field full">
                <label for="manual-cost-note">成本备注</label>
                <textarea id="manual-cost-note" name="cost_note" placeholder="例如：年付折算、带宽升级补差价、月底才结超额流量。"></textarea>
              </div>
              <div class="field full">
                <label for="manual-note">备注</label>
                <textarea id="manual-note" name="note" placeholder="例如：月底到期，先观察质量，再决定是否续费。"></textarea>
                <div class="field-note">这一步先解决“账目和资产台账”问题，等接入厂商 API 后再做自动同步。</div>
              </div>
              <div class="field full modal-footer-row">
                <div class="modal-actions">
                  <button class="button primary" type="submit">保存到节点清单</button>
                  <button class="button ghost" type="button" id="manual-reset">清空表单</button>
                </div>
                <div id="manual-message" aria-live="polite"></div>
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
        <div class="modal wide asset-editor-modal">
          <div class="modal-body">
            <div class="modal-head">
              <div>
                <h3>编辑资产信息</h3>
                <p>主表单只保留资产台账、成本和基础识别字段；业务链路与 SSH 管理链路收进高级区，避免资产编辑被链路配置淹没。</p>
                <div class="field-note node-summary-pill" id="asset-node-summary">当前编辑节点：-</div>
              </div>
              <button class="close" id="close-asset-modal" aria-label="关闭">×</button>
            </div>

            <form id="asset-form" class="form-grid node-asset-form">
              <div class="field full section-intro">
                <label>资产归属</label>
                <div class="field-note">固定项尽量用选择器，先把台账记清楚；国家级归属优先，不强迫你现在就录机房城市。</div>
              </div>
              <div class="field">
                <label for="asset-provider-id">厂商台账</label>
                <select id="asset-provider-id" name="provider_id">
                  <option value="">未绑定厂商台账</option>
                </select>
                <div class="field-note">优先绑定稳定 provider_id，后续汇总和预算才不会只靠文本名称对齐。</div>
              </div>
              <div class="field">
                <label for="asset-provider">厂商展示名</label>
                <input id="asset-provider" name="provider" placeholder="未建档厂商时再手填展示名" />
              </div>
              <div class="field">
                <label for="asset-region">国家</label>
                <input
                  id="asset-region"
                  name="region"
                  data-location-scope="region"
                  placeholder="支持输入国家、英文或 ISO，例如 马来西亚 / Malaysia / MY"
                  spellcheck="false"
                />
                <div class="field-note">支持中文、英文、机场码和 ISO 代码联想；保存后统一成国家级标签。</div>
              </div>
              <div class="field">
                <label for="asset-role">用途标签</label>
                <input id="asset-role" name="role" placeholder="例如 edge / backup / test" />
              </div>
              <div class="field full section-intro">
                <label>账单成本</label>
                <div class="field-note">月成本、超额成本和 Provider 汇总都以这里的原始账单字段实时折算。</div>
              </div>
              <div class="field">
                <label for="asset-billing">计费周期</label>
                <select id="asset-billing" name="billing_cycle">
                  <option value="">未填写</option>
                  <option value="月付">月付</option>
                  <option value="季付">季付</option>
                  <option value="年付">年付</option>
                  <option value="周付">周付</option>
                  <option value="日付">日付</option>
                  <option value="小时付">小时付</option>
                  <option value="一次性">一次性</option>
                </select>
              </div>
              <div class="field">
                <label for="asset-expire">到期时间</label>
                <input id="asset-expire" name="expires_at" type="date" />
              </div>
              <div class="field">
                <label for="asset-billing-amount">账单金额</label>
                <input id="asset-billing-amount" name="billing_amount" type="number" min="0" step="0.01" placeholder="例如 12.5" />
              </div>
              <div class="field">
                <label for="asset-billing-currency">币种</label>
                <select id="asset-billing-currency" name="billing_currency">
                  <option value="">未填写</option>
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="EUR">EUR</option>
                  <option value="HKD">HKD</option>
                  <option value="JPY">JPY</option>
                  <option value="GBP">GBP</option>
                  <option value="SGD">SGD</option>
                </select>
              </div>
              <div class="field">
                <label for="asset-amortization-months">折旧月数</label>
                <input id="asset-amortization-months" name="amortization_months" type="number" min="1" step="1" placeholder="一次性账单常用，例如 24" />
              </div>
              <div class="field">
                <label for="asset-overage-price">超额单价 / GB</label>
                <input id="asset-overage-price" name="overage_price_per_gb" type="number" min="0" step="0.01" placeholder="例如 0.8" />
              </div>
              <div class="field">
                <label for="asset-extra-fixed-cost">额外月固定成本</label>
                <input id="asset-extra-fixed-cost" name="extra_fixed_monthly_cost" type="number" min="0" step="0.01" placeholder="例如 3" />
              </div>
              <div class="field">
                <label for="asset-billing-started-at">账单开始时间</label>
                <input id="asset-billing-started-at" name="billing_started_at" type="date" />
              </div>
              <div class="field full section-intro">
                <label>基础网络与额度</label>
                <div class="field-note">这里只保留 IP 和资源额度这类基础识别信息；管理入口主机和端口放到“管理链路”里，避免继续和节点内部 sshd 监听端口混淆。</div>
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
                <details class="modal-advanced-section" id="asset-routing-advanced">
                  <summary>
                    <span>高级链路配置</span>
                    <span class="tiny">仅在做入口或 SSH 跳板时展开</span>
                  </summary>
                  <div class="modal-advanced-grid">
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
                      <input
                        id="asset-entry-region"
                        name="entry_region"
                        data-location-scope="entry"
                        placeholder="支持输入 香港 / HK / HKG / Japan"
                        spellcheck="false"
                      />
                    </div>
                    <div class="field" data-business-relay-field>
                      <label for="asset-entry-port">业务入口端口</label>
                      <input id="asset-entry-port" name="entry_port" type="number" min="1" max="65535" placeholder="中转入口监听端口，例如 443 / 8443" />
                    </div>
                    <div class="field" data-business-relay-field>
                      <label for="asset-relay-node-id">业务入口节点</label>
                      <select id="asset-relay-node-id" name="relay_node_id">
                        <option value="">未选择已纳管入口节点</option>
                      </select>
                    </div>
                    <div class="field full" data-business-relay-field>
                      <label for="asset-route-note">业务链路说明</label>
                      <textarea id="asset-route-note" name="route_note" placeholder="例如：中国 -> 香港中转 -> 新加坡落地。"></textarea>
                    </div>
                    <div class="field full">
                      <label>管理链路</label>
                      <div class="field-note">专门描述控制面怎么 SSH 接管这台节点。管理入口填写平台真正连接的主机和端口；节点内部 sshd 监听端口通常仍是 22，不要和外部映射端口混填。</div>
                    </div>
                    <div class="field">
                      <label for="asset-management-access-mode">管理接入方式</label>
                      <select id="asset-management-access-mode" name="management_access_mode">
                        <option value="direct">SSH 直连</option>
                        <option value="relay">SSH 经中转</option>
                      </select>
                    </div>
                    <div class="field">
                      <label for="asset-management-ssh-host">管理入口主机</label>
                      <input id="asset-management-ssh-host" name="management_ssh_host" placeholder="例如 151.242.85.89；留空时按节点公网/内网自动推导" />
                    </div>
                    <div class="field">
                      <label for="asset-management-ssh-port">管理入口端口</label>
                      <input id="asset-management-ssh-port" name="management_ssh_port" type="number" min="1" max="65535" placeholder="平台对外连接入口，例如 19822" />
                      <div class="field-note">这里填控制面真正要连的外部端口，不是容器内 sshd 监听端口。</div>
                    </div>
                    <div class="field">
                      <label for="asset-management-ssh-user">SSH 用户</label>
                      <input id="asset-management-ssh-user" name="management_ssh_user" placeholder="例如 root / admin" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-relay-strategy">管理中转策略</label>
                      <select id="asset-management-relay-strategy" name="management_relay_strategy">
                        <option value="auto">自动</option>
                        <option value="tcp_forward">TCP 转发</option>
                        <option value="exec_nc">NC 桥接</option>
                      </select>
                      <div class="field-note">自动模式会优先使用标准 SSH TCP 转发；如果跳板禁用 tcp forwarding，会自动退回到 NC 桥接。</div>
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-relay-node-id">管理跳板节点</label>
                      <select id="asset-management-relay-node-id" name="management_relay_node_id">
                        <option value="">未选择已纳管跳板</option>
                      </select>
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-proxy-host">SSH 代理主机</label>
                      <input id="asset-management-proxy-host" name="management_proxy_host" placeholder="未纳管代理可填域名或 IP，例如 hk-proxy.example.com" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-proxy-port">SSH 代理端口</label>
                      <input id="asset-management-proxy-port" name="management_proxy_port" type="number" min="1" max="65535" placeholder="默认 22，按代理机实际端口填写" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-proxy-user">SSH 代理用户</label>
                      <input id="asset-management-proxy-user" name="management_proxy_user" placeholder="例如 jump / root" />
                    </div>
                    <div class="field" data-management-relay-field>
                      <label for="asset-management-proxy-label">SSH 代理备注名</label>
                      <input id="asset-management-proxy-label" name="management_proxy_label" placeholder="例如 香港代理 / 东京堡垒机" />
                    </div>
                    <div class="field full" data-management-relay-field>
                      <label for="asset-management-route-note">管理链路说明</label>
                      <textarea id="asset-management-route-note" name="management_route_note" placeholder="例如：控制面 -> 香港 SSH 代理 -> 节点。"></textarea>
                    </div>
                  </div>
                </details>
              </div>
              <div class="field full">
                <label for="asset-cost-note">成本备注</label>
                <textarea id="asset-cost-note" name="cost_note" placeholder="例如：超额流量跟随厂商月底结算，带宽升级单独计费。"></textarea>
              </div>
              <div class="field full">
                <label for="asset-note">备注</label>
                <textarea id="asset-note" name="note" placeholder="例如：已自动注册，账目信息后补。"></textarea>
                <div class="field-note">自动注册节点的系统信息继续来自 bootstrap，上面这些资产字段则允许你后补和维护。</div>
              </div>
              <div class="field full modal-footer-row">
                <div class="modal-actions">
                  <button class="button primary" type="submit">保存资产信息</button>
                  <button class="button ghost" type="button" id="asset-reset">恢复当前值</button>
                </div>
                <div id="asset-message" aria-live="polite"></div>
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
