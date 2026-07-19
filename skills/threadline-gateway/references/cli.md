# Threadline CLI reference

## Configuration

Prefer environment variables in Agent environments:

```text
THREADLINE_URL=https://threadline.example.com
THREADLINE_TOKEN=<secret>
THREADLINE_ACTOR_TYPE=agent
THREADLINE_ACTOR_NAME=<agent name>
THREADLINE_TOOL=<tool name>
THREADLINE_RUNTIME=<runtime name>
THREADLINE_AGENT=<agent name>
THREADLINE_SESSION_ID=<current session id>
THREADLINE_INITIATIVE=<initiative id>
```

Local persistent configuration is also available:

```bash
threadline config set-url <url>
threadline config set-token <token>
threadline config show
```

Place the global `--json` option before the command.
For a retried create operation, choose `--idempotency-key <stable-key>` before the first attempt and reuse that exact value before every retry. Do not create a new idempotency key after an uncertain response.

## Inspect shared state

```bash
threadline --json status
threadline --json inbox list
threadline --json workboard
threadline --json initiative list
threadline --json initiative get <initiative-id>
threadline --json --initiative <initiative-id> task list
threadline --json task get <task-id>
threadline --json task submission list <task-id>
threadline --json submission list --initiative <initiative-id>
threadline --json decision list --status open
threadline --json decision get <decision-id>
```

## Create and update an initiative

```bash
threadline --json initiative create \
  --title "Ship Threadline MVP" \
  --intent "Preserve work context and close decisions across Agent sessions" \
  --status active \
  --next-step "Validate the first decision loop"

threadline --json initiative update <initiative-id> \
  --status waiting_for_jim \
  --next-step "Jim chooses the deployment domain"
```

An Initiative represents a durable work theme. Reuse its ID when the work belongs to that theme; create a new Initiative only when a distinct, continuing work theme needs its own shared state.

## Manage Tasks

Tasks belong to exactly one Initiative. A Task has a title, optional detail, and an `open` or `completed` status. The CLI does not expose Task assignees, dependencies, priorities, due dates, or waiting states. Creating or listing Tasks requires an attached Initiative through the global `--initiative`, `THREADLINE_INITIATIVE`, or `attach` context.

```bash
threadline --json --initiative <initiative-id> task create \
  --title "Validate the migration" \
  --detail "Run the focused migration suite and record the result."

threadline --json --initiative <initiative-id> task list

threadline --json task update <task-id> \
  --title "Validate the migration and rollback" \
  --detail "Run focused migration and rollback checks."

threadline --json task update <task-id> --complete
threadline --json task update <task-id> --reopen
threadline --json task update <task-id> --clear-detail
```

For a retried `task create`, use the same global `--idempotency-key <stable-key>` on the original request and every retry. Create only independently trackable units of work; do not create Tasks for transient reasoning or command logs.

## Link task evidence

Record a meaningful checkpoint or result as a Submission, with evidence references or a durable artifact reference. Then link that Submission to the Task. The Task and Submission must have the same Initiative.

```bash
threadline --json submission create \
  --kind progress_update \
  --title "Migration validation completed" \
  --summary "The focused suite passed on the target schema." \
  --initiative <initiative-id> \
  --evidence "test:migration,artifact:ci-run-184" \
  --detail-ref "https://ci.example.test/runs/184" \
  --attention record_only

threadline --json task submission link <task-id> --submission <submission-id>
threadline --json task submission list <task-id>
threadline --json task submission unlink <task-id> --submission <submission-id>
```

Linking a Submission does not complete its Task. Complete the Task separately after its work is actually finished.

## Submit standard content

```bash
threadline --json --idempotency-key "<stable-key>" submission create \
  --kind delivery \
  --title "API contract complete" \
  --summary "The core routes and state transitions are implemented and tested." \
  --detail "The response contract and error handling are covered by the focused suite." \
  --detail-ref "<artifact-reference>" \
  --initiative <initiative-id> \
  --attention inbox
```

