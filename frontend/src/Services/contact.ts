import { CONTACT_API_URL } from "Utils/constants";

export const TEAM_SIZES = ["1-10", "11-50", "51-200", "200+"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

export interface WorkspaceRequest {
  name: string;
  email: string;
  company: string;
  teamSize: TeamSize | "";
  message: string;
}

export type WorkspaceRequestField = keyof WorkspaceRequest;

export type ContactResult =
  | { ok: true }
  | { ok: false; kind: "rate_limited" | "network" | "server" }
  | { ok: false; kind: "validation"; fieldErrors: Partial<Record<WorkspaceRequestField, string>> };

/** Free hosts can take most of a minute to wake; give up well after that. */
const TIMEOUT_MS = 90_000;

// The contact API's field names, mapped back to this form's fields.
const SERVER_FIELDS: Record<string, WorkspaceRequestField> = {
  first_name: "name",
  last_name: "name",
  email: "email",
  company: "company",
  team_size: "teamSize",
  message: "message",
};

export const splitName = (name: string): { first_name: string; last_name: string } => {
  const [first = "", ...rest] = name.trim().split(/\s+/);
  return { first_name: first, last_name: rest.join(" ") };
};

/** POST a "Request a workspace" inquiry to the shared contact API (`/contact`). Never throws. */
export const sendWorkspaceRequest = async (form: WorkspaceRequest): Promise<ContactResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CONTACT_API_URL}/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...splitName(form.name),
        email: form.email.trim(),
        mobile: "",
        message: form.message.trim(),
        company: form.company.trim(),
        team_size: form.teamSize,
        source: "dayline",
        inquiry_type: "workspace_request",
        website: "",
      }),
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) return { ok: false, kind: "rate_limited" };
    if (res.status === 422) {
      const fieldErrors: Partial<Record<WorkspaceRequestField, string>> = {};
      try {
        const body = await res.json();
        for (const item of Array.isArray(body?.detail) ? body.detail : []) {
          const field = SERVER_FIELDS[String(item?.loc?.[item.loc.length - 1])];
          if (field && !fieldErrors[field]) fieldErrors[field] = String(item.msg || "Check this field.");
        }
      } catch {
        // No readable body: fall back to the generic validation message.
      }
      return { ok: false, kind: "validation", fieldErrors };
    }
    return { ok: false, kind: "server" };
  } catch {
    return { ok: false, kind: "network" };
  } finally {
    clearTimeout(timer);
  }
};
