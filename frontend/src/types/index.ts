export type Priority = "P0" | "P1" | "P2" | "P3" | "P4";

export interface Employee {
    id?: number; // DB ID
    emp_id: string; // Unique String ID (s002)
    emp_name: string;
    emp_email: string;
    emp_phone?: string;
    emp_designation: string; // real HRIS job title
    emp_department?: string;
    emp_hierarchy?: string;
    manager_id?: string; // emp_id of the manager
    is_demo?: boolean; // signed in to a POST /demo sandbox workspace
    demo_expires_at?: string; // ISO time that sandbox is purged (frontend-only, from POST /demo)
    avatar?: string; // Optional frontend prop (legacy)
    // Enriched HRIS profile
    node_id?: string;
    hris_user_id?: string;
    company?: string;
    legal_entity?: string;
    gender?: string;
    work_location?: string;
    date_of_joining?: string;
    date_of_birth?: string;
    blood_group?: string;
    payscale?: string;
    education?: string[];
    linkedin?: string;
    profile_pic?: string; // URL, or initials string, or null
    skills?: string[];
    timezone?: string; // IANA name (e.g. "Asia/Kolkata"), same visibility rules as skills — nullable
}

export interface Task {
    id: string; // Frontend ID (might be task_id from backend?)
    ticket_id?: string; // Human-facing reference shown in the UI, e.g. "T-38291"
    task_name: string;
    task_description?: string;
    task_status?: "backlog" | "todo" | "in-progress" | "done" | "on-hold" | string;
    task_assigned_to?: string; // emp_id
    task_assigned_by?: string;
    task_assigned_date?: string;
    task_due_date?: string;
    task_priority?: Priority | string;
    task_tags?: string;
    task_notes?: string;
    task_created_at?: string;
    task_updated_at?: string;
    task_duration?: string; // "4" or "4 hours"
    time_spent?: number; // Hours spent as float
    completed_at?: string; // ISO String
    remaining_seconds?: number; // Backend calculated remaining time
    task_sessions?: TaskSession[];
    // Create-only, request-side: images staged before the task existed, sent inline so they're
    // saved before the assignment email goes out. Never present on a task read back from the API.
    attachments?: { filename?: string; content_type?: string; data: string }[];
    // Denormalized subtask rollup (see task_links link_type="subtask"). 0 total = leaf task,
    // no progress bar. Recomputed server-side on every write that touches a child.
    subtask_total?: number;
    subtask_done?: number;
    // Create-only, request-side: subtasks staged in the create modal (own assignee each),
    // created atomically with the parent. Never present on a task read back from the API.
    subtasks?: SubtaskCreate[];
    // Create-response-only: set if the parent saved but one or more staged subtasks failed.
    subtask_warning?: string;
    // Optional Epic this story rolls up into (see Epic below) — only meaningful on a
    // top-level story, not a subtask.
    epic_id?: string;
    // Optional Sprint/Cycle this task is scoped to (see Sprint below).
    sprint_id?: string;
}

export interface SubtaskCreate {
    task_name: string;
    task_assigned_to: string; // emp_id
    task_description?: string;
    task_status?: string;
    task_priority?: Priority | string;
    task_tags?: string;
    task_duration?: string;
    task_due_date?: string;
    attachments?: { filename?: string; content_type?: string; data: string }[];
}

export interface TaskSession {
    start_time: string;
    end_time?: string;
    duration?: number; // minutes or hours
    status?: string;
    status_label?: string;
    completion_status?: string;
}

export interface Comment {
    id: number;
    task_id: string;
    author_id?: string;
    author_name?: string;
    body: string;
    is_system?: boolean;
    created_at?: string;
}

export interface Attachment {
    id: number;
    task_id: string;
    filename?: string;
    content_type?: string;
    data: string; // base64 data URI ("data:image/png;base64,....")
    uploaded_by?: string;
    created_at?: string;
}

/** An attachment picked before the task exists (create-task flow) — held client-side, then
 * uploaded to the real task_id right after creation succeeds. */
export interface StagedAttachment {
    localId: string;
    filename: string;
    content_type: string;
    data: string; // base64 data URI
}

export interface AppNotification {
    id: number;
    user_id: string;
    type?: string;
    message: string;
    task_id?: string;
    is_read: boolean;
    created_at?: string;
}

export interface NotificationsResponse {
    items: AppNotification[];
    unread: number;
}

export interface TaskLink {
    link_id: number;
    link_type: "subtask" | "depends_on" | string;
    task_id: string;
    task_ticket_id?: string;
    task_name?: string;
    task_status?: string;
    task_priority?: string;
    task_assigned_to?: string;
    subtask_total?: number;
    subtask_done?: number;
    direction: "outgoing" | "incoming" | string;
}

export interface DaySchedule {
    date: string; // YYYY-MM-DD
    blocks: TaskBlock[];
}

// Fix TaskBlock definition
export interface TaskBlock {
    taskId: string;
    startTime: number; // Hour of day (e.g. 9.5 for 9:30 AM)
    endTime: number;
    date: string;
    status?: 'completed' | 'backlog' | 'in-progress' | 'planned' | 'on-hold';
    isSession?: boolean;
    isLive?: boolean; // session was still open (end_time null) when this block was built
}

