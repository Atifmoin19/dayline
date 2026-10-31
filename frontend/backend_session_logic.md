# Backend Session Management Requirements

The current frontend implementation manually manages `task_sessions` to ensure data integrity because the backend implementation of `PUT /tasks/{id}` does not automatically handle session lifecycle events.

To make the system robust and move this logic to the backend (as requested), the following changes are required in the `PUT /tasks/{id}` (or equivalent update) API endpoint:

## 1. Status Change Handling

When the API receives a request to update `task_status`, it must trigger session management logic **before** saving the task.

### A. Transition to "On-Hold" or "Done"

**Scenario:** User moves a task from `in-progress` to `on-hold` or `done`.
**Logic:**

1.  Fetch the current task from the database.
2.  Check for any **Active Session** in `task_sessions` (where `end_time` is `null` or missing).
3.  **Close the Session:** Update `end_time` to the current server timestamp (UTC).
4.  Calculate `duration` for this session and add it to the task's total `time_spent`.
5.  Update status to `on-hold` / `done`.
6.  Updates `task_updated_at`.

### B. Transition to "In-Progress" (Pick Up / Resume)

**Scenario:** User moves a task from `todo`, `backlog`, or `on-hold` to `in-progress`.
**Logic:**

1.  **Close Previous Sessions:** Ensure no other sessions for this task are open (sanity check).
2.  **Create New Session:** Append a NEW session object to `task_sessions`:
    ```json
    {
      "start_time": "CURRENT_SERVER_TIMESTAMP_UTC",
      "end_time": null,
      "status": "in-progress"
    }
    ```
3.  Update `task_assigned_date` to current timestamp (Pick Up Time).
4.  Update status to `in-progress`.

## 2. API Payload Expectation

Once the backend implements the above logic, the Frontend will send **Only the Status Change**:

```json
{
  "id": "task_123",
  "task_status": "on-hold"
}
```

And the Backend will return the full task object with the closed session.

**Currently (Frontend Patch):**
The frontend is forced to send the entire `task_sessions` array with modifications because the backend does not perform these actions automatically.

```json
// Current Frontend Workaround Payload
{
  "id": "task_123",
  "task_status": "on-hold",
  "task_sessions": [
    { "start_time": "...", "end_time": "NOW", "status": "in-progress" } // Manually closed by frontend
  ]
}
```

## 3. Data Integrity

- Ensure `time_spent` is recalculated accurately on the server side whenever a session is closed.
- Ensure timestamps are strictly UTC.
- Prevent multiple "Open" sessions for the same task.
