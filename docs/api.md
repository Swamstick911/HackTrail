# Local collector API

The default base URL is `http://127.0.0.1:47654/api`. Request and response bodies use JSON, except a successful deletion returns no body.

## Access

Send `Authorization: Bearer <token>` with project, event, and import requests. Read the token from `.hacktrail/collector.token` in the selected data directory. Do not commit it or include it in exports.

`GET /health` returns service status without authentication. `GET /session` lets the local browser bootstrap its token. Both still enforce the Host and Origin checks. Non-browser local clients can also access the bootstrap endpoint; the token does not isolate different users on the same machine.

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

- Sources: `claude-code`, `vscode`, `git`, `manual`.
- Actors: `user`, `agent`, `tool`, `unknown`.
- Kinds: `user_prompt`, `agent_response`, `tool_call`, `tool_result`, `editor_edit`, `editor_focus`, `git_commit`.
- Optional metadata: `toolName`, `callId`, and `model` up to 160 characters; `success` as a boolean; `excerpt` up to 500 characters.
- Optional evidence: `{ "fileName": "session.jsonl", "line": 1, "block": 0 }`. Lines start at 1; blocks start at 0. Directory paths are rejected.

Unknown fields are rejected. Timestamps must include a timezone and are normalized to UTC. Actor and source values are supplied evidence labels, not verified identities. The schema reserves editor and Git values for future adapters; no such adapters ship in Phase 1.

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