export interface ScheduledTask extends Task {
    schedule: TaskBlock[];
}

export interface CompanyConfig {
    startHour: number; // e.g. 9
    endHour: number;   // e.g. 17
}

// ── API request/response shapes ──────────────────────────────────────────────
// The axios base query unwraps the backend `{status, message, data}` envelope, so
// these types describe the inner `data` field returned to RTK Query.

export interface PaginatedTasks {
    items: Task[];
    total: number;
    total_pages: number;
    page: number;
    page_size: number;
}

// GET /tasks returns either a bare array (legacy) or a paginated object.
export type TaskListResponse = Task[] | PaginatedTasks;

export interface AuthResponse {
    token: string;
    userData: Employee;
}

/** "developer" is the older name for employee_1, still accepted by POST /demo. */
export type DemoPersona = "manager" | "team_lead" | "employee_1" | "employee_2" | "developer";

export interface DemoResponse extends AuthResponse {
    demo: { workspace_id: string; persona: DemoPersona; expires_at: string };
}

export interface UploadResult {
    added?: number;
    skipped?: number;
    count?: number;
}

export interface BulkDeleteResult {
    deleted_count: number;
}

export interface TaskListParams {
    page?: number;
    page_size?: number;
    user_id?: string;
    // Cross-cutting filter on the assignee's department — a first-class filter alongside
    // org-tree scoping (scale-gaps-plan.md §B.2), since org-tree scope alone can't answer
    // "all Payments team work" across multiple managers' subtrees.
    department?: string;
}

// One level above a story (Task) — a cross-team initiative a set of stories roll up into.
// Company-wide, like the org chart (not org-tree scoped) — see GET /epics.
export interface Epic {
    id: string;
    ticket_id?: string;
    name: string;
    description?: string;
    status?: string;
    owner_id?: string;
    department?: string;
    // Roadmap/Gantt date range (the initiative's own planned window, distinct from any one
    // story's task_due_date) — both optional; an epic with neither just skips the roadmap bar.
    start_date?: string;
    target_date?: string;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
    // Rollup across linked stories, computed live server-side — not denormalized.
    story_total: number;
    story_done: number;
    progress_pct: number;
    // Only present on GET /epics/{id} (epic detail), not the list endpoint.
    stories?: Task[];
}

export type EpicCreatePayload = Partial<Epic>;

// A time-boxed cycle tasks can optionally be scoped to (independent of Epic — a sprint is a
// slice of TIME, an epic is a slice of SCOPE). Company-wide, like Epic. No stored `status`;
// `status_label` ("upcoming"/"active"/"completed") is derived server-side from the dates.
export interface Sprint {
    id: string;
    name: string;
    start_date: string;
    end_date: string;
    created_by?: string;
    created_at?: string;
    status_label: "upcoming" | "active" | "completed" | string;
    task_total: number;
    task_done: number;
    total_hours: number;
    completed_hours: number;
    // Only present on GET /sprints/{id} (detail), not the list endpoint.
    tasks?: Task[];
}

export type SprintCreatePayload = Partial<Sprint>;

// GET /sprints/{id}/burndown — ideal vs actual remaining scope (hours) per day of the
// sprint. `actual_remaining_hours` is null for any day still in the future.
export interface BurndownPoint {
    date: string; // YYYY-MM-DD
    ideal_remaining_hours: number;
    actual_remaining_hours: number | null;
}

export interface BurndownResponse {
    sprint_id: string;
    total_hours: number;
    points: BurndownPoint[];
}

// GET /tasks/{id}/graph — full subtask/depends_on link set reachable from a task (not just
// the one-hop set TaskLinks.tsx renders). `truncated` is true if MAX_GRAPH_NODES was hit.
export interface TaskGraphNode {
    id: string;
    ticket_id?: string;
    task_name: string;
    task_status?: string;
    task_priority?: string;
    task_assigned_to?: string;
}

export interface TaskGraphEdge {
    id: number;
    from_task_id: string;
    to_task_id: string;
    link_type: "subtask" | "depends_on" | string;
}

export interface TaskGraph {
    nodes: TaskGraphNode[];
    edges: TaskGraphEdge[];
    truncated: boolean;
}

export interface UserListParams {
    user_id?: string;
}

export type TaskCreatePayload = Partial<Task>;

// GET /capacity — per-employee next-48h capacity/utilization (org-tree scoped). See
// backend/main.py's _capacity_for_employee for the exact derivation.
export type CapacityStatus = "available" | "at_capacity" | "over_capacitated";

export interface CapacityDay {
    date: string; // YYYY-MM-DD
    committed_seconds: number;
    available_seconds: number;
    utilization_pct: number;
}

