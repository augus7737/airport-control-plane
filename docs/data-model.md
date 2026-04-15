# Data Model

## Node

Represents one managed VPS.

Core fields:

- `id`
- `fingerprint`
- `hostname`
- `status`
- `provider`
- `provider_node_id`
- `region`
- `public_ipv4`
- `public_ipv6`
- `private_ipv4`
- `public_ipv4_source`
- `public_ipv6_source`
- `public_ipv4_location`
- `public_ipv6_location`
- `public_ipv4_owner`
- `public_ipv6_owner`
- `os_name`
- `os_version`
- `arch`
- `kernel_version`
- `cpu_cores`
- `memory_mb`
- `disk_gb`
- `ssh_port`
- `registered_at`
- `last_seen_at`
- `last_probe_at`
- `health_score`
- `bootstrap_token_id`
- `commercial.expires_at`
- `commercial.auto_renew`
- `commercial.bandwidth_mbps`
- `commercial.traffic_quota_gb`
- `commercial.traffic_used_gb`
- `commercial.billing_cycle`
- `commercial.note`
- `networking.access_mode`
- `networking.entry_region`
- `networking.relay_node_id`
- `networking.relay_label`
- `networking.relay_region`
- `networking.route_note`

Notes:

- `last_probe_at` is refreshed by both automatic first probes and later manual re-probes
- `health_score` and `status` may be updated after each probe result is written back

### Networking fields

When a node cannot be reached directly from the target entry region, record the upstream route explicitly:

- `networking.access_mode`: `direct` or `relay`
- `networking.entry_region`: where the user first enters the network, such as `中国大陆` or `香港`
- `networking.relay_node_id`: optional internal node ID of the relay/jump node
- `networking.relay_label`: human-readable relay node name when the internal node ID is not known yet
- `networking.relay_region`: relay node region such as `HKG`
- `networking.route_note`: free-form note for the route, such as `中国大陆 -> 香港中转 -> 日本落地`

## BootstrapToken

Controls who may enroll nodes.

Core fields:

- `id`
- `token`
- `label`
- `status`
- `expires_at`
- `max_uses`
- `uses`
- `created_at`
- `last_used_at`
- `last_used_node_id`
- `note`

## AccessUser

Represents one internal proxy access identity managed by the control plane.

Core fields:

- `id`
- `name`
- `protocol`
- `credential.uuid`
- `credential.alter_id` (for `vmess`)
- `status`
- `expires_at`
- `profile_id`
- `node_group_ids[]`
- `note`
- `created_at`
- `updated_at`

Notes:

- current version supports internal `vless` / `vmess` access identities
- `profile_id` points to one `ProxyProfile`
- `node_group_ids` describes the default release scope for this user

## ProxyProfile

Represents one reusable protocol template.

Core fields:

- `id`
- `name`
- `protocol`
- `listen_port`
- `transport`
- `security`
- `tls_enabled`
- `reality_enabled`
- `server_name`
- `flow`
- `mux_enabled`
- `tag`
- `template`
- `status`
- `note`
- `created_at`
- `updated_at`

Notes:

- current version supports `vless` and `vmess`
- `template` stores the managed profile payload that later renders into node-side config

## NodeGroup

Represents one managed release scope.

Core fields:

- `id`
- `name`
- `type`
- `status`
- `node_ids[]`
- `filters`
- `note`
- `created_at`
- `updated_at`

Notes:

- current MVP only supports static groups
- future versions may add rule-based groups by country, provider, route, or health

## ConfigRelease

Represents one publish action that binds users, template, and nodes together.

Core fields:

