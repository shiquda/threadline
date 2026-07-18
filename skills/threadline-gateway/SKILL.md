---
name: threadline-gateway
description: Submit durable work context to a Threadline Human-Agent Gateway and close cross-session decisions with the Threadline CLI. Use whenever an agent produces a meaningful delivery, recommendation, decision request, alert, or valuable progress update; whenever a user answers a previously submitted decision in the originating agent session; or whenever an agent needs to inspect the shared Inbox, Workboard, initiatives, or decision state before continuing or asking again.
---

# Threadline Gateway

Use the `threadline` CLI as the only integration surface. Treat Threadline as the durable fact source shared by the user and other agents, not as a runtime monitor or chat system.

Read [references/cli.md](references/cli.md) before the first CLI operation or when command syntax is uncertain.

## Establish context

1. Confirm the CLI can reach the configured Gateway with `threadline --json status`.
2. Set accurate `THREADLINE_RUNTIME`, `THREADLINE_AGENT`, and `THREADLINE_SESSION_ID` values for the current session before any write.
3. Use an existing initiative when the work belongs to one. Create an initiative only when a durable work theme is intentional; never infer one from a single unrelated message.

Do not expose, print, or commit `THREADLINE_TOKEN`.

## Decide whether to submit

Submit only content that will remain useful outside the current turn:

- `delivery`: a completed result with a conclusion.
- `recommendation`: a proposed direction worth retaining.
- `decision_request`: a specific question the user must close.
- `alert`: a concrete risk, failure, or time-sensitive issue.
- `progress_update`: a meaningful checkpoint that changes coordination.
- `digest`: an intentionally aggregated summary.

Do not submit routine command output, ordinary success logs, transient reasoning, or repeated status with no coordination value.

Choose attention deliberately:

- Use `interrupt` only for immediate high-impact or time-bound action.
- Use `inbox` when the user should act or read soon.
- Use `digest` for information intended for later aggregation.
- Use `record_only` for durable history that requires no attention.
- Add `--observed` when the user already saw the content in this session. Preserve the record without creating an Active Inbox item.

Use a stable `--dedupe-key` for updates that should share one active attention entry.

## Create a decision request

1. Ask one concrete question and summarize why it matters.
2. Include realistic options when the choice is bounded.
3. Mark risk accurately. Treat external communication, spending, deletion, permission changes, and irreversible work as high risk unless clearly proven otherwise.
4. Submit `kind=decision_request` with `--question`; capture the returned `decision.id` in the current session context.
5. Stop at the authorization boundary. Do not continue the gated action before a clear resolution.

## Close a decision in the originating session

When the user answers a submitted decision in this session:

1. Match the answer to the exact stored decision ID. If the ID is uncertain, query open decisions using the current initiative/session context; do not guess.
2. Require an explicit answer for high-risk or irreversible actions. Do not translate ambiguous acknowledgement into approval.
3. Run `threadline --json decision resolve <id> --outcome <outcome> --via agent_session`.
4. Treat an identical already-resolved result as success. If Threadline reports a conflicting outcome, stop and surface the existing result.
5. Query the decision if needed, then continue work from the recorded outcome without asking the same question again.

Never resolve a decision merely because the user viewed it, changed topics, or failed to respond.

## Coordinate with existing state

- Query a known decision ID before re-asking a question after a resume or context handoff.
- Read the Workboard before claiming who or what an initiative is waiting for.
- Update an initiative's status and next step when the coordination state materially changes.
- Preserve actor and session attribution on every mutation.
- Do not poll Threadline in the background. Query at natural workflow boundaries only.
