export type Business = {
  id: string;
  name: string;
  timezone: string;
};

export type ChatMessage = {
  id: string;
  role: "customer" | "agent" | "system";
  content: string;
  created_at?: number;
};

export type ChatResponse = {
  conversation_id: string;
  message_id: string;
  content: string;
  outcome: "allowed" | "blocked" | "flagged";
};

export type AuditEntry = {
  id: string;
  business_id: string;
  conversation_id: string | null;
  customer_name: string | null;
  action_proposed: Record<string, unknown>;
  outcome: "allowed" | "blocked" | "flagged";
  violations: Array<{ reason: string; rule_type: string; blocking?: boolean }>;
  created_at: number;
};

export type RuleType =
  | "service_area"
  | "business_hours"
  | "services_offered"
  | "booking_policy";

export type RuleRecord = {
  id: string;
  business_id: string;
  type: RuleType;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type ServiceWizardPayload = {
  mode: "create" | "edit";
  service: {
    name: string;
    service_area: {
      inherit_default: boolean;
      zip_codes: string[];
      cities: string[];
    };
    availability: {
      inherit_default: boolean;
      windows: Array<{
        day: DayOfWeek;
        open_time: string;
        close_time: string;
      }>;
      exceptions: Array<{
        label: string;
        start: string;
        end: string;
      }>;
    };
    booking_policy: {
      min_lead_minutes: number;
      max_advance_days: number;
    };
  };
};

export type ServiceWizardResponse = {
  service: string;
  created_rule_ids: string[];
  deleted_rule_ids: string[];
};

export type WizardFieldError = {
  step: number;
  field: string;
  message: string;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listBusinesses(): Promise<Business[]> {
  return request<Business[]>("/businesses");
}

export function sendMessage(
  businessId: string,
  content: string,
  conversationId?: string,
): Promise<ChatResponse> {
  return request<ChatResponse>(`/chat/${businessId}/messages`, {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, content }),
  });
}

export type ChatStreamHandlers = {
  onStatus?: (phase: "thinking" | "responding", extra?: Record<string, unknown>) => void;
  onToken?: (text: string) => void;
  onDone?: (payload: {
    conversation_id: string;
    message_id: string;
    outcome: "allowed" | "blocked" | "flagged";
  }) => void;
  onError?: (message: string) => void;
};

export async function streamMessage(
  businessId: string,
  content: string,
  conversationId: string | undefined,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_URL}/chat/${businessId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ conversation_id: conversationId, content }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `Chat request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleSseFrame(raw, handlers);
      separator = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    handleSseFrame(buffer, handlers);
  }
}

function handleSseFrame(raw: string, handlers: ChatStreamHandlers): void {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return;
  const dataText = dataLines.join("\n");

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(dataText) as Record<string, unknown>;
  } catch {
    if (event === "token") data = { text: dataText };
  }

  if (event === "status") {
    const phase = data.phase as "thinking" | "responding" | undefined;
    if (phase) handlers.onStatus?.(phase, data);
  } else if (event === "token") {
    const text = typeof data.text === "string" ? data.text : "";
    if (text) handlers.onToken?.(text);
  } else if (event === "done") {
    handlers.onDone?.({
      conversation_id: String(data.conversation_id ?? ""),
      message_id: String(data.message_id ?? ""),
      outcome: (data.outcome ?? "allowed") as "allowed" | "blocked" | "flagged",
    });
  } else if (event === "error") {
    handlers.onError?.(String(data.message ?? "Agent error"));
  }
}

export function listAuditLog(
  businessId: string,
  outcome?: AuditEntry["outcome"] | "all",
): Promise<AuditEntry[]> {
  const params = outcome && outcome !== "all" ? `?outcome=${outcome}` : "";
  return request<AuditEntry[]>(`/audit-log${params}`, {
    headers: { "X-Business-Id": businessId },
  });
}

export function listRules(businessId: string): Promise<RuleRecord[]> {
  return request<RuleRecord[]>("/rules", {
    headers: { "X-Business-Id": businessId },
  });
}

export function createRule(
  businessId: string,
  payload: Record<string, unknown>,
): Promise<RuleRecord> {
  return request<RuleRecord>("/rules", {
    method: "POST",
    headers: { "X-Business-Id": businessId },
    body: JSON.stringify(payload),
  });
}

export function updateRule(
  businessId: string,
  ruleId: string,
  payload: Record<string, unknown>,
): Promise<RuleRecord> {
  return request<RuleRecord>(`/rules/${ruleId}`, {
    method: "PATCH",
    headers: { "X-Business-Id": businessId },
    body: JSON.stringify(payload),
  });
}

export function deleteRule(businessId: string, ruleId: string): Promise<void> {
  return fetch(`${API_URL}/rules/${ruleId}`, {
    method: "DELETE",
    headers: { "X-Business-Id": businessId },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }
  });
}

export function submitServiceWizard(
  businessId: string,
  payload: ServiceWizardPayload,
): Promise<ServiceWizardResponse> {
  return request<ServiceWizardResponse>("/service-wizard", {
    method: "POST",
    headers: { "X-Business-Id": businessId },
    body: JSON.stringify(payload),
  });
}

export function deleteService(
  businessId: string,
  serviceName: string,
): Promise<void> {
  return fetch(
    `${API_URL}/service-wizard/${encodeURIComponent(serviceName)}`,
    {
      method: "DELETE",
      headers: { "X-Business-Id": businessId },
    },
  ).then((response) => {
    if (!response.ok) {
      throw new Error(`Delete failed: ${response.status}`);
    }
  });
}
