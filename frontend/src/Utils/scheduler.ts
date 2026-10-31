import { Task, Employee, CompanyConfig, TaskBlock } from "types";
import { parseDurationToHours } from "Utils/common";
import { normalizeServerTimestamp } from "Utils/serverTime";

// One business timezone for the whole timeline, so hour-of-day and date-key math is identical
// for every viewer regardless of their browser tz (server stores UTC). Override via
// VITE_BUSINESS_TZ. Default IST.
export const BUSINESS_TZ =
    (import.meta.env?.VITE_BUSINESS_TZ as string) || "Asia/Kolkata";

// Extract calendar/clock parts of an instant AS SEEN IN the business timezone.
const zonedParts = (d: Date, tz: string = BUSINESS_TZ) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).formatToParts(d).reduce((acc, p) => {
        acc[p.type] = p.value;
        return acc;
    }, {} as Record<string, string>);
    // Intl can emit "24" for midnight in some engines — normalize to 0.
    const hour = parts.hour === "24" ? 0 : Number(parts.hour);
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour,
        minute: Number(parts.minute),
    };
};

// YYYY-MM-DD in the business tz (was viewer-local).
export const getLocalDateKey = (d: Date) => {
    const p = zonedParts(d);
    return `${p.year}-${p.month}-${p.day}`;
};

// Fractional hour-of-day (e.g. 14.5 for 2:30 PM) in the business tz.
export const zonedHourOfDay = (d: Date) => {
    const p = zonedParts(d);
    return p.hour + p.minute / 60;
};

const BLOCK_STATUSES: readonly NonNullable<TaskBlock["status"]>[] = [
    "completed",
    "backlog",
    "in-progress",
    "planned",
    "on-hold",
];

/** Normalize an arbitrary backend session-status string (status_label/completion_status/status
 * are all free-text on the wire) into TaskBlock's closed status union. Falls back to "completed"
 * for anything unrecognized, matching the existing bias a few lines up toward treating
 * ended/unlabeled sessions as completed work. */
const toBlockStatus = (status: string): NonNullable<TaskBlock["status"]> =>
    (BLOCK_STATUSES as readonly string[]).includes(status)
        ? (status as NonNullable<TaskBlock["status"]>)
        : "completed";

