import type Database from "better-sqlite3";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE initiatives (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        intent TEXT NOT NULL,
        status TEXT NOT NULL,
        next_step TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_activity_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE submissions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT,
        detail_ref TEXT,
        initiative_id TEXT REFERENCES initiatives(id),
        attention_policy TEXT NOT NULL,
        dedupe_key TEXT,
        source TEXT NOT NULL,
        runtime TEXT,
        agent TEXT,
        session_id TEXT,
        observed_at TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      );

      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL UNIQUE REFERENCES submissions(id),
        initiative_id TEXT REFERENCES initiatives(id),
        question TEXT NOT NULL,
        options_json TEXT,
        risk_level TEXT NOT NULL,
        status TEXT NOT NULL,
        resolution TEXT,
        resolved_via TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES submissions(id),
        channel TEXT NOT NULL,
        status TEXT NOT NULL,
        suppression_reason TEXT,
        snoozed_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE audit_events (
        id TEXT PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_name TEXT NOT NULL,
        source TEXT,
        runtime TEXT,
        agent TEXT,
        session_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_initiatives_status ON initiatives(status, last_activity_at DESC);
      CREATE INDEX idx_submissions_initiative ON submissions(initiative_id, created_at DESC);
      CREATE INDEX idx_submissions_dedupe ON submissions(dedupe_key, created_at DESC);
      CREATE INDEX idx_decisions_status ON decisions(status, created_at DESC);
      CREATE INDEX idx_notifications_status ON notifications(status, updated_at DESC);
      CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, created_at ASC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE initiatives ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'open';
      ALTER TABLE initiatives ADD COLUMN blocker TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE initiatives ADD COLUMN owner TEXT NOT NULL DEFAULT 'agent';
      ALTER TABLE initiatives ADD COLUMN next_action TEXT;
      ALTER TABLE submissions ADD COLUMN content_language TEXT NOT NULL DEFAULT 'und';
      ALTER TABLE submissions ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]';

      UPDATE initiatives
      SET lifecycle = CASE WHEN status IN ('completed', 'cancelled') THEN 'done' ELSE 'open' END,
          blocker = CASE
            WHEN status = 'waiting_for_jim' THEN 'human'
            WHEN status = 'paused' THEN 'external'
            ELSE 'none'
          END,
          owner = CASE
            WHEN status = 'waiting_for_jim' THEN 'human'
            WHEN status IN ('completed', 'cancelled', 'paused') THEN 'none'
            ELSE 'agent'
          END,
          next_action = next_step;

      CREATE INDEX idx_initiatives_projection
        ON initiatives(lifecycle, blocker, owner, last_activity_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        initiative_id TEXT NOT NULL REFERENCES initiatives(id),
        title TEXT NOT NULL,
        detail TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        completed_at TEXT,
        completed_by TEXT
      );

      CREATE TABLE task_submission_links (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        PRIMARY KEY (task_id, submission_id)
      );

      CREATE INDEX idx_tasks_initiative ON tasks(initiative_id, status, updated_at DESC);
      CREATE INDEX idx_task_submission_links_submission ON task_submission_links(submission_id, task_id);
    `,
  },
] as const;

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>).map(
      (row) => row.version,
    ),
  );

  const apply = db.transaction((version: number, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(
      version,
      new Date().toISOString(),
    );
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      apply(migration.version, migration.sql);
    }
  }
}
