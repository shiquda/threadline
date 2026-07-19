---
name: threadline-gateway
description: Submit durable work context to a Threadline Human-Agent Gateway and close cross-session decisions with the Threadline CLI. Use whenever an agent produces a meaningful delivery, recommendation, decision request, alert, or valuable progress update; whenever a user answers a previously submitted decision in the originating agent session; or whenever an agent needs to inspect the shared Inbox, Workboard, initiatives, or decision state before continuing or asking again.
---

# Threadline Gateway

Use the `threadline` CLI as the only integration surface. Treat Threadline as the durable fact source shared by the user and other agents, not as a runtime monitor or chat system.

Read [references/cli.md](references/cli.md) before the first CLI operation or when command syntax is uncertain.

## Establish context

1. Confirm the CLI can reach the configured Gateway with `threadline --json status`.
2. Set accurate `THREADLINE_TOOL` when it is known. Use `THREADLINE_SESSION_ID` only when the harness provides its current native session ID; preserve it exactly. Do not generate, guess, or derive a session ID from time, process IDs, working directories, transcripts, or recent activity. A missing session ID is valid and submits to the Host/Tool `unscoped` timeline. The CLI records the local hostname automatically; use `THREADLINE_ACTOR_HOST` only when it needs an explicit override. `THREADLINE_RUNTIME` remains a compatibility fallback for older integrations.
3. Reuse an existing Initiative when the work belongs to its durable theme. Create one only for an intentional, continuing body of work that needs shared state across sessions or actors; do not infer one from a single unrelated message.
4. At a resume or handoff boundary, inspect the Initiative, its Tasks, linked Submissions, open Decisions, and the Workboard before claiming its state or creating duplicate work.

Do not expose, print, or commit `THREADLINE_TOKEN`.

## Replace a Todo lifecycle

Treat Threadline records as a hierarchy with distinct responsibilities:

- An **Initiative** is the durable work theme and its shared state. It is not a catch-all for unrelated one-off requests.
- A **Task** is a concrete, resumable unit of work inside one Initiative. Create a Task only when its progress or completion needs to be tracked independently. Tasks have a title, optional detail, and an `open` or `completed` status; do not invent assignees, dependencies, priorities, due dates, or waiting states.
- A **Submission** preserves a meaningful result, checkpoint, recommendation, alert, or decision request. Attach artifact and evidence references to the Submission, then link that Submission to the Task it supports. A linked Submission must belong to the same Initiative as the Task.
- A **Decision** records a question that needs a human outcome. It is not completed merely by waiting, reading, or changing the Initiative state.

For work that replaces a Todo list:

1. Reuse or create the Initiative, then list its Tasks before adding one. Create a concise Task for each independently trackable unit of work.
2. Keep a Task `open` while work remains. Update its title or detail when the durable scope changes. Mark it `completed` only when its actual unit of work is finished; reopen it when that conclusion becomes untrue.
3. Record durable progress or delivery as a Submission with the Initiative attached. Put evidence in `--evidence`, use `--detail-ref` for an artifact reference, and link the Submission to the relevant Task.
4. Use Initiative state to communicate the overall coordination condition, separately from Task status: `ready` for active work, `wait` when an outside condition blocks it, and `done` only at the completion gate.

Do not create a Task for transient reasoning or routine command execution. Do not use a Task as a substitute for an authorization Decision.

## Completion gate

Before declaring a scoped piece of work complete, pause at this gate:

1. Confirm the result is actually complete, or explicitly state the remaining blocker or limitation.
2. For an Initiative, list its Tasks and make sure every Task is `completed`. Finish or reopen individual Tasks before attempting Initiative completion.
3. List the Initiative's Decisions. Resolve the exact Decision after the user has supplied an explicit outcome; leave unresolved Decisions open and do not treat them as approval.
4. Submit a durable `delivery` that states the conclusion and links relevant evidence or artifact references. Link it to the completed Task when applicable.
5. Only then mark the Initiative `done`, then run `verify-complete`. A failed verification means the Initiative is not complete; correct the missing Task, Decision, delivery, or state instead of declaring success.

Do not claim completion merely because commands passed, a user saw a draft, or the Agent is ending its session. A blocked or partial result is still valuable when recorded accurately as such.

## Attach durable context

Use Threadline records to preserve the minimum context that another human or Agent needs to resume safely:

- Associate content with the existing initiative using `--initiative` whenever it belongs to that durable work theme.
- Put the human-readable conclusion in `--summary`; use `--detail` for concise supporting context and `--detail-ref` for an artifact, PR, file, or other durable reference.
- Preserve host, tool, and available native session metadata on every write. Do not invent an initiative, owner, blocker, session, or reference when it is unknown.
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

## Progress, waiting, and state sync

- Use `ready` with a next action when the Initiative is actively actionable. It updates Initiative state; it does not create or complete a Task.
- Use `wait` when progress is blocked by a human, external dependency, or failure. Keep unfinished Tasks open. With `wait --on human --question`, the CLI records a Decision request and puts the Initiative into the waiting state; resolve that exact Decision after the user answers.
- Use `sync --event` or `sync --summary` to record a durable checkpoint and project its Initiative state in one write. Include `--evidence` for durable references, and use `--status ready`, `waiting`, or `done` deliberately. Do not use `sync --status done` to bypass the completion gate.
- With no event or summary, `sync` only inspects the attached context, Workboard, and attached Initiative Decisions. It does not create a record or change state.

## Coordinate with existing state

- Query a known decision ID before re-asking a question after a resume or context handoff.
- Read the Workboard and the Initiative's Tasks before claiming who or what an Initiative is waiting for or complete.
- Update an Initiative's status and next step when the coordination state materially changes. Update a Task separately when its own scope or completion changes.
- Preserve actor and session attribution on every mutation.
- Do not poll Threadline in the background. Query at natural workflow boundaries only.
