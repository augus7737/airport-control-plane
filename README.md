# Airport Control Plane

A lightweight multi-cloud node control platform for low-memory VPS fleets.

## Current scope

The first milestone focuses on:

- one-command node registration
- automatic fact collection
- centralized SSH-based management
- health probing and node state tracking
- future hooks for cloud provisioning and panel integration

## Project structure

- `docs/architecture.md`: system design and component boundaries
- `docs/mvp.md`: milestone planning and scope
- `docs/project-progress.md`: current delivery status and next priorities
- `docs/data-model.md`: core entities and relationships
- `docs/api.md`: initial API contract
- `src/server.js`: minimal control plane API skeleton

## Quick start

```bash
npm start
```

The server starts on `http://localhost:8080` by default.

Useful endpoints:

- `GET /healthz`
- `GET /api/v1/nodes`
- `POST /api/v1/nodes/register`

Bootstrap helper:

```bash
sh scripts/bootstrap.sh \
  --server http://localhost:8080 \
  --token demo-token
```

The control plane uses `19822` as the default SSH connection port when a node has
no explicit `ssh_port` recorded yet. `bootstrap.sh` itself will keep the current
node `sshd` port unless you pass `--ssh-port`, so it does not force-change the
host's default SSH port behavior.

When the node's outbound public IP is not the same as its inbound SSH entrypoint
(for example NAT, LXC/LXD, host port mapping, or relay-style providers), override
the reported ingress endpoint explicitly:

```bash
sh scripts/bootstrap.sh \
  --server http://localhost:8080 \
  --token demo-token \
  --public-ipv4 203.0.113.10 \
  --ssh-port 2222
```

You can also override `--public-ipv6`, `--private-ipv4`, and `--ssh-user` when
the node facts need to reflect the real SSH ingress user or routing path.

Example registration request:

```bash
curl -X POST http://localhost:8080/api/v1/nodes/register \
  -H 'content-type: application/json' \
  -d '{
    "bootstrap_token": "demo-token",
    "fingerprint": "sha256:example-fingerprint",
    "facts": {
      "hostname": "alpine-sin-01",
      "os_name": "Alpine Linux",
      "os_version": "3.21",
      "arch": "x86_64",
      "public_ipv4": "203.0.113.10",
      "private_ipv4": "10.0.0.10",
      "cpu_cores": 1,
      "memory_mb": 512
    }
  }'
```

## Production Deployment

Recommended current production form:

- single host
- Docker container for the control plane
- bind-mounted `data-prod/` for persistent JSON data and SSH material
- HTTPS terminated by a reverse proxy

One-command deployment on a clean server:

```bash
bash install.sh
```

The deployment script will:

- generate `.env.production`
- generate a random admin password if needed
- create `data-prod/`
- build an image that already includes Node runtime and production npm dependencies
- prefer Compose when available
- automatically fall back to plain `docker build + docker run` when Compose is unavailable
- wait for the container health check to pass before treating the deployment as successful

The production host only needs Docker and OpenSSL. It does not need host-level Node.js or npm.

See `docs/deployment.md` for the full production guide.

## Product direction

This repository starts with a thin control-plane core. It is expected to integrate with:

- OpenTofu for multi-cloud provisioning
- SSH or Ansible for remote execution
- Prometheus blackbox_exporter for probing
- external panel adapters for post-registration onboarding