Use `--detail` for compact supporting context and `--detail-ref` for a durable artifact reference. Preserve source and user-provided text in its original language unless the user requests a translation.

Record content the user already saw without creating Active Inbox attention:

```bash
threadline --json submission create \
  --kind delivery \
  --title "Migration verified" \
  --summary "The user reviewed the successful migration in this session." \
  --initiative <initiative-id> \
  --attention inbox \
  --observed
```

`--dedupe-key` consolidates related active Inbox attention; `--idempotency-key` protects a retried logical create. Use both when the same update needs both properties, and keep each value stable for its purpose.

## Set Initiative lifecycle state

All of these commands accept an optional `[initiative-id]`. When it is omitted, the CLI uses the globally or persistently attached Initiative context.

```bash
threadline --json ready <initiative-id> \
  --next "Run the migration validation suite"

threadline --json wait <initiative-id> \
  --on external \
  --next "Retry after the vendor restores access"

threadline --json wait <initiative-id> \
  --on human \
  --question "Approve the production cutover?" \
  --title "Production cutover approval" \
  --attention inbox

threadline --json done <initiative-id> \
  --title "Migration completed" \
  --summary "All migration Tasks are complete and the required Decisions are resolved." \
  --attention record_only
```

`ready` accepts `--next` or `--next-step`. `wait` accepts `--on human|external|failed`, plus legacy `--for jim|agent`; `--question` is valid only with `--on human` and creates a Decision request. `done` creates the Initiative completion delivery and updates the Initiative state. Before `done`, complete every Task and resolve or otherwise close every Decision. The Gateway rejects `done` while Tasks remain open; `verify-complete` performs the full final check, including Decisions and delivery evidence.

## Synchronize a durable checkpoint

Use `sync` to submit one progress or delivery record and project Initiative state in the same write. `sync` needs an Initiative attached through `--initiative`, `THREADLINE_INITIATIVE`, or `attach` when `--event` or `--summary` is supplied.

```bash
threadline --json --initiative <initiative-id> sync \
  --event "migration-validation" \
  --summary "Validation passed on the target schema." \
  --status ready \
  --next "Request the production cutover decision" \
  --evidence "test:migration,artifact:ci-run-184" \
  --attention record_only

threadline --json --initiative <initiative-id> sync \
  --event "vendor-outage" \
  --summary "The vendor API is unavailable." \
  --status waiting \
  --on external \
  --next "Retry after the vendor restores access"
```

`--status` accepts `ready`, `waiting`, or `done`; `--on` accepts `human`, `external`, or `failed` and applies to a waiting state. With no `--event` or `--summary`, `sync` is read-only context inspection. Do not use `sync --status done` before the completion gate.

## Verify completion

After the completion delivery and Initiative `done` state have been recorded, verify the final state:

```bash
threadline --json verify-complete <initiative-id>
```

Verification succeeds only when the Initiative is completed, every Task is completed, no unresolved Decisions remain, and at least one delivery is recorded. It exits nonzero when any check fails. Use its returned checks to find the incomplete state; do not declare the Initiative complete while it fails.

## Request and resolve a decision

```bash
threadline --json submission create \
  --kind decision_request \
  --title "Choose deployment region" \
  --summary "The first production host needs a region before provisioning." \
  --initiative <initiative-id> \
  --attention inbox \
  --question "Which region should host the private Gateway?" \
  --options "Singapore,Tokyo" \
  --risk medium
```

Capture `decision.id` from the response. After the user answers in the originating session:

```bash
threadline --json decision resolve <decision-id> \
  --outcome "Use Singapore" \
  --via agent_session
```

Run `threadline --json decision get <decision-id>` before asking again after a resume.

When resolving a Decision, preserve the user's explicit outcome exactly, including its language. An identical already-resolved outcome is successful; a different outcome is a conflict that must be surfaced instead of overwritten.

## Manage Inbox state

```bash
threadline --json inbox read <notification-id>
threadline --json inbox snooze <notification-id> --until <utc-iso-timestamp>
threadline --json inbox archive <notification-id>
```

Do not use read or archive as a substitute for resolving an associated Decision.
