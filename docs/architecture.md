# Architecture

## Design principles

- Centralized control: scheduling, decision-making, and state live in the control plane.
- Agentless by default: nodes register once, then the platform uses SSH or one-shot commands.
- Lightweight edge footprint: Alpine nodes should only need shell, curl, and OpenSSH.
- Replaceable integrations: cloud providers, probes, and panel adapters should be pluggable.
- Event-friendly core: node state changes should trigger follow-up actions without tight coupling.

## Core components

### 1. API server

Responsibilities:

- receive bootstrap registrations
- expose node and task APIs
- validate and normalize incoming facts
- return next actions to bootstrap clients

### 2. Inventory service

Responsibilities:

- store node records
- deduplicate by fingerprint and provider identifiers
- track lifecycle state, labels, and ownership
- attach provider and panel metadata

### 3. Task orchestrator

Responsibilities:

- queue initialization and maintenance jobs
- schedule SSH-based execution
- track run logs and retries
- emit state transition events

### 4. Probe service

Responsibilities:

- trigger active probes from the control plane
- ingest external probe results
- compute node health summaries
- raise action suggestions for unhealthy nodes

### 5. Provider adapters

Responsibilities:

- create and destroy VPS instances
- attach metadata and tags
- return provider-specific identifiers
- surface provisioning failures

### 6. Panel adapters

Responsibilities:

- enroll nodes into external systems
- push or sync node metadata
- update platform records with remote IDs

## Control flow

### Bootstrap registration

1. operator runs one bootstrap command on a node
2. node collects local facts
3. node posts to `/api/v1/nodes/register`
4. platform deduplicates and creates or updates the node record
5. platform returns `node_id`, SSH material instructions, and next actions
6. orchestrator schedules initialization tasks

### Ongoing operations

1. probe service updates health data
2. health score changes node status
3. task orchestrator decides whether to retry, repair, or disable
4. provider adapters may create replacement nodes later

## Suggested future deployment topology

- `api`: core HTTP API
- `worker`: async task execution
- `postgres`: system of record
- `redis`: queue and transient coordination
- `blackbox_exporter`: remote probe executor
- `grafana/prometheus`: external observability stack

## Suggested v1 implementation shape

Even if production later moves to Go, the domain boundaries should stay the same:

- `src/domain`: entities and policies
- `src/application`: use cases
- `src/adapters`: HTTP, SSH, provider, and panel integrations
- `src/infrastructure`: persistence and queueing
