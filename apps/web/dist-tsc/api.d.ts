import type { Initiative, InitiativeStatus } from "@threadline/protocol";
export type Connection = {
    url: string;
    token: string;
};
export declare function readConnection(): Connection;
export declare function writeConnection(connection: Connection): void;
export declare class ApiError extends Error {
    readonly status?: number | undefined;
    constructor(message: string, status?: number | undefined);
}
export declare class ThreadlineApi {
    private readonly connection;
    constructor(connection: Connection);
    private request;
    inbox(): Promise<{
        notification: {
            id: string;
            submission_id: string;
            channel: "web";
            status: "active" | "archived" | "read" | "resolved" | "snoozed" | "suppressed";
            suppression_reason: "deduplicated" | "digest" | "observed" | "record_only" | null;
            snoozed_until: string | null;
            created_at: string;
            updated_at: string;
        };
        submission: {
            id: string;
            kind: "alert" | "decision_request" | "delivery" | "digest" | "progress_update" | "recommendation";
            title: string;
            summary: string;
            detail: string | null;
            detail_ref: string | null;
            initiative_id: string | null;
            attention_policy: "digest" | "inbox" | "interrupt" | "record_only";
            dedupe_key: string | null;
            source: string;
            runtime: string | null;
            agent: string | null;
            session_id: string | null;
            observed_at: string | null;
            created_at: string;
            created_by: string;
        };
        decision: {
            id: string;
            submission_id: string;
            initiative_id: string | null;
            question: string;
            options: string[] | null;
            risk_level: "high" | "low" | "medium";
            status: "expired" | "open" | "resolved" | "seen" | "superseded";
            resolution: string | null;
            resolved_via: string | null;
            resolved_by: string | null;
            resolved_at: string | null;
            created_at: string;
            updated_at: string;
        } | null;
        initiative: {
            id: string;
            title: string;
            intent: string;
            status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
            next_step: string | null;
            created_at: string;
            updated_at: string;
            last_activity_at: string;
            created_by: string;
        } | null;
    }[]>;
    workboard(): Promise<{
        active: {
            id: string;
            title: string;
            intent: string;
            status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
            next_step: string | null;
            created_at: string;
            updated_at: string;
            last_activity_at: string;
            created_by: string;
        }[];
        waiting_for_jim: {
            id: string;
            title: string;
            intent: string;
            status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
            next_step: string | null;
            created_at: string;
            updated_at: string;
            last_activity_at: string;
            created_by: string;
        }[];
        waiting_for_agent: {
            id: string;
            title: string;
            intent: string;
            status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
            next_step: string | null;
            created_at: string;
            updated_at: string;
            last_activity_at: string;
            created_by: string;
        }[];
        paused_or_done: {
            id: string;
            title: string;
            intent: string;
            status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
            next_step: string | null;
            created_at: string;
            updated_at: string;
            last_activity_at: string;
            created_by: string;
        }[];
    }>;
    initiatives(): Promise<{
        id: string;
        title: string;
        intent: string;
        status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
        next_step: string | null;
        created_at: string;
        updated_at: string;
        last_activity_at: string;
        created_by: string;
    }[]>;
    initiative(id: string): Promise<{
        id: string;
        title: string;
        intent: string;
        status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
        next_step: string | null;
        created_at: string;
        updated_at: string;
        last_activity_at: string;
        created_by: string;
    }>;
    submissions(initiativeId?: string): Promise<{
        id: string;
        kind: "alert" | "decision_request" | "delivery" | "digest" | "progress_update" | "recommendation";
        title: string;
        summary: string;
        detail: string | null;
        detail_ref: string | null;
        initiative_id: string | null;
        attention_policy: "digest" | "inbox" | "interrupt" | "record_only";
        dedupe_key: string | null;
        source: string;
        runtime: string | null;
        agent: string | null;
        session_id: string | null;
        observed_at: string | null;
        created_at: string;
        created_by: string;
    }[]>;
    decisions(): Promise<{
        id: string;
        submission_id: string;
        initiative_id: string | null;
        question: string;
        options: string[] | null;
        risk_level: "high" | "low" | "medium";
        status: "expired" | "open" | "resolved" | "seen" | "superseded";
        resolution: string | null;
        resolved_via: string | null;
        resolved_by: string | null;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
    }[]>;
    decision(id: string): Promise<{
        id: string;
        submission_id: string;
        initiative_id: string | null;
        question: string;
        options: string[] | null;
        risk_level: "high" | "low" | "medium";
        status: "expired" | "open" | "resolved" | "seen" | "superseded";
        resolution: string | null;
        resolved_via: string | null;
        resolved_by: string | null;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
    }>;
    events(entityType?: string, entityId?: string): Promise<{
        id: string;
        entity_type: string;
        entity_id: string;
        event_type: string;
        actor_type: string;
        actor_name: string;
        source: string | null;
        runtime: string | null;
        agent: string | null;
        session_id: string | null;
        payload: {
            [x: string]: unknown;
        } | null;
        created_at: string;
    }[]>;
    createInitiative(input: {
        title: string;
        intent: string;
        status: InitiativeStatus;
        next_step: string | null;
    }): Promise<{
        id: string;
        title: string;
        intent: string;
        status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
        next_step: string | null;
        created_at: string;
        updated_at: string;
        last_activity_at: string;
        created_by: string;
    }>;
    updateInitiative(id: string, input: Partial<Pick<Initiative, "title" | "intent" | "status" | "next_step">>): Promise<{
        id: string;
        title: string;
        intent: string;
        status: "active" | "cancelled" | "completed" | "paused" | "waiting_for_agent" | "waiting_for_jim";
        next_step: string | null;
        created_at: string;
        updated_at: string;
        last_activity_at: string;
        created_by: string;
    }>;
    updateNotification(id: string, action: "read" | "snooze" | "archive"): Promise<unknown>;
    resolveDecision(id: string, outcome: string): Promise<{
        id: string;
        submission_id: string;
        initiative_id: string | null;
        question: string;
        options: string[] | null;
        risk_level: "high" | "low" | "medium";
        status: "expired" | "open" | "resolved" | "seen" | "superseded";
        resolution: string | null;
        resolved_via: string | null;
        resolved_by: string | null;
        resolved_at: string | null;
        created_at: string;
        updated_at: string;
    }>;
}
export declare function humanActor(): {
    actor_type: "human";
    actor_name: string;
    source: string;
    runtime: null;
    agent: null;
    session_id: null;
};
//# sourceMappingURL=api.d.ts.map