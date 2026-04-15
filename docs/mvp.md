# MVP

## Product goal

Build a lightweight control plane that can register, track, and operate low-memory VPS nodes from multiple providers with minimal software installed on each node.

## Non-goals for v1

- full auto-scaling
- billing reconciliation with every provider
- permanent heavy agent on nodes
- complex workflow engine
- full observability stack in this repository

## Milestone 1: Node registration

Success means a newly created VPS can run one bootstrap command and appear in the system with a stable node ID and normalized facts.

Deliverables:

- bootstrap registration API
- node fingerprint deduplication
- normalized fact schema
- node list API
- bootstrap response contract for follow-up actions

## Milestone 2: Node initialization

Success means the control plane can push a standard Alpine initialization workflow to newly registered nodes.

Deliverables:

- SSH credential handoff during bootstrap
- task records for initialization jobs
- command execution abstraction
- default init template for Alpine nodes

## Milestone 3: Health and state

Success means each node has a health summary and lifecycle state visible in the platform.

Deliverables:

- probe result ingestion
- status model: `new`, `active`, `degraded`, `failed`, `disabled`
- health score calculation
- action recommendations based on probe results

## Milestone 4: Lifecycle automation

Success means the system can rebuild or replace nodes through provider integrations.

Deliverables:

- provider adapter interface
- create and destroy flow
- post-create bootstrap workflow
- reconciliation loop for orphaned or failed nodes

## Recommended first engineering sequence

1. implement registration API and persistence
2. add bootstrap shell script
3. add SSH key exchange and task queue
4. add node probe ingestion and health scoring
5. add one provider adapter end to end
