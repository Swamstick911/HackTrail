# Local collector API

The default base URL is `http://127.0.0.1:47654/api`. Request and response bodies use JSON, except a successful deletion returns no body.

## Access

Send `Authorization: Bearer <token>` with project, event, and import requests. Read the token from `.hacktrail/collector.token` in the selected data directory. Do not commit it or include it in exports.

`GET /health` returns service status, `service: "hacktrail"`, the version, and `setupVersion: 1` without authentication. `GET /session` lets the local browser bootstrap its token. Both still enforce the Host and Origin checks. Non-browser local clients can also access the bootstrap endpoint; the token does not isolate different users on the same machine.

Only loopback hosts on the configured port are allowed. Production browser requests must use the collector's own origin. Cross-site browser requests are rejected, and no CORS access is enabled.

## Routes

| Method | Path                    | Behavior                                               |
| ------ | ----------------------- | ------------------------------------------------------ |
| GET    | `/projects`             | List projects and event counts                         |
| POST   | `/projects`             | Create a project from `{ "name": "My project" }`       |
| DELETE | `/projects/:id`         | Remove a project and its events; returns 204           |
| GET    | `/projects/:id/events`  | Read a page of timeline events                         |
| GET    | `/projects/:id/summary` | Return counts by actor and source                      |
| GET    | `/projects/:id/export`  | Export all project events as JSON                      |
| POST   | `/events`               | Accept a batch of 1 to 500 normalized events           |
| POST   | `/imports/preview`      | Validate an import without saving it                   |
| POST   | `/imports/claude`       | Save a validated Claude transcript import              |
| POST   | `/example`              | Add the labeled synthetic example, skipping duplicates |

Only set `Content-Type: application/json` when sending a JSON body.

## Workspace setup

`POST /workspaces/resolve` accepts `{ "key": "64-character SHA-256 hex digest", "name": "Folder name", "projectId": "optional-existing-project" }` and returns the project. It requires authentication. The extension hashes the canonical folder path locally; it never sends the absolute path.

Without `projectId`, the route returns the linked project or creates one atomically. Providing an existing real project links the folder to it instead. Example projects cannot be used for tracking. Deleting a project cascades its workspace links. Repeated requests reuse the same project.

## Events

Use the project ID returned by project creation. A batch body has an `events` array:

```json
{
  "events": [
    {
      "schemaVersion": 1,
      "id": "example-event-001",
      "projectId": "replace-with-project-id",
      "occurredAt": "2026-01-15T10:00:00Z",
      "source": "manual",
      "actor": "user",
      "kind": "user_prompt",
      "metadata": {}
    }
  ]
}
```

- Sources: `claude-code`, `codex`, `vscode`, `git`, `manual`.
- Actors: `user`, `agent`, `tool`, `unknown`.
- Kinds: `user_prompt`, `agent_response`, `tool_call`, `tool_result`, `editor_edit`, `editor_focus`, `git_commit`, `git_checkpoint`, `work_note`, `agent_started`, `agent_stopped`.
- Optional metadata: `toolName`, `callId`, `model`, `sessionId`, and `hook` up to 160 characters; `success` as a boolean; `excerpt` up to 500 characters.
- Optional evidence: `{ "fileName": "session.jsonl", "line": 1, "block": 0 }`. Lines start at 1; blocks start at 0. Directory paths are rejected.

Unknown fields are rejected. Timestamps must include a timezone and are normalized to UTC. Actor and source values are supplied evidence labels, not verified identities. The VS Code adapter uses the timing endpoint below. The live Git adapter emits `git_checkpoint`; `git_commit` remains available for imported evidence. See Git and Codex evidence below for the additional metadata fields.

The response is `{ "inserted": 1, "duplicates": 0 }`. Replaying an identical normalized event ID is safe. Reusing an ID with different contents returns 409 and rolls back the entire batch.

## Timeline

Optional query parameters:

| Parameter | Behavior                                         |
| --------- | ------------------------------------------------ |
| `limit`   | 1 to 200; defaults to 60                         |
| `actor`   | One of the actor labels above                    |
| `source`  | One of the source labels above                   |
| `search`  | Up to 100 characters; searches stored event JSON |
| `cursor`  | Opaque `nextCursor` from the previous response   |

Responses contain `events`, `total`, and `nextCursor`. Events are newest first, ordered by timestamp and ID. Keep the filters unchanged when following a cursor. Counts describe recorded activity and do not award hours.

## Live tracking

