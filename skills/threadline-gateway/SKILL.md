---
name: threadline-gateway
description: Submit durable work context to a Threadline Human-Agent Gateway and close cross-session decisions with the Threadline CLI. Use whenever an agent produces a meaningful delivery, recommendation, decision request, alert, or valuable progress update; whenever a user answers a previously submitted decision in the originating agent session; or whenever an agent needs to inspect the shared Inbox, Workboard, initiatives, or decision state before continuing or asking again.
---

# Threadline Gateway

Use the `threadline` CLI as the only integration surface. Treat Threadline as the durable fact source shared by the user and other agents, not as a runtime monitor or chat system.

Read [references/cli.md](references/cli.md) before the first CLI operation or when command syntax is uncertain.

## Establish context

1. Confirm the CLI can reach the configured Gateway with `threadline --json status`.
2. Set accurate `THREADLINE_TOOL` and `THREADLINE_SESSION_ID` values for the current session before any write. The CLI records the local hostname automatically; use `THREADLINE_ACTOR_HOST` only when it needs an explicit override. `THREADLINE_RUNTIME` remains a compatibility fallback for older integrations.
3. Use an existing initiative when the work belongs to one. Create an initiative only when a durable work theme is intentional; never infer one from a single unrelated message.

Do not expose, print, or commit `THREADLINE_TOKEN`.

## Completion gate

Before declaring a scoped piece of work complete, pause at this gate:

1. Confirm the result is actually complete, or explicitly state the remaining blocker or limitation.
2. Attach the durable context needed to understand the result later: the initiative when one exists, a concise conclusion, relevant evidence or artifact reference, and the originating runtime, agent, and session attribution.
3. Check whether this work created or is governed by an open Decision. Close that exact Decision when the user has supplied an explicit outcome; otherwise leave it open and say what is still needed.
4. Submit one durable `delivery`, `progress_update`, or `alert` when the result changes shared coordination. Do not replace the delivery with ordinary chat narration.

Do not claim completion merely because commands passed, a user saw a draft, or the Agent is ending its session. A blocked or partial result is still valuable when recorded accurately as such.

## Attach durable context

Use Threadline records to preserve the minimum context that another human or Agent needs to resume safely:

- Associate content with the existing initiative using `--initiative` whenever it belongs to that durable work theme.
- Put the human-readable conclusion in `--summary`; use `--detail` for concise supporting context and `--detail-ref` for an artifact, PR, file, or other durable reference.
- Preserve host, tool, and session metadata on every write. Do not invent an initiative, owner, blocker, session, or reference when it is unknown.
- Use `--observed` when the current user has already seen the result, so the fact remains recorded without creating duplicate attention.

## Language policy

Threadline records are evidence, not a translation layer. Preserve the language of user decisions, source facts, titles, summaries, outcomes, and quoted context unless the user explicitly asks for translation. Interface labels and a short Agent-authored bridge may use the active conversation language, but never silently translate, normalize, paraphrase away qualifiers, or mix languages inside a quoted outcome.

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

## Idempotent writes and retries

For any create operation that may be retried after a timeout, interruption, or uncertain response, choose one stable `--idempotency-key` before the first attempt and reuse that exact key for every retry. The key identifies the logical create, not an individual HTTP attempt. Do not generate a new key during a retry.

Use `--dedupe-key` only to consolidate active attention for related updates; it does not make creates idempotent and does not replace `--idempotency-key`.

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
3. Preserve the user's answer in its original language and record it with `threadline --json decision resolve <id> --outcome <outcome> --via agent_session`.
4. Treat an identical already-resolved result as success. If Threadline reports a conflicting outcome, stop and surface the existing result; never overwrite it.
5. Query the decision if needed, then continue work from the recorded outcome without asking the same question again. At the completion gate, link the resulting delivery or progress record to the same initiative when one exists.

Never resolve a decision merely because the user viewed it, changed topics, or failed to respond.

## Coordinate with existing state

- Query a known decision ID before re-asking a question after a resume or context handoff.
- Read the Workboard before claiming who or what an initiative is waiting for.
- Update an initiative's status and next step when the coordination state materially changes.
- Preserve actor and session attribution on every mutation.
- Do not poll Threadline in the background. Query at natural workflow boundaries only.
