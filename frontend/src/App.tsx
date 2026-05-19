import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Send,
  ShieldAlert,
  Store,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AuditEntry,
  Business,
  ChatMessage,
  ChatResponse,
  listAuditLog,
  listBusinesses,
  sendMessage,
} from "./api";

type OutcomeFilter = "all" | AuditEntry["outcome"];

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "agent",
    content: "What can I help you schedule today?",
  },
];

export function App() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [busy, setBusy] = useState(false);
  const [auditBusy, setAuditBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === businessId),
    [businessId, businesses],
  );

  useEffect(() => {
    listBusinesses()
      .then((items) => {
        setBusinesses(items);
        setBusinessId(items[0]?.id ?? "");
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!businessId) return;
    refreshAuditLog();
  }, [businessId, filter]);

  async function refreshAuditLog() {
    if (!businessId) return;
    setAuditBusy(true);
    try {
      setAuditLog(await listAuditLog(businessId, filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit log failed");
    } finally {
      setAuditBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !businessId || busy) return;

    const customerMessage: ChatMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "customer",
      content,
    };
    setMessages((current) => [...current, customerMessage]);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const response: ChatResponse = await sendMessage(businessId, content, conversationId);
      setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        {
          id: response.message_id,
          role: "agent",
          content: response.content,
        },
      ]);
      await refreshAuditLog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message failed");
      setMessages((current) => [
        ...current,
        {
          id: `error-${crypto.randomUUID()}`,
          role: "agent",
          content: "The agent is unavailable right now.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function resetChat(nextBusinessId: string) {
    setBusinessId(nextBusinessId);
    setConversationId(undefined);
    setMessages(starterMessages);
    setError(null);
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Revin Guardrail
            </p>
            <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">
              Owner-safe booking console
            </h1>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted)]">
            <Store className="h-4 w-4" aria-hidden="true" />
            <select
              className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] shadow-rule outline-none transition focus:border-[var(--focus)]"
              value={businessId}
              onChange={(event) => resetChat(event.target.value)}
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        {error ? <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}

        <div className="grid flex-1 gap-5 py-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.4fr)]">
          <section className="flex min-h-[620px] flex-col rounded-lg border border-[var(--line)] bg-white shadow-rule">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
              <div>
                <h2 className="text-base font-semibold">Chat</h2>
                <p className="text-xs text-[var(--muted)]">{selectedBusiness?.name ?? "Loading"}</p>
              </div>
              <span className="rounded-md bg-[var(--amber-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--amber)]">
                {busy ? "thinking" : "ready"}
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-6 ${
                    message.role === "customer"
                      ? "ml-auto bg-[var(--ink)] text-white"
                      : "mr-auto border border-[var(--line)] bg-[var(--wash)] text-[var(--ink)]"
                  }`}
                >
                  {message.content}
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2 border-t border-[var(--line)] p-3">
              <input
                className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--focus)]"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Can you book AC repair Sunday at 2pm in 78704?"
              />
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-[var(--focus)] text-white transition hover:bg-[var(--focus-dark)] disabled:cursor-not-allowed disabled:opacity-45"
                type="submit"
                disabled={busy || !draft.trim()}
                title="Send"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          </section>

          <section className="rounded-lg border border-[var(--line)] bg-white shadow-rule">
            <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold">Audit Log</h2>
                <p className="text-xs text-[var(--muted)]">
                  {auditLog.length} entries
                </p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  className="h-9 rounded-md border border-[var(--line)] bg-white px-2 text-sm outline-none focus:border-[var(--focus)]"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value as OutcomeFilter)}
                >
                  <option value="all">All</option>
                  <option value="blocked">Blocked</option>
                  <option value="flagged">Flagged</option>
                  <option value="allowed">Allowed</option>
                </select>
                <button
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--wash)]"
                  type="button"
                  onClick={refreshAuditLog}
                  title="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${auditBusy ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs uppercase tracking-[0.14em] text-[var(--muted)]">
                    <th className="px-4 py-3 font-semibold">Outcome</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry) => (
                    <tr key={entry.id} className="border-b border-[var(--line)] last:border-b-0">
                      <td className="px-4 py-3">
                        <OutcomeBadge outcome={entry.outcome} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {String(entry.action_proposed.type ?? "action")}
                      </td>
                      <td className="max-w-[360px] px-4 py-3 text-[var(--muted-strong)]">
                        {entry.violations[0]?.reason ?? "Allowed"}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {formatTime(entry.created_at)}
                      </td>
                    </tr>
                  ))}
                  {!auditLog.length ? (
                    <tr>
                      <td className="px-4 py-10 text-center text-sm text-[var(--muted)]" colSpan={4}>
                        No entries yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function OutcomeBadge({ outcome }: { outcome: AuditEntry["outcome"] }) {
  const icon =
    outcome === "allowed" ? (
      <CheckCircle2 className="h-4 w-4" />
    ) : outcome === "flagged" ? (
      <AlertTriangle className="h-4 w-4" />
    ) : (
      <ShieldAlert className="h-4 w-4" />
    );

  return (
    <span className={`outcome outcome-${outcome}`}>
      {icon}
      {outcome}
    </span>
  );
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}
