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
For a retried create operation, also reuse `--idempotency-key <stable-key>` before the command.

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
threadline --json submission create \
  --kind delivery \
  --title "API contract complete" \
  --summary "The core routes and state transitions are implemented and tested." \
  --initiative <initiative-id> \
  --attention inbox
```

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

## Manage Inbox state

```bash
threadline --json inbox read <notification-id>
threadline --json inbox snooze <notification-id> --until <utc-iso-timestamp>
threadline --json inbox archive <notification-id>
```

Do not use read or archive as a substitute for resolving an associated Decision.
