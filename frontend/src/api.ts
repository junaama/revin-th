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

export function listAuditLog(
  businessId: string,
  outcome?: AuditEntry["outcome"] | "all",
): Promise<AuditEntry[]> {
  const params = outcome && outcome !== "all" ? `?outcome=${outcome}` : "";
  return request<AuditEntry[]>(`/audit-log${params}`, {
    headers: { "X-Business-Id": businessId },
  });
}