- `id`
- `type`
- `title`
- `status`
- `operator`
- `access_user_ids[]`
- `profile_id`
- `node_group_ids[]`
- `node_ids[]`
- `operation_id`
- `task_ids[]`
- `version`
- `summary.total_nodes`
- `summary.success_nodes`
- `summary.failed_nodes`
- `summary.access_user_count`
- `summary.active_user_count`
- `summary.skipped_user_count`
- `summary.profile_name`
- `summary.engine`
- `summary.action_type`
- `summary.delivery_mode`
- `summary.rollbackable`
- `summary.based_on_release_id`
- `summary.rollback_target_release_id`
- `summary.config_digest_before`
- `summary.config_digest_after`
- `summary.change_summary`
- `summary.apply_summary.total`
- `summary.apply_summary.success`
- `summary.apply_summary.failed`
- `summary.apply_summary.applied`
- `summary.apply_summary.rendered_only`
- `summary.apply_summary.rolled_back`
- `summary.failed_nodes_sample[]`
- `note`
- `created_at`
- `started_at`
- `finished_at`

Notes:

- each release reuses the existing batch `OperationRun`
- node-level publish progress is tracked through `Task` records linked by `task_ids`
- first real engine is `sing-box`, focused on `VLESS`
- release digests are used to tell whether the rendered config changed between versions

## Task

Represents an asynchronous operation initiated by the platform.

Core fields:

- `id`
- `node_id`
- `type`
- `title`
- `status`
- `template`
- `trigger`
- `payload`
- `attempt`
- `created_at`
- `scheduled_at`
- `updated_at`
- `started_at`
- `finished_at`
- `operation_id`
- `note`
- `log_excerpt`

Examples:

- `bootstrap_finalize`
- `init_alpine`
- `probe_node`
- `publish_proxy_config`
- `restart_service`
- `panel_enroll`
- `provider_replace`

Typical `trigger` values:

- `bootstrap_register`: created automatically when a node first enrolls
- `bootstrap_refresh`: reused or refreshed when an existing node reports again
- `bootstrap_auto_probe`: automatic first probe chained after successful init
- `scheduled_probe`: background periodic inspection created by the control plane scheduler
- `manual_probe`: operator-triggered manual re-probe from the console

## OperationRun

Represents one batch shell or script execution initiated from the web console.

Core fields:

- `id`
- `created_at`
- `started_at`
- `finished_at`
- `duration_ms`
- `operator`
- `mode`
- `title`
- `command`
- `script_name`
- `script_body`
- `status`
- `summary.total`
- `summary.success`
- `summary.failed`
- `node_ids`
- `targets[].node_id`
- `targets[].hostname`
- `targets[].provider`
- `targets[].region`
- `targets[].access_mode`
- `targets[].summary`
- `targets[].status`
- `targets[].output[]`
- `targets[].output_text`
- `targets[].exit_code`
- `targets[].signal`
- `targets[].timed_out`
- `targets[].transport_kind`
- `targets[].transport_label`
- `targets[].transport_note`
- `targets[].started_at`
- `targets[].finished_at`
- `targets[].duration_ms`

## ProbeResult

Stores network and service quality observations.

Core fields:

- `id`
- `node_id`
- `task_id`
- `probe_type`
- `target`
- `target_host`
- `target_port`
- `access_mode`
- `transport_kind`
- `transport_label`
- `latency_ms`
- `packet_loss_ratio`
- `success`
- `control_ready`
- `reason_code`
- `summary`
- `error_stage`
- `error_message`
- `stderr_excerpt`
- `stages.tcp`
- `stages.ssh`
- `observed_at`

Examples:

- `tcp_ssh`
- `ssh_auth`

Notes:

- `ProbeResult.reason_code` is the compact reason used by the UI to map health status and recommendations
- `stages.tcp` records the first-hop TCP result, while `stages.ssh` records the SSH takeover verification result or the reason it was skipped

## PanelBinding

Tracks an external system enrollment.

Core fields:

- `id`
- `node_id`
- `panel_type`
- `remote_id`
- `status`
- `synced_at`

## ProviderBinding

Tracks cloud provider metadata.

Core fields:

- `id`
- `node_id`
- `provider`
- `account_name`
- `region`
- `instance_type`
- `billing_cycle`
- `expires_at`
- `remote_id`

## State transitions

Recommended initial node states:

- `new`
- `active`
- `degraded`
- `failed`
- `disabled`
- `retired`
