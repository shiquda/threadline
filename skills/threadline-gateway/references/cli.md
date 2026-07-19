# Threadline CLI reference

## Configuration

Prefer environment variables in Agent environments:

```text
THREADLINE_URL=https://threadline.example.com
THREADLINE_TOKEN=<secret>
THREADLINE_ACTOR_TYPE=agent
THREADLINE_ACTOR_NAME=<agent name>
THREADLINE_RUNTIME=<runtime name>
THREADLINE_AGENT=<agent name>
THREADLINE_SESSION_ID=<current session id>
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