| Method | Path                   | Behavior                                              |
| ------ | ---------------------- | ----------------------------------------------------- |
| POST   | `/tracking/heartbeat`  | Record an editor heartbeat and up to 500 time samples |
| POST   | `/tracking/pause`      | Pause or resume all editor collection                 |
| GET    | `/projects/:id/work`   | Read time slices and the review summary for a range   |
| POST   | `/projects/:id/notes`  | Save a work note from `{ "text": "What changed" }`    |
| GET    | `/integrations`        | Report whether the VSIX package is available          |
| GET    | `/integrations/vscode` | Download the built VS Code extension                  |

`POST /tracking/heartbeat` accepts:

```json
{
  "clientId": "editor-workspace-001",
  "projectId": "replace-with-project-id",
  "label": "VS Code",
  "state": "active",
  "samples": [
    {
      "id": "sample-unique-001",
      "projectId": "replace-with-project-id",
      "startedAt": "2026-11-20T10:00:00Z",
      "endedAt": "2026-11-20T10:00:15Z",
      "signal": "keyboard"
    }
  ]
}
```

Use current timestamps. States are `active`, `idle`, or `paused`; signals are `keyboard` or `mouse`. Empty sample arrays update connection status without claiming time. Samples must belong to the selected project, last at most 30 seconds, and be no more than seven days old or five seconds in the future.

The response contains `inserted`, `duplicates`, `creditedMs`, and `paused`. Here `creditedMs` means milliseconds retained by the estimator after removing overlaps and paused periods. It is not approved or verified human time.

Replays require the same sample content and client ID. Overlaps are removed across all projects, with first acceptance deciding attribution. An invalid or conflicting sample rolls back the whole batch.

`POST /tracking/pause` accepts `{ "paused": true }` or `false`. Pause intervals persist across restarts and apply to delayed uploads too.

`GET /projects/:id/work?from=...&to=...` requires ISO timestamps for a range of up to 32 days. It returns `tracking` with counted slices, total milliseconds, clients, pause state, and policy; and `review` with event counts, notes, recent Git checkpoints, per-source hook timestamps, agent elapsed time, and incomplete or interrupted runs. `editorMs` and `agentMs` are independently merged elapsed intervals; `overlapMs` is their intersection. `editorWithoutAgentMs` and `agentWithoutEditorMs` subtract that intersection from the corresponding clock. None is approved productive-struggle time. Clients become disconnected after 45 seconds without a heartbeat.

Project exports include a `tracking` object containing original samples and counted slices in addition to events. Deletion removes time records and client connections along with the project.

## Claude imports

Preview and commit accept the same body:

```json
{
  "projectId": "replace-with-project-id",
  "fileName": "session.jsonl",
  "text": "JSONL file contents",
  "includeExcerpts": false
}
```

Files are limited to 10 MB and 20,000 normalized events. A malformed JSON line rejects the file before any events are saved. Unsupported records, system/meta messages, and model reasoning are ignored. Tool results remain tool activity even when their enclosing message uses the user role.

Preview returns `eventCount`, record counts, and up to five sample events. It does not persist data or reserve IDs. Commit returns `inserted`, `duplicates`, and `ignoredRecords`.

IDs derive from the project, session, record, and content-block position. Reimports must preserve the file name, existing lines, and excerpt setting. Editing any stored evidence for an existing ID produces a conflict. The importer stores selected metadata and optional excerpts, not raw transcripts or tool arguments/output.

## Errors

Errors have the form `{ "error": "Readable explanation" }`.

| Status | Meaning                                  |
| ------ | ---------------------------------------- |
| 400    | Invalid fields or cursor                 |
| 401    | Missing or invalid local token           |
| 403    | Host or origin is not allowed            |
| 404    | Project does not exist                   |
| 409    | Existing event ID has different contents |
| 413    | Request or import exceeds its limit      |
| 422    | Malformed or unsupported transcript      |
| 500    | Collector failed to complete the request |

## Git and Codex evidence

`codex` is a supported event source. Hook metadata may include `turnId` and `interrupted`. Pair agent boundaries by source, session, and turn ID; do not combine different agents with identical session IDs.

`git_checkpoint` events use source `git` and actor `unknown`. Metadata contains `git` with a 64-character hexadecimal `repositoryId`, a 40- or 64-character hexadecimal `commit`, and an optional `branch` of up to 160 characters. `checkpointReason` is `connected`, `head-changed`, or `history-changed`. Aggregate `filesChanged`, `linesAdded`, and `linesDeleted` are optional nonnegative integers. They describe differences between observations, not effort or authored changes.

Heartbeat samples may include the same optional `git` context. Reports preserve it on counted slices, including clipped slices. Adding Git context never increases counted time. Health includes `evidenceVersion: 1` so updated extensions reject collectors that cannot accept these fields.
