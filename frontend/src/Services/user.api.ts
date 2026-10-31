import { createApi } from "@reduxjs/toolkit/query/react";
import { baseUrlQuery } from "Services/baseQuery";
import type {
  Employee,
  Task,
  TaskListResponse,
  TaskListParams,
  UserListParams,
  TaskCreatePayload,
  AuthResponse,
  DemoPersona,
  DemoResponse,
  LoginPayload,
  RegisterPayload,
  UploadResult,
  BulkDeleteResult,
  Comment,
  NotificationsResponse,
  TaskLink,
  Attachment,
  CapacityResponse,
  InsightsResponse,
  AssigneeSuggestion,
  SubtaskCreate,
  Epic,
  EpicCreatePayload,
  TaskGraph,
  Sprint,
  SprintCreatePayload,
  BurndownResponse,
  AuditLogResponse,
  OnboardingPreviewPayload,
  OnboardingPreviewResponse,
  EmployeeOverviewResponse,
} from "types";

export const userApi = createApi({
  reducerPath: "userApi",
  baseQuery: baseUrlQuery,
  tagTypes: ["Task", "User", "Comment", "Notification", "Link", "Attachment", "Epic", "Sprint"],
  endpoints: (builder) => ({
    userList: builder.query<Employee[], UserListParams | void>({
      query: (param) => ({
        url: "/user",
        method: "GET",
        params: param ?? {},
      }),
      providesTags: ["User"],
    }),
    getUser: builder.query<Employee, string>({
      query: (id) => ({
        url: `/user/${id}`,
        method: "GET",
      }),
    }),
    taskList: builder.query<TaskListResponse, TaskListParams | void>({
      query: (param) => ({
        url: "/tasks",
        method: "GET",
        params: param ?? {},
      }),
      providesTags: ["Task"],
    }),
    createTask: builder.mutation<Task, TaskCreatePayload>({
      query: (body) => ({
        url: "/tasks",
        method: "POST",
        body: body,
      }),
      invalidatesTags: ["Task", "Epic", "Sprint"],
    }),
    updateTask: builder.mutation<Task, Task>({
      query: (body) => ({
        url: `/tasks/${body.id}`,
        method: "PUT",
        body: body,
      }),
      invalidatesTags: ["Task", "Epic", "Sprint"],
    }),
    // Plain string = normal delete. `{ taskId, cascade: true }` = also delete its subtasks —
    // used to retry after a 409 ("N subtask(s) depend on this") without a second confirm dialog
    // shape to design around.
    deleteTask: builder.mutation<unknown, string | { taskId: string; cascade?: boolean }>({
      query: (arg) => {
        const taskId = typeof arg === "string" ? arg : arg.taskId;
        const cascade = typeof arg === "string" ? false : arg.cascade;
        return {
          url: `/tasks/${taskId}${cascade ? "?cascade=true" : ""}`,
          method: "DELETE",
        };
      },
      invalidatesTags: ["Task"],
    }),
    deleteTaskSession: builder.mutation<Task, { id: string; start_time: string }>({
      query: ({ id, start_time }) => ({
        url: `/tasks/${id}/sessions`,
        method: "DELETE",
        body: { start_time },
      }),
      invalidatesTags: ["Task"],
    }),
    editTaskSession: builder.mutation<
      Task,
      { id: string; start_time: string; new_start_time?: string; new_end_time?: string | null }
    >({
      query: ({ id, ...body }) => ({
        url: `/tasks/${id}/sessions`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: ["Task"],
    }),
    splitTaskSession: builder.mutation<
      Task,
      { id: string; start_time: string; split_at: string }
    >({
      query: ({ id, start_time, split_at }) => ({
        url: `/tasks/${id}/sessions/split`,
        method: "POST",
        body: { start_time, split_at },
      }),
      invalidatesTags: ["Task"],
    }),
    taskComments: builder.query<Comment[], string>({
      query: (taskId) => ({ url: `/tasks/${taskId}/comments`, method: "GET" }),
      providesTags: (_r, _e, taskId) => [{ type: "Comment", id: taskId }],
    }),
    addComment: builder.mutation<Comment, { taskId: string; body: string }>({
      query: ({ taskId, body }) => ({
        url: `/tasks/${taskId}/comments`,
        method: "POST",
        body: { body },
      }),
      invalidatesTags: (_r, _e, { taskId }) => [{ type: "Comment", id: taskId }],
    }),
    deleteComment: builder.mutation<unknown, { id: number; taskId: string }>({
      query: ({ id }) => ({ url: `/comments/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { taskId }) => [{ type: "Comment", id: taskId }],
    }),
    taskAttachments: builder.query<Attachment[], string>({
      query: (taskId) => ({ url: `/tasks/${taskId}/attachments`, method: "GET" }),
      providesTags: (_r, _e, taskId) => [{ type: "Attachment", id: taskId }],
    }),
    addTaskAttachment: builder.mutation<
      Attachment,
      { taskId: string; filename?: string; content_type?: string; data: string }
    >({
      query: ({ taskId, ...body }) => ({
        url: `/tasks/${taskId}/attachments`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, { taskId }) => [{ type: "Attachment", id: taskId }],
    }),
    deleteTaskAttachment: builder.mutation<unknown, { id: number; taskId: string }>({
      query: ({ id }) => ({ url: `/attachments/${id}`, method: "DELETE" }),
      invalidatesTags: (_r, _e, { taskId }) => [{ type: "Attachment", id: taskId }],
    }),
    notifications: builder.query<NotificationsResponse, void>({
      query: () => ({ url: "/notifications", method: "GET" }),
      providesTags: ["Notification"],
    }),
    markNotificationRead: builder.mutation<unknown, number>({
      query: (id) => ({ url: `/notifications/${id}/read`, method: "POST" }),
      invalidatesTags: ["Notification"],
    }),
    markAllNotificationsRead: builder.mutation<unknown, void>({
      query: () => ({ url: "/notifications/read-all", method: "POST" }),
      invalidatesTags: ["Notification"],
    }),
    taskLinks: builder.query<TaskLink[], string>({
      query: (taskId) => ({ url: `/tasks/${taskId}/links`, method: "GET" }),
      providesTags: ["Link"],
    }),
    addTaskLink: builder.mutation<
      { id: number },
      { taskId: string; to_task_id: string; link_type: string }
    >({
      query: ({ taskId, to_task_id, link_type }) => ({
        url: `/tasks/${taskId}/links`,
        method: "POST",
        body: { to_task_id, link_type },
      }),
      invalidatesTags: ["Link", "Task"],
    }),
    deleteTaskLink: builder.mutation<unknown, { linkId: number; taskId: string }>({
      query: ({ linkId }) => ({ url: `/links/${linkId}`, method: "DELETE" }),
      invalidatesTags: ["Link", "Task"],
    }),
    addSubtask: builder.mutation<Task, { taskId: string } & SubtaskCreate>({
      query: ({ taskId, ...body }) => ({
        url: `/tasks/${taskId}/subtasks`,
        method: "POST",
        body,
      }),
      invalidatesTags: ["Link", "Task"],
    }),
    // Public. 404 unless the backend runs with DEMO_MODE_ENABLED=true.
    startDemo: builder.mutation<DemoResponse, { persona: DemoPersona }>({
      query: (body) => ({ url: "/demo", method: "POST", body }),
    }),
    login: builder.mutation<AuthResponse, LoginPayload>({
      query: (body) => ({
        url: "/login",
        method: "POST",
        body: body,
      }),
    }),
    // Public — no auth required. Lets the login page show/hide the SSO button without
    // guessing; unset OIDC_ISSUER on the backend => { enabled: false }.
    ssoStatus: builder.query<{ enabled: boolean; provider_label: string }, void>({
      query: () => ({ url: "/auth/sso/status", method: "GET" }),
    }),
    // Called once right after an SSO redirect lands with a token (see SsoBootstrap) to
    // hydrate `currentUser` — the redirect itself only carries the token, in a URL fragment.
    authMe: builder.query<Employee, void>({
      query: () => ({ url: "/auth/me", method: "GET" }),
    }),
    // Admin-only, newest-first (scale-gaps-plan.md Phase 3, item 2). Untagged — nothing
    // invalidates it automatically since audit entries are append-only and the page has its
    // own explicit refresh, same pattern as capacity/insights.
    auditLog: builder.query<
      AuditLogResponse,
      { action?: string; actor_emp_id?: string; limit?: number; offset?: number } | void
    >({
      query: (params) => ({ url: "/audit-log", method: "GET", params: params ?? {} }),
    }),
    logout: builder.mutation<unknown, void>({
      query: () => ({
        url: "/logout",
        method: "POST",
      }),
    }),
    createUser: builder.mutation<Employee, Partial<Employee> & { password?: string }>({
      query: (body) => ({
        url: "/user",
        method: "POST",
        body: body,
      }),
      invalidatesTags: ["User"],
    }),
    updateUser: builder.mutation<Employee, Partial<Employee> & { emp_id: string }>({
      query: (body) => ({
        url: `/user/${body.emp_id}`,
        method: "PUT",
        body: body,
      }),
      invalidatesTags: ["User"],
    }),
    // Self-service: current user edits their OWN contact/personal fields (PUT /profile).
    updateProfile: builder.mutation<
      Employee,
      Partial<
        Pick<
          Employee,
          | "emp_phone" | "work_location" | "gender" | "date_of_birth"
          | "blood_group" | "linkedin" | "profile_pic"
        >
      >
    >({
      query: (body) => ({ url: "/profile", method: "PUT", body }),
      invalidatesTags: ["User"],
    }),
    uploadTasks: builder.mutation<UploadResult, FormData>({
      query: (body) => ({
        url: "/tasks/upload",
        method: "POST",
        body: body,
      }),
      invalidatesTags: ["Task"],
    }),
    uploadUsers: builder.mutation<UploadResult, FormData>({
      query: (body) => ({
        url: "/users/upload",
        method: "POST",
        body: body,
      }),
      invalidatesTags: ["User"],
    }),
    register: builder.mutation<AuthResponse, RegisterPayload>({
      query: (body) => ({
        url: "/register",
        method: "POST",
        body: body,
      }),
    }),
    // Onboarding wizard step 1 — read-only, no side effects. `register` (above) is reused
    // unchanged for the wizard's actual password-set step.
    previewOnboarding: builder.mutation<OnboardingPreviewResponse, OnboardingPreviewPayload>({
      query: (body) => ({
        url: "/onboarding/preview",
        method: "POST",
        body: body,
      }),
    }),
    // Admin-only (Administration section, same as Create Users/Manage Users/Audit Log) —
    // company-wide, not org-tree scoped.
    employeeOverview: builder.query<EmployeeOverviewResponse, void>({
      query: () => ({ url: "/admin/employee-overview", method: "GET" }),
    }),
    deleteUser: builder.mutation<unknown, string>({
      query: (emp_id) => ({
        url: `/user/${emp_id}`,
        method: "DELETE",
      }),
      invalidatesTags: ["User"],
    }),
    bulkDeleteUsers: builder.mutation<BulkDeleteResult, { emp_ids: string[] }>({
      query: (body) => ({
        url: "/users/bulk-delete",
        method: "POST",
        body: body,
      }),
      invalidatesTags: ["User"],
    }),
    vapidPublicKey: builder.query<{ public_key: string }, void>({
      query: () => ({ url: "/push/vapid-public-key", method: "GET" }),
    }),
    subscribePush: builder.mutation<
      unknown,
      { endpoint: string; keys: { p256dh: string; auth: string } }
    >({
      query: (body) => ({ url: "/push/subscribe", method: "POST", body }),
    }),
    unsubscribePush: builder.mutation<unknown, { endpoint: string }>({
      query: (body) => ({ url: "/push/unsubscribe", method: "POST", body }),
    }),
    // Per-employee next-48h capacity/utilization (org-tree scoped — same visibility as
    // /tasks and /user). Powers the Organization Resource View / Saturation Heatmap.
    // `days` (optional, default 2 server-side — the original "next-48h" behavior): request a
    // longer horizon (up to MAX_CAPACITY_HORIZON_DAYS=28 server-side) for multi-week
    // resourcing forecasts (scale-gaps-plan.md §B.6).
    capacity: builder.query<CapacityResponse, { days?: number } | void>({
      query: (params) => ({ url: "/capacity", method: "GET", params: params ?? {} }),
    }),
    // Gemini-generated workload summary + recommendations sitting on top of /capacity and
    // /tasks (org-tree scoped). `available: false` on the response is a normal empty state
    // (Gemini not configured / failed), not an error — callers should not treat it as one.
    insights: builder.query<InsightsResponse, void>({
      query: () => ({ url: "/insights", method: "GET" }),
    }),
    // Top-5 assignee candidate ranking for the create-task modal's "who should I assign this
    // to?" shortcut. `tags`/`priority` are re-queried live (debounced) as the user types/picks,
    // and stay cheap/deterministic. `title`/`description` are optional too, but supplying a
    // reasonably long `description` makes the backend call Gemini server-side to classify the
    // task's domain and bias scoring toward matching candidates — real latency, which is why
    // the caller (AssigneeSuggestions) only includes `description` once the field is blurred,
    // not on every keystroke. All four params are optional (the backend ranks by availability
    // alone when omitted).
    assigneeSuggestions: builder.query<
      AssigneeSuggestion[],
      { tags?: string; priority?: string; title?: string; description?: string } | void
    >({
      query: (params) => ({
        url: "/tasks/assignee-suggestions",
        method: "GET",
        params: params ?? {},
      }),
    }),
    // Epics — one level above a story (see types.ts#Epic). Company-wide, not org-tree
    // scoped, so a single list works for everyone (mirrors GET /user's org-chart directory).
    epicList: builder.query<Epic[], void>({
      query: () => ({ url: "/epics", method: "GET" }),
      providesTags: ["Epic"],
    }),
    getEpic: builder.query<Epic, string>({
      query: (id) => ({ url: `/epics/${id}`, method: "GET" }),
      providesTags: (_r, _e, id) => [{ type: "Epic", id }],
    }),
    createEpic: builder.mutation<Epic, EpicCreatePayload>({
      query: (body) => ({ url: "/epics", method: "POST", body }),
      invalidatesTags: ["Epic"],
    }),
    updateEpic: builder.mutation<Epic, EpicCreatePayload & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/epics/${id}`, method: "PUT", body }),
      invalidatesTags: (_r, _e, { id }) => ["Epic", { type: "Epic", id }, "Task"],
    }),
    deleteEpic: builder.mutation<unknown, string>({
      query: (id) => ({ url: `/epics/${id}`, method: "DELETE" }),
      invalidatesTags: ["Epic", "Task"],
    }),
    // Full dependency/subtask graph reachable from a task (not just one hop) — powers a
    // "view graph" affordance from TaskLinks.tsx (scale-gaps-plan.md §A.6).
    taskGraph: builder.query<TaskGraph, string>({
      query: (taskId) => ({ url: `/tasks/${taskId}/graph`, method: "GET" }),
      providesTags: ["Link"],
    }),
    // Sprints/Cycles — company-wide, not org-tree scoped (same reasoning as Epics).
    sprintList: builder.query<Sprint[], void>({
      query: () => ({ url: "/sprints", method: "GET" }),
      providesTags: ["Sprint"],
    }),
    getSprint: builder.query<Sprint, string>({
      query: (id) => ({ url: `/sprints/${id}`, method: "GET" }),
      providesTags: (_r, _e, id) => [{ type: "Sprint", id }],
    }),
    createSprint: builder.mutation<Sprint, SprintCreatePayload>({
      query: (body) => ({ url: "/sprints", method: "POST", body }),
      invalidatesTags: ["Sprint"],
    }),
    updateSprint: builder.mutation<Sprint, SprintCreatePayload & { id: string }>({
      query: ({ id, ...body }) => ({ url: `/sprints/${id}`, method: "PUT", body }),
      invalidatesTags: (_r, _e, { id }) => ["Sprint", { type: "Sprint", id }, "Task"],
    }),
    deleteSprint: builder.mutation<unknown, string>({
      query: (id) => ({ url: `/sprints/${id}`, method: "DELETE" }),
      invalidatesTags: ["Sprint", "Task"],
    }),
    // Ideal vs actual burndown for one sprint — see BurndownResponse's doc comment.
    sprintBurndown: builder.query<BurndownResponse, string>({
      query: (sprintId) => ({ url: `/sprints/${sprintId}/burndown`, method: "GET" }),
      providesTags: (_r, _e, sprintId) => [{ type: "Sprint", id: sprintId }],
    }),
  }),
});

export const { useStartDemoMutation, useUserListQuery, useLazyUserListQuery, useLazyTaskListQuery, useTaskListQuery, useCreateTaskMutation, useUpdateTaskMutation, useDeleteTaskMutation, useDeleteTaskSessionMutation, useEditTaskSessionMutation, useSplitTaskSessionMutation, useTaskCommentsQuery, useAddCommentMutation, useDeleteCommentMutation, useTaskAttachmentsQuery, useAddTaskAttachmentMutation, useDeleteTaskAttachmentMutation, useNotificationsQuery, useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation, useTaskLinksQuery, useAddTaskLinkMutation, useDeleteTaskLinkMutation, useAddSubtaskMutation, useLazyGetUserQuery, useLoginMutation, useSsoStatusQuery, useLazyAuthMeQuery, useAuditLogQuery, useLogoutMutation, useCreateUserMutation, useUploadTasksMutation, useUploadUsersMutation, useUpdateUserMutation, useUpdateProfileMutation, useRegisterMutation, useDeleteUserMutation, useBulkDeleteUsersMutation, useLazyVapidPublicKeyQuery, useSubscribePushMutation, useUnsubscribePushMutation, useCapacityQuery, useInsightsQuery, useAssigneeSuggestionsQuery, useEpicListQuery, useGetEpicQuery, useCreateEpicMutation, useUpdateEpicMutation, useDeleteEpicMutation, useTaskGraphQuery, useSprintListQuery, useGetSprintQuery, useCreateSprintMutation, useUpdateSprintMutation, useDeleteSprintMutation, useSprintBurndownQuery, usePreviewOnboardingMutation, useEmployeeOverviewQuery } = userApi;
