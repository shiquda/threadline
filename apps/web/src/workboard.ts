export type InitiativeRecord = {
  id?: string;
  title?: string;
  intent?: string;
  status?: string;
  next_step?: string | null;
  created_at?: string;
  updated_at?: string;
  last_activity_at?: string;
  created_by?: string;
  owner?: string | null;
  next_action?: string | null;
  blocker?: string | null;
  recent_fact?: string | null;
  record_language?: string | null;
};

export type WorkboardLane = "ready" | "waiting" | "done";
export type NormalizedWorkboard = Record<WorkboardLane, InitiativeRecord[]>;

const emptyBoard = (): NormalizedWorkboard => ({ ready: [], waiting: [], done: [] });

function asRecords(value: unknown): InitiativeRecord[] {
  return Array.isArray(value) ? value.filter((item): item is InitiativeRecord => typeof item === "object" && item !== null) : [];
}

function firstRecords(source: Record<string, unknown>, ...keys: string[]): InitiativeRecord[] {
  for (const key of keys) {
    const records = asRecords(source[key]);
    if (records.length || Array.isArray(source[key])) return records;
  }
  return [];
}

export function normalizeWorkboard(value: unknown): NormalizedWorkboard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyBoard();
  const source = value as Record<string, unknown>;
  return {
    ready: firstRecords(source, "ready", "active"),
    waiting: firstRecords(source, "waiting").concat(
      Array.isArray(source.waiting) ? [] : asRecords(source.waiting_for_jim),
      Array.isArray(source.waiting) ? [] : asRecords(source.waiting_for_agent),
    ),
    done: firstRecords(source, "done", "paused_or_done"),
  };
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function initiativeRecord(initiative: InitiativeRecord) {
  return {
    owner: optionalText(initiative.owner),
    nextAction: optionalText(initiative.next_action) ?? optionalText(initiative.next_step),
    blocker: optionalText(initiative.blocker),
    recentFact: optionalText(initiative.recent_fact),
    recordLanguage: optionalText(initiative.record_language),
  };
}