// Event-based Simulation Scheduler to handle splitting and preemption
export const calculateSchedule = (
    tasks: Task[],
    developers: Employee[],
    config: CompanyConfig,
    startDate: Date = new Date(),
    opts: { actualOnly?: boolean } = {}
): Record<string, TaskBlock[]> => {
    // actualOnly: render ONLY real work history (session blocks) — skip the multi-day
    // planned-work simulation. Used by the timeline's actual-history view.
    const { actualOnly = false } = opts;
    const schedule: Record<string, TaskBlock[]> = {};
    const EPSILON = 0.01; // Tolerance for float comparison (increased to catch gaps)

    // Naive server timestamps are UTC; values with an explicit zone are kept as-is.
    const fixTime = normalizeServerTimestamp;

    developers.forEach(dev => {
        schedule[dev.emp_id] = [];

        const myTasks = tasks.filter(t => t.task_assigned_to === dev.emp_id);
        if (myTasks.length === 0) return;

        // Pre-calculation: Identify "Queued" Active Tasks (Same priority/active, but not first picked)
        // These tasks are technically "In Progress" but conceptually "Waiting" for the first task to finish.
        // We suppress their "Active Session" visualization to avoid a split visual (Start Blip ... Gap ... Planned).
        const deferredTaskIds = new Set<string>();
        // The deferred-suppression pre-pass only exists to hide a "blip…gap…planned" visual
        // when planned blocks are drawn. In actual-only mode there are no planned blocks and
        // the server enforces a single active session, so every real session must be shown.
        if (!actualOnly) {
            const activeInProgTasks = tasks.filter(t =>
                t.task_assigned_to === dev.emp_id &&
                (t.task_status === 'in-progress' || t.task_status === 'in progress') &&
                t.task_sessions?.some(s => !s.end_time) // Has active session
            );

            if (activeInProgTasks.length > 1) {
                // Sort FIFO
                activeInProgTasks.sort((a, b) => {
                    const tA = a.task_assigned_date ? new Date(fixTime(a.task_assigned_date)).getTime() : 0;
                    const tB = b.task_assigned_date ? new Date(fixTime(b.task_assigned_date)).getTime() : 0;
                    return tA - tB;
                });
                // Skip the first one (Active Focus), mark rest as Deferred
                for (let i = 1; i < activeInProgTasks.length; i++) {
                    deferredTaskIds.add(activeInProgTasks[i].id);
                }
            }
        }

        // 1. Process Fixed Historical Sessions (from task_sessions)
        const occupiedSlots: Record<string, Array<{ start: number, end: number }>> = {};





        myTasks.forEach(task => {
            if (task.task_sessions && task.task_sessions.length > 0) {
                // 1. Normalize and Resolve Sessions
                const normalizedSessions: Array<{
                    start: Date;
                    end: Date;
                    status: string;
                    dateKey: string;
                    isLive: boolean;
                }> = [];

                task.task_sessions.forEach(session => {
                    // Suppress Active Session visual for Deferred (Queued) tasks
                    if (!session.end_time && deferredTaskIds.has(task.id)) {
                        return;
                    }

                    // Capture "still open" BEFORE we backfill an end_time below — this is the
                    // only reliable live-segment marker (an open session's status gets remapped
                    // to 'completed' further down, so status can't identify it).
                    const wasOpen = !session.end_time;

                    let endTime = session.end_time;

                    // Fallback: If task is done but session is open, close it at completed_at
                    if (!endTime && task.task_status?.toLowerCase() === 'done' && task.completed_at) {
                        endTime = task.completed_at;
                    }
                    // Fallback: If task is on-hold but session is open, close it at updated_at
                    if (!endTime && task.task_status === 'on-hold' && task.task_updated_at) {
                        endTime = task.task_updated_at;
                    }

                    // Fallback: If session is still open (active), visualize it up to "Now"
                    if (!endTime && !session.end_time) {
                        endTime = new Date().toISOString();
                    }

                    if (!session.start_time || !endTime) return;

                    const start = new Date(fixTime(session.start_time));
                    const end = new Date(fixTime(endTime));
                    const dateKey = getLocalDateKey(start);

                    // Determine status from session fields
                    // Priority: status_label (new session) > completion_status (closed session) > status > fallback
                    let sessionStatus = session.status_label || session.completion_status || session.status;

                    // Fallback mapping if backend sends different strings
                    if (sessionStatus === 'in-progress' || sessionStatus === 'in progress') {
                        sessionStatus = endTime ? 'completed' : 'planned';
                    }
                    if (!sessionStatus) {
                        // If session has ended or task is done/on-hold, treat as completed (work done)
                        sessionStatus = (task.task_status === 'done' || task.task_status === 'on-hold' || endTime)
                            ? 'completed'
                            : 'backlog';
                    }

                    normalizedSessions.push({
                        start,
                        end,
                        status: sessionStatus,
                        dateKey,
                        isLive: wasOpen
                    });
                });

                // 2. Sort sessions chronologically
                normalizedSessions.sort((a, b) => a.start.getTime() - b.start.getTime());

                // 3. Merge contiguous sessions with same status and date
                const mergedSessions: typeof normalizedSessions = [];
                if (normalizedSessions.length > 0) {
                    let current = normalizedSessions[0];

                    for (let i = 1; i < normalizedSessions.length; i++) {
                        const next = normalizedSessions[i];

                        // Merge condition: Same status AND Same day AND Contiguous (gap < 1 min)
                        // We must NOT merge if there is a significant gap (e.g. worked on another task)
                        const gapMs = next.start.getTime() - current.end.getTime();

                        if (
                            next.status === current.status &&
                            next.dateKey === current.dateKey &&
                            gapMs < 60 * 1000 // Only merge if gap is less than 1 minute
                        ) {
                            // Extend completion date to the latest end time
                            if (next.end.getTime() > current.end.getTime()) {
                                current.end = next.end;
                            }
                            current.isLive = current.isLive || next.isLive;
                        } else {
                            mergedSessions.push(current);
                            current = next;
                        }
                    }
                    mergedSessions.push(current);
                }

                // 4. Add to Schedule
                mergedSessions.forEach(session => {
                    const { start, end, status, dateKey, isLive } = session;
                    const startHour = zonedHourOfDay(start);
                    let endHour = zonedHourOfDay(end);

                    // Midnight guard: a session (esp. a live one backfilled to "now") that
                    // spans into a later calendar day would give endHour < startHour (inverted
                    // → invisible block). Clamp its end to the end of the business day.
                    if (getLocalDateKey(end) !== dateKey) {
                        endHour = config.endHour;
                    }

                    // Live session: "now" only tells us elapsed time, not the planned duration
                    // the user just committed to — without this a freshly-started 3h task shows
                    // as a sliver instead of spanning its full length. Extend to start+remaining
                    // (backend `remaining_seconds`, else `task_duration`), never shrinking below
                    // the real elapsed-to-now width so overrun tasks still grow past their plan.
                    if (isLive) {
                        const plannedHours = (task.remaining_seconds !== undefined && task.remaining_seconds !== null)
                            ? task.remaining_seconds / 3600
                            : parseDurationToHours(task.task_duration || 1);
                        const plannedEnd = startHour + plannedHours;
                        endHour = Math.max(endHour, plannedEnd);
                        if (getLocalDateKey(end) === dateKey && endHour > config.endHour) {
                            endHour = config.endHour;
                        }
                    }

                    schedule[dev.emp_id].push({
                        taskId: task.id,
                        startTime: startHour,
                        endTime: endHour,
                        date: dateKey,
                        status: toBlockStatus(status),
                        isSession: true,
                        isLive
                    });

                    // Mark slot as occupied to avoid overlapping simulation
                    if (!occupiedSlots[dateKey]) occupiedSlots[dateKey] = [];
                    occupiedSlots[dateKey].push({ start: startHour, end: endHour });
                });
            } else if (task.task_status?.toLowerCase() === 'done') {
                // Fallback for Done tasks without sessions: Synthesize a session to block the timeline
                const endStr = task.completed_at || task.task_updated_at || new Date().toISOString();
                const endTimeDate = new Date(endStr);

                // Parse duration
                const duration = task.time_spent
                    ? parseDurationToHours(task.time_spent)
                    : parseDurationToHours(task.task_duration || 1);

                // Calculate estimated start time (End - Duration)
                const startTimeDate = new Date(endTimeDate.getTime() - duration * 60 * 60 * 1000);

                const dateKey = getLocalDateKey(startTimeDate);
                const startHour = zonedHourOfDay(startTimeDate);
                const endHour = zonedHourOfDay(endTimeDate);

                // Add to schedule as fixed block
                schedule[dev.emp_id].push({
                    taskId: task.id,
                    startTime: startHour,
                    endTime: endHour,
                    date: dateKey,
                    status: 'completed',
                    isSession: true
                });

                // Mark slot as occupied
                if (!occupiedSlots[dateKey]) occupiedSlots[dateKey] = [];
                occupiedSlots[dateKey].push({ start: startHour, end: endHour });
            } else if (actualOnly && (task.task_status === 'in-progress' || task.task_status === 'in progress')) {
                // Defensive: an in-progress task with NO sessions (corrupt data) would emit
                // nothing in actual-only mode — and with the planned simulation skipped, nothing
                // else would either, so the active task would vanish. Synthesize a live block.
                const base = task.task_assigned_date
                    ? new Date(fixTime(task.task_assigned_date))
                    : new Date();
                const nowDate = new Date();
                const dateKey = getLocalDateKey(base);
                const startHour = zonedHourOfDay(base);
                let endHour = zonedHourOfDay(nowDate);
                if (getLocalDateKey(nowDate) !== dateKey) endHour = config.endHour;

                // Same "planned duration" extension as the merged-session path above.
                const plannedHours = (task.remaining_seconds !== undefined && task.remaining_seconds !== null)
                    ? task.remaining_seconds / 3600
                    : parseDurationToHours(task.task_duration || 1);
                endHour = Math.max(endHour, startHour + plannedHours);
                if (getLocalDateKey(nowDate) === dateKey && endHour > config.endHour) endHour = config.endHour;
                if (endHour <= startHour) endHour = startHour + 0.1;

                schedule[dev.emp_id].push({
                    taskId: task.id,
                    startTime: startHour,
                    endTime: endHour,
                    date: dateKey,
                    status: 'in-progress',
                    isSession: true,
                    isLive: true
                });

                if (!occupiedSlots[dateKey]) occupiedSlots[dateKey] = [];
                occupiedSlots[dateKey].push({ start: startHour, end: endHour });
            }
        });

        // Sort sessions chronologically to enable correct merging
        schedule[dev.emp_id].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.startTime - b.startTime;
        });

        // Steps 2–3 below are the planned-work simulation — skipped entirely in actual-only mode.
        if (!actualOnly) {
        // 2. Setup Simulation State for Reporting/Remaining Work
        const remainingDuration: Record<string, number> = {};

        myTasks.forEach(t => {
            const status = t.task_status?.toLowerCase();
            const isDone = status === 'done' || status === 'on-hold';

            // If done or on-hold, we assume it's fully handled by the Session loop above (either real sessions or synthesized block)
            // So we force totalRequired to 0 to prevent it from entering the simulation pool again.
            if (isDone) {
                remainingDuration[t.id] = 0;
                return;
            }

            // If not done, calculate remaining
            let totalRequired = 0;

            // Strict Visual Rule: 
            // Only 'in-progress' tasks (or similar active states) should be auto-scheduled/simulated on the timeline.
            // 'todo' and 'backlog' tasks await user action (Pick) and should NOT appear as "Planned" blocks yet.
            const isActive = status === 'in-progress' || status === 'in progress';
            if (!isActive) {
                remainingDuration[t.id] = 0;
                return;
            }

            if (t.remaining_seconds !== undefined) {
                // Use backend provided remaining time (precise)
                totalRequired = t.remaining_seconds / 3600;
            } else {
                // Fallback: Manual calculation
                totalRequired = parseDurationToHours(t.task_duration || 1);

                // Deduct time already spent in sessions
                let spentInSessions = 0;
                if (t.task_sessions) {
                    t.task_sessions.forEach(s => {
                        // Calculate duration in hours
                        let eTime = s.end_time ? new Date(fixTime(s.end_time)) : null;
                        // Strict fallback only if session status is "in-progress" or explicit null implies active
                        if (!eTime && (s.status === 'in-progress' || !s.end_time)) {
                            eTime = new Date();
                        }

                        if (s.start_time && eTime) {
                            const d = (eTime.getTime() - new Date(fixTime(s.start_time)).getTime()) / (1000 * 60 * 60);
                            spentInSessions += Math.max(0, d);
                        }
                    });
                }
                totalRequired -= spentInSessions;
            }

            remainingDuration[t.id] = Math.max(0, totalRequired);

            // Force a minimum block if task is Active (In-Progress) but calculation resulted in <= 0
            // This ensures the timeline always shows "Future Work" for currently active tasks which haven't been marked done.
            const isTaskActive = t.task_status === 'in-progress' || t.task_status === 'in progress';
            if (isTaskActive && remainingDuration[t.id] < 0.25) { // Minimum 15 mins for visibility
                remainingDuration[t.id] = Math.max(remainingDuration[t.id], 0.5); // Default to 30 mins overlap if overrun
            } else if (remainingDuration[t.id] <= EPSILON) {
                // For non-active tasks (backlog?), keep small.
                remainingDuration[t.id] = 0.1;
            }
        });

        // 2.5. Schedule "Tail" of Active Tasks Sequentially (Queue Mode)
        // User Request: If multiple tasks are active, schedule them strictly sequentially based on "Pick Up Time".
        // The first picked task runs first. The second picked task starts ONLY after the first one finishes.

        const activeTasksWithRemaining = myTasks.filter(t => remainingDuration[t.id] > EPSILON);

        // Sort by Assigned Date (Pick Up Time) - Ascending (FIFO)
        activeTasksWithRemaining.sort((a, b) => {
            const tA = a.task_assigned_date ? new Date(fixTime(a.task_assigned_date)).getTime() : 0;
            const tB = b.task_assigned_date ? new Date(fixTime(b.task_assigned_date)).getTime() : 0;
            return tA - tB;
        });

        let chainDateKey: string | null = null;
        let chainEndTime = -1; // Tracks the end of the chain

        activeTasksWithRemaining.forEach(t => {
            // Check if this task has an active session
            const blocks = schedule[dev.emp_id].filter(b => b.taskId === t.id && b.isSession);

            if (blocks.length > 0) {
                // CASE 1: Task HAS active session blocks (Head of Chain)
                blocks.sort((a, b) => b.endTime - a.endTime);
                const lastSession = blocks[0];
                const tailDate = lastSession.date;

                // Reset chain if date changed
                if (chainDateKey && chainDateKey !== tailDate) chainEndTime = -1;
                chainDateKey = tailDate;

                // VALIDATION: active session should not merge with "on-hold" history.
                // If the latest block is 'on-hold', it means the active session was suppressed (Deferred)
                // or simply missing. We should NOT extend the historical block.
                const isMergeable = lastSession.status !== 'on-hold' && lastSession.status !== 'completed' && lastSession.status !== 'backlog';

                if (tailDate && isMergeable) {
                    let tailStart = lastSession.endTime;

                    // Enforce Serial Chain
                    if (chainEndTime !== -1 && chainEndTime > tailStart + EPSILON) {
                        tailStart = chainEndTime;
                    }

                    const tailEnd = tailStart + remainingDuration[t.id];

                    // Commit Block
                    const existingIdx = schedule[dev.emp_id].indexOf(lastSession);
                    if (existingIdx !== -1 && Math.abs(lastSession.endTime - tailStart) < EPSILON) {
                        schedule[dev.emp_id][existingIdx].endTime = tailEnd;
                    } else {
                        schedule[dev.emp_id].push({
                            taskId: t.id,
                            startTime: tailStart,
                            endTime: tailEnd,
                            date: tailDate,
                            status: 'planned',
                            isSession: true
                        });
                    }

                    chainEndTime = tailEnd;

                    if (!occupiedSlots[tailDate]) occupiedSlots[tailDate] = [];
                    occupiedSlots[tailDate].push({ start: tailStart, end: tailEnd });
                    remainingDuration[t.id] = 0;
                } else {
                    // Treat as Deferred (Scenario 2) explicitly if we couldn't merge
                    // This creates a NEW block instead of stretching the old one.
                    // Fallthrough to shared logic would be cleaner, but for minimal diff, we copy/invoke Case 2 logic.
                    // We can just set blocks = [] to force Case 2 branch? 
                    // No, simpler to copy the synthesis logic here or refactor.
                    // Refactoring to fall through:

                    // Force Case 2 logic below by pretending no blocks found
                    blocks.length = 0;
                }
            }

            if (blocks.length === 0) {
                // CASE 2: Task is Deferred (active but session suppressed)
                // We must synthesize its block to maintain the Queue Visualization.

                // Determine base start time (Assigned Date or Now)
                const baseDate = t.task_assigned_date
                    ? new Date(fixTime(t.task_assigned_date))
                    : (t.task_created_at ? new Date(fixTime(t.task_created_at)) : new Date());

                const dateKey = getLocalDateKey(baseDate);
                let startHour = baseDate.getHours() + baseDate.getMinutes() / 60;

                // Safety: Don't allow Deferred blocks to start in the past (before Now).
                // They are by definition "Waiting", so they cannot have started yet.
                const now = new Date();
                if (dateKey === getLocalDateKey(now)) {
                    const nowHour = now.getHours() + now.getMinutes() / 60;
                    startHour = Math.max(startHour, nowHour);
                }

                // Reset chain if date changed
                if (chainDateKey && chainDateKey !== dateKey) chainEndTime = -1;
                chainDateKey = dateKey;

                // Enforce Chain: If previous task ended later than our assigned time, wait for it.
                if (chainEndTime !== -1 && chainEndTime > startHour + EPSILON) {
                    startHour = chainEndTime;
                }

                // If startHour is before config start (e.g. 8am task viewed at 10am), push to valid start?
                // Step 3 handles this naturally, but here we are forcing.
                // Assuming Queue Mode tasks are "Live", so we probably shouldn't schedule them in the past relative to "Now" if they weren't started?
                // Actually, if we use strict "Assigned Date" and it's 8am, 
                // but "Now" is 12pm. 
                // Detailed logic would require checking "Now". 
                // For simplicity/robustness in Queue: Trust the Chain. 
                // If Chain was at "Now" (from Head task), then T2 automatically starts at "Now". Correct.

                const endHour = startHour + remainingDuration[t.id];

                schedule[dev.emp_id].push({
                    taskId: t.id,
                    startTime: startHour,
                    endTime: endHour,
                    date: dateKey,
                    status: 'planned',
                    isSession: true
                });

                chainEndTime = endHour;

                if (!occupiedSlots[dateKey]) occupiedSlots[dateKey] = [];
                occupiedSlots[dateKey].push({ start: startHour, end: endHour });
                remainingDuration[t.id] = 0;
            }
        });

        // 3. Multi-Day Simulation Loop for Remaining (Backlog tasks)
        const currentSimDate = new Date(startDate);
        let dayCount = 0;
        const MAX_DAYS = 60;

        let hasRemainingWork = Object.values(remainingDuration).some(d => d > EPSILON);

        while (hasRemainingWork && dayCount < MAX_DAYS) {
            const processingDateStr = getLocalDateKey(currentSimDate);
            const occupied = occupiedSlots[processingDateStr] || [];

            // Define Simulation Timeline
            let t = config.startHour;
            const endT = config.endHour;

            let currentTaskId: string | null = null;
            let currentBlockStart = t;
            const commitBlock = (endTime: number) => {
                if (currentTaskId && endTime > currentBlockStart + EPSILON) {
                    const existing = schedule[dev.emp_id];

                    // Try to find a block to merge with (any block ending at current start)
                    const mergeableIndex = existing.findIndex(b =>
                        b.taskId === currentTaskId &&
                        b.date === processingDateStr &&
                        Math.abs(b.endTime - currentBlockStart) < EPSILON
                    );

                    if (mergeableIndex !== -1) {
                        // Extend existing block
                        existing[mergeableIndex].endTime = endTime;
                        // If we extended a block that wasn't the last one, we might need to re-sort? 
                        // Usually not strictly necessary for simple visualization, but good practice if we were relying on sort order later.
                        // But here we just modify 'end', start remains same, so sort order (by start) preserves.
                    } else {
                        schedule[dev.emp_id].push({
                            taskId: currentTaskId,
                            startTime: currentBlockStart,
                            endTime: endTime,
                            date: processingDateStr,
                            status: 'planned'
                        });
                    }
                }
            };

            while (t < endT - EPSILON) {
                // Check if 't' is inside an occupied slot
                const inSlot = occupied.find(s => t >= s.start && t < s.end);
                if (inSlot) {
                    // Jump over occupied slot
                    if (currentTaskId) {
                        commitBlock(t);
                        currentTaskId = null;
                    }
                    t = inSlot.end;
                    currentBlockStart = t;
                    continue;
                }

                // Identify Candidates
                const candidates = myTasks.filter(task => {
                    if (remainingDuration[task.id] < EPSILON) return false;

                    // Effective Start Time: assigned_date > created_at ? assigned_date : created_at
                    let effectiveStart = task.task_created_at ? new Date(fixTime(task.task_created_at)) : new Date(startDate);
                    if (task.task_assigned_date) {
                        const assigned = new Date(fixTime(task.task_assigned_date));
                        // Use assigned date if it exists (active pick-up time)
                        effectiveStart = assigned;
                    }

                    const startKey = getLocalDateKey(effectiveStart);

                    let availableFrom = config.startHour;
                    if (startKey === processingDateStr) {
                        availableFrom = effectiveStart.getHours() + effectiveStart.getMinutes() / 60;
                    } else if (startKey > processingDateStr) {
                        return false;
                    }

                    if (availableFrom < config.startHour) availableFrom = config.startHour;

                    return availableFrom <= t + EPSILON;
                });

                if (candidates.length === 0) {
                    // Find next availability or slot end
                    let nextEvent = endT;
                    // Check start times of future tasks today
                    myTasks.forEach(task => {
                        let es = task.task_created_at ? new Date(task.task_created_at) : new Date(startDate);
                        if (task.task_assigned_date) es = new Date(task.task_assigned_date);

                        const k = getLocalDateKey(es);
                        if (k === processingDateStr) {
                            const h = es.getHours() + es.getMinutes() / 60;
                            if (h > t + EPSILON && h < nextEvent) nextEvent = h;
                        }
                    });

                    // Check start of next occupied slot
                    const nextSlot = occupied.find(s => s.start > t);
                    if (nextSlot && nextSlot.start < nextEvent) nextEvent = nextSlot.start;

                    commitBlock(t);
                    currentTaskId = null;
                    t = nextEvent;
                    currentBlockStart = t;
                    continue;
                }

                // Pick Best Task
                candidates.sort((a, b) => {
                    const priorityOrder: Record<string, number> = { "P0": 0, "P1": 1, "P2": 2, "P3": 3, "P4": 4 };
                    const pA = priorityOrder[a.task_priority as string] ?? 2;
                    const pB = priorityOrder[b.task_priority as string] ?? 2;
                    if (pA !== pB) return pA - pB;
                    // Sort by effective start time (Newest/Latest Assigned first) to prioritize current focus
                    const tA = a.task_assigned_date ? new Date(fixTime(a.task_assigned_date)).getTime() : new Date(fixTime(a.task_created_at || "")).getTime();
                    const tB = b.task_assigned_date ? new Date(fixTime(b.task_assigned_date)).getTime() : new Date(fixTime(b.task_created_at || "")).getTime();
                    return tB - tA;
                });

                const bestTask = candidates[0];

                if (currentTaskId !== bestTask.id) {
                    commitBlock(t);
                    currentTaskId = bestTask.id;
                    currentBlockStart = t;
                }

                const timeToFinish = remainingDuration[bestTask.id];
                let step = Math.min(timeToFinish, endT - t);

                // Check collision with next occupied slot
                const nextSlot = occupied.find(s => s.start > t);
                if (nextSlot && (t + step) > nextSlot.start) {
                    step = nextSlot.start - t;
                }

                // (Omitted detailed Preemption logic for brevity, but basic flow holds)

                t += step;
                remainingDuration[bestTask.id] -= step;
                if (remainingDuration[bestTask.id] < EPSILON) remainingDuration[bestTask.id] = 0;
            }

            commitBlock(t);

            // Cleanup tiny remainders
            Object.keys(remainingDuration).forEach(key => {
                if (remainingDuration[key] > 0 && remainingDuration[key] < 0.02) {
                    remainingDuration[key] = 0;
                }
            });

            currentSimDate.setDate(currentSimDate.getDate() + 1);
            dayCount++;
            hasRemainingWork = Object.values(remainingDuration).some(d => d > EPSILON);
        }
        } // end if (!actualOnly) — planned-work simulation
    });

    // 4. Post-Process: Clean up visual overlaps in the final schedule for each developer
    Object.keys(schedule).forEach(empId => {
        let blocks = schedule[empId];

        // 4a. MERGE Strategy for Active Tasks (Refined):
        // We only merge blocks of the same 'in-progress' task if they are ADJACENT/CONTIGUOUS.
        // This prevents swallowing gaps where other tasks were performed.

        // First, ensure strictly sorted by time to enable adjacency check
        blocks.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.startTime - b.startTime;
        });

        const mergedBlocks: TaskBlock[] = [];
        if (blocks.length > 0) {
            let current = blocks[0];

            // Helper to check if task is active
            const isTaskActive = (tid: string) => {
                const t = tasks.find(tsk => tsk.id === tid);
                return t && (t.task_status === 'in-progress' || t.task_status === 'in progress');
            };

            for (let i = 1; i < blocks.length; i++) {
                const next = blocks[i];
                const isSameTask = current.taskId === next.taskId;
                const isSameDay = current.date === next.date;

                // Check if contiguous (Next Start ~= Current End) with small epsilon
                const isContiguous = Math.abs(next.startTime - current.endTime) < 0.05; // ~3 mins tolerance

                // Only merge if active task and contiguous
                // We typically only want to merge "History + Active + Planned" sequences for the current task.
                if (isSameTask && isSameDay && isContiguous && isTaskActive(current.taskId)) {
                    // Merge
                    current.endTime = Math.max(current.endTime, next.endTime);
                    // Force Unified Status for visual continuity
                    current.status = 'in-progress';
                    current.isSession = true;
                    current.isLive = current.isLive || next.isLive;
                } else {
                    mergedBlocks.push(current);
                    current = next;
                }
            }
            mergedBlocks.push(current);
        }

        blocks = mergedBlocks;
        schedule[empId] = blocks;



        // Sort chronologically
        blocks.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.startTime - b.startTime;
        });

        // Walk through and trim overlapping "To-Do" or "Session" blocks
        // (Visual polish only, doesn't affect data calculations)
        // In actual-only mode real sessions never overlap, so pushing would only MASK a
        // genuine data bug — skip it and let true overlaps surface.
        if (!actualOnly) {
            for (let i = 0; i < blocks.length - 1; i++) {
                const current = blocks[i];
                const next = blocks[i + 1];

                // Only trim if on same day
                if (current.date === next.date) {
                    // If overlapping (Next starts before Current ends)
                    if (current.endTime > next.startTime + 0.0001) {
                        // PUSH STRATEGY: Preserves the 'Current' (usually Active/History) block
                        // and defers the 'Next' (usually Planned) block.
                        // This is safer for preventing "Active Task Disappearance".
                        next.startTime = current.endTime;

                        // If next block becomes inverted (Start > End), squish it
                        if (next.startTime > next.endTime) {
                            next.endTime = next.startTime;
                        }
                    }
                }
            }
        }
    });

    return schedule;
};

