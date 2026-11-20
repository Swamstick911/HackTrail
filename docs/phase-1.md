# Phase 1 implementation plan

Deliver a local collector and timeline before live integrations or time estimates.

## Scope

- Strict versioned events, with source and actor labels.
- Project creation, authenticated loopback API, and SQLite persistence.
- Idempotent batches: replays are safe; changed duplicate IDs are rejected.
- Explicit import of a selected Claude JSONL file. No home-directory scanning.
- Metadata by default; excerpts only when enabled for an import.
- Project timeline, filters, evidence details, and JSON export.
- Labeled synthetic example data and automated API, import, and browser checks.

## Boundaries

Actor labels describe source records, not verified authorship or presence. Tool results in user-role messages remain tool activity. Ignore model reasoning, system instructions, and unrelated records. Agent runtime and window focus do not establish human working time. Phase 1 awards no time credit.

Store source file names and record references, not absolute paths. Keep imported content local and out of Git. Bound file and batch sizes; treat imported text as data. Local API access requires a token stored with owner-only permissions. Validate Host and Origin and bind to loopback. Evidence export does not prove honest activity.

## Milestones

1. Dependencies, license, and configuration.
2. Event schema, transactional storage, local API, and importer.
3. Timeline, example data, evidence view, and export.
4. Browser checks, platform CI, usage docs, and release commit.

## Follow-up

Phase 2 adds VS Code and Claude live adapters, queueing, and sleep/restart handling. Time estimation remains a separate experiment using consented reference sessions. Benchmark on the Dell Inspiron 5775 with 8 GB RAM and SSD; CI does not substitute for on-device testing.

Later phases add resume views, review workflows, accounts, public profiles, broader adapters, scale tests, and adoption. All eleven bounty requirements and the weighted-project acceptance condition remain relevant.

## Commits

Use conventional commits with the repository owner's identity. No co-author or generated-by trailers.