export interface CapacityEmployee {
    emp_id: string;
    emp_name: string;
    utilization_pct: number; // today's utilization
    days: CapacityDay[]; // [today, tomorrow]
    status: CapacityStatus; // worst-of-the-two-days status bucket
    // Resolved IANA timezone used for THIS employee's day-boundary math (their own `timezone`
    // when set, else the org-wide BUSINESS_TZ fallback) — see main.py's
    // _resolve_employee_tz_name. Always present; never null/undefined on this endpoint.
    timezone: string;
}

export interface CapacitySummary {
    total_employees: number;
    available_count: number;
    at_capacity_count: number;
    over_capacitated_count: number;
    avg_utilization_pct: number;
}

export interface CapacityResponse {
    employees: CapacityEmployee[];
    summary: CapacitySummary;
}

export type RiskLevel = "medium" | "high";

// One in-scope todo/in-progress task the backend's deterministic (NO Gemini) heuristic flagged
// as at risk of missing its due date (or already overloaded-assignee risk when there's no due
// date) — see main.py's _task_overdue_risk. Only "medium"/"high" risk tasks are ever included.
export interface AtRiskTask {
    task_id: string;
    task_name: string;
    assignee_emp_id: string;
    risk_level: RiskLevel;
    reason: string;
}

// One overloaded<->idle employee pairing from the backend's deterministic (NO Gemini)
// rebalance pass — see main.py's _rebalance_suggestions. A suggestion surface, not an
// auto-apply action.
export interface RebalanceSuggestion {
    overloaded_emp_id: string;
    idle_emp_id: string;
    reason: string;
}

// GET /insights — decision-support summary sitting on top of /capacity and /tasks. Written by
// Gemini (`source: "ai"`) or, when Gemini isn't configured or fails, by deterministic rules
// (`source: "rules"`). `available: false` only comes from older servers.
//
// `at_risk_tasks`/`rebalance_suggestions` are computed by deterministic backend logic
// BEFORE the Gemini-availability check, so they are populated (possibly empty arrays)
// REGARDLESS of `available` — never gate rendering of these two on `available`. They're
// optional here only as a defensive default (an older cached response or edge case that
// predates this field) — treat a missing value as an empty array, not as "unavailable".
export interface InsightsResponse {
    available: boolean;
    source?: "ai" | "rules";
    summary: string | null;
    recommendations: string[];
    reason: string | null;
    generated_at: string; // ISO timestamp
    scope_employee_count: number;
    at_risk_tasks?: AtRiskTask[];
    rebalance_suggestions?: RebalanceSuggestion[];
}

// GET /tasks/assignee-suggestions — candidate ranking (individual contributors only — the
// backend excludes lead/manager/exec-rank designations from the pool) for the create-task
// modal's "who should I assign this to?" shortcut. Deterministic by default; supplying a
// `description` triggers an optional server-side Gemini domain-classification pass, whose
// match can surface as an extra entry in `reasons` (e.g. "Skills match: React, TypeScript").
// See backend/main.py's get_assignee_suggestions for the exact scoring.
export interface AssigneeSuggestion {
    emp_id: string;
    emp_name: string;
    score: number;
    reasons: string[];
}

export interface LoginPayload {
    emp_id: string;
    password?: string;
}

export interface RegisterPayload {
    emp_id: string;
    password?: string;
    emp_email?: string;
}

// Onboarding wizard step 1 (POST /onboarding/preview) — read-only identity check + profile
// preview, ahead of the actual password-set step (which reuses RegisterPayload/AuthResponse).
export interface OnboardingPreviewPayload {
    emp_id: string;
    emp_email: string;
}

export interface OnboardingPreviewResponse {
    emp_name: string;
    emp_id: string;
    emp_email: string;
    emp_phone?: string;
    emp_designation?: string;
    emp_department?: string;
    profile_pic?: string;
}

// GET /admin/employee-overview (admin panel only, company-wide — not org-tree scoped).
export interface EmployeeOverviewTaskCounts {
    open: number;
    in_progress: number;
    on_hold: number;
    done: number;
    overdue: number;
    total: number;
}

export interface EmployeeOverviewRow {
    emp_id: string;
    emp_name: string;
    emp_designation?: string;
    emp_department?: string;
    is_onboarded: boolean;
    tasks: EmployeeOverviewTaskCounts;
    utilization_pct: number;
    availability_status: "available" | "at_capacity" | "over_capacitated";
}

export interface EmployeeOverviewResponse {
    employees: EmployeeOverviewRow[];
    total: number;
}

// GET /audit-log (admin only) — org-wide log of admin actions (scale-gaps-plan.md Phase 3,
// item 2): user create/update/delete/bulk-delete/CSV-import, task CSV-import. `details` shape
// varies by `action` — a diff ({field: {before, after}}) for user.update, a plain summary
// ({added, skipped}) for the CSV-import actions, etc. — see audit_util.py/main.py for exactly
// what each action records.
export interface AuditLogEntry {
    id: number;
    actor_emp_id: string | null;
    actor_name: string | null;
    actor_designation: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    details: Record<string, unknown> | null;
    created_at: string | null;
}

export interface AuditLogResponse {
    entries: AuditLogEntry[];
    total: number;
    limit: number;
    offset: number;
}
