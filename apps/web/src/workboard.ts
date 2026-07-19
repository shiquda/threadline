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

export type WorkboardLane = "in_progress" | "waiting_for_user" | "waiting_for_agent" | "paused_or_done";
export type NormalizedWorkboard = Record<WorkboardLane, InitiativeRecord[]>;

const emptyBoard = (): NormalizedWorkboard => ({
  in_progress: [],
  waiting_for_user: [],
  waiting_for_agent: [],
  paused_or_done: [],
});

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

function dedupeRecords(records: InitiativeRecord[]): InitiativeRecord[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = record.id ?? JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusLane(status: string | undefined): WorkboardLane | null {
  if (status === "active" || status === "ready") return "in_progress";
  if (status === "waiting_for_jim") return "waiting_for_user";
  if (status === "waiting_for_agent") return "waiting_for_agent";
  if (status === "paused" || status === "completed" || status === "cancelled") return "paused_or_done";
  return null;
}

export function normalizeWorkboard(value: unknown): NormalizedWorkboard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return emptyBoard();
  const source = value as Record<string, unknown>;

  const hasSpecificInProgress = Array.isArray(source.active) || Array.isArray(source.in_progress);
  const hasSpecificWaiting = Array.isArray(source.waiting_for_jim) || Array.isArray(source.waiting_for_user) || Array.isArray(source.waiting_for_agent);
  const hasSpecificDone = Array.isArray(source.paused_or_done);

  // Use canonical specific lanes when available; otherwise fall back to legacy combined lanes.
  const inProgress = hasSpecificInProgress
    ? firstRecords(source, "active", "in_progress")
    : firstRecords(source, "active", "in_progress", "ready");
  const waitingForUser = hasSpecificWaiting
    ? firstRecords(source, "waiting_for_jim", "waiting_for_user")
    : asRecords(source.waiting_for_jim).concat(asRecords(source.waiting));
  const waitingForAgent = hasSpecificWaiting
    ? firstRecords(source, "waiting_for_agent")
    : asRecords(source.waiting_for_agent).concat(asRecords(source.waiting));
  const pausedOrDone = hasSpecificDone
    ? firstRecords(source, "paused_or_done")
    : firstRecords(source, "paused_or_done", "done");

  const deduped: NormalizedWorkboard = {
    in_progress: dedupeRecords(inProgress),
    waiting_for_user: dedupeRecords(waitingForUser),
    waiting_for_agent: dedupeRecords(waitingForAgent),
    paused_or_done: dedupeRecords(pausedOrDone),
  };

  // If the API only provided a legacy combined "ready" lane, split its records by status.
  if (!hasSpecificInProgress && Array.isArray(source.ready) && !Array.isArray(source.active) && !Array.isArray(source.in_progress)) {
    deduped.in_progress = [];
    for (const record of asRecords(source.ready)) {
      const lane = statusLane(record.status);
      if (lane === "waiting_for_user" || lane === "waiting_for_agent") {
        if (!deduped[lane].some((item) => item.id === record.id)) deduped[lane].push(record);
      } else {
        if (!deduped.in_progress.some((item) => item.id === record.id)) deduped.in_progress.push(record);
      }
    }
  }

  // A legacy combined "waiting" array is treated as waiting for the user when no specific lane is provided.
  if (!hasSpecificWaiting && Array.isArray(source.waiting)) {
    for (const record of asRecords(source.waiting)) {
      if (!deduped.waiting_for_user.some((item) => item.id === record.id)) deduped.waiting_for_user.push(record);
    }
  }

  // Final cross-lane deduplication: an initiative should appear in only one lane.
  const seen = new Set<string>();
  const result: NormalizedWorkboard = { in_progress: [], waiting_for_user: [], waiting_for_agent: [], paused_or_done: [] };
  const lanes: WorkboardLane[] = ["in_progress", "waiting_for_user", "waiting_for_agent", "paused_or_done"];
  for (const lane of lanes) {
    for (const record of deduped[lane]) {
      const key = record.id ?? JSON.stringify(record);
      if (seen.has(key)) continue;
      seen.add(key);
      result[lane].push(record);
    }
  }
  return result;
}

export function uniqueInitiativeIds(board: NormalizedWorkboard): Set<string> {
  const ids = new Set<string>();
  for (const records of Object.values(board)) {
    for (const record of records) {
      if (record.id) ids.add(record.id);
    }
  }
  return ids;
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