// Helper to calculate business hours between two dates
export const calculateBusinessDuration = (
    start: Date,
    end: Date,
    config: CompanyConfig
): number => {
    let totalHours = 0;
    const current = new Date(start);

    // Limit infinite loops
    let safeGuard = 0;
    while (current < end && safeGuard < 1000) {
        safeGuard++;

        const dayStart = new Date(current);
        dayStart.setHours(config.startHour, 0, 0, 0);

        const dayEnd = new Date(current);
        dayEnd.setHours(config.endHour, 0, 0, 0);

        // Determine overlap of [current, end] with [dayStart, dayEnd]
        const spanStart = current.getTime() < dayStart.getTime() ? dayStart : current;

        let spanEnd = end;
        if (spanEnd.getTime() > dayEnd.getTime()) {
            spanEnd = dayEnd;
        }

        if (spanStart < spanEnd) {
            const diff = (spanEnd.getTime() - spanStart.getTime()) / (1000 * 60 * 60);
            totalHours += diff;
        }

        // Advance to next day start
        const nextDay = new Date(current);
        nextDay.setDate(nextDay.getDate() + 1);
        nextDay.setHours(config.startHour, 0, 0, 0);

        // If we are already past 'end', break
        if (nextDay.getTime() > end.getTime() && end.getTime() < dayEnd.getTime()) {
            break;
        }

        current.setTime(nextDay.getTime());
    }

    return Math.max(0.1, Math.round(totalHours * 10000) / 10000);
};

// Helper to get color by priority
export const getPriorityColor = (priority: string) => {
    switch (priority) {
        case "P0": return "red.500";
        case "P1": return "orange.400";
        case "P2": return "yellow.400";
        case "P3": return "blue.400";
        case "P4": return "gray.500";
        default: return "gray.500";
    }
};
