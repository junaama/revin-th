import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Store,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AuditEntry,
  Business,
  ChatMessage,
  ChatResponse,
  RuleRecord,
  createRule,
  deleteRule,
  listAuditLog,
  listBusinesses,
  listRules,
  sendMessage,
  updateRule,
} from "./api";

type OutcomeFilter = "all" | AuditEntry["outcome"];

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "agent",
    content: "What can I help you schedule today?",
  },
];

const defaultRuleJson = JSON.stringify(
  {
    type: "services_offered",
    services: ["hvac repair", "ac tune up"],
  },
  null,
  2,
);

export function App() {
  const path = window.location.pathname;
  if (path.startsWith("/chat/")) {
    const businessId = decodeURIComponent(path.split("/")[2] ?? "");
    return <CustomerChatPage businessId={businessId} />;
  }
  if (path === "/dashboard") {
    return <OwnerDashboardPage />;
  }
  return <RouteIndexPage />;
}

function RouteIndexPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listBusinesses()
      .then(setBusinesses)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <Shell
      eyebrow="Revin Guardrail"
      title="Demo routes"
      actions={<NavLink href="/dashboard">Owner dashboard</NavLink>}
    >
      <section className="grid gap-4 py-6 md:grid-cols-2">
        {error ? <ErrorBanner message={error} /> : null}
        {businesses.map((business) => (
          <a
            className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-rule transition hover:border-[var(--focus)]"
            href={`/chat/${business.id}`}
            key={business.id}
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
              Customer chat
            </p>
            <h2 className="mt-1 text-lg font-semibold">{business.name}</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">{business.timezone}</p>
          </a>
        ))}
      </section>
    </Shell>
  );
}

function CustomerChatPage({ businessId }: { businessId: string }) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const business = useMemo(
    () => businesses.find((item) => item.id === businessId),
    [businessId, businesses],
  );

  useEffect(() => {
    listBusinesses()
      .then(setBusinesses)
      .catch((err) => setError(err.message));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;

    setMessages((current) => [
      ...current,
      { id: `local-${crypto.randomUUID()}`, role: "customer", content },
    ]);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const response: ChatResponse = await sendMessage(businessId, content, conversationId);
      setConversationId(response.conversation_id);
      setMessages((current) => [
        ...current,
        { id: response.message_id, role: "agent", content: response.content },
      ]);
    } catch {
      setError("The agent is unavailable right now.");
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

  return (
    <Shell
      eyebrow={business?.name ?? businessId}
      title="Customer chat"
      actions={<NavLink href="/dashboard">Owner dashboard</NavLink>}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <section className="mx-auto flex min-h-[calc(100vh-170px)] w-full max-w-3xl flex-col rounded-lg border border-[var(--line)] bg-white shadow-rule">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">{business?.name ?? "Business chat"}</h2>
            <p className="text-xs text-[var(--muted)]">Customer session</p>
          </div>
          <span className="rounded-md bg-[var(--amber-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--amber)]">
            {busy ? "thinking" : "ready"}
          </span>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
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
    </Shell>
  );
}

function OwnerDashboardPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [ruleDraft, setRuleDraft] = useState(defaultRuleJson);
  const [busy, setBusy] = useState(false);
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
    void refreshOwnerData();
  }, [businessId, filter]);

  async function refreshOwnerData() {
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      const [nextAuditLog, nextRules] = await Promise.all([
        listAuditLog(businessId, filter),
        listRules(businessId),
      ]);
      setAuditLog(nextAuditLog);
      setRules(nextRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dashboard refresh failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = JSON.parse(ruleDraft) as Record<string, unknown>;
      await createRule(businessId, payload);
      setRuleDraft(defaultRuleJson);
      await refreshOwnerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rule create failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleRule(rule: RuleRecord) {
    setBusy(true);
    setError(null);
    try {
      await updateRule(businessId, rule.id, { enabled: !rule.enabled });
      await refreshOwnerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rule update failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRule(rule: RuleRecord) {
    setBusy(true);
    setError(null);
    try {
      await deleteRule(businessId, rule.id);
      await refreshOwnerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rule delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      eyebrow="Owner dashboard"
      title={selectedBusiness?.name ?? "Business controls"}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {businessId ? (
            <NavLink href={`/chat/${businessId}`}>
              Customer chat <ExternalLink className="h-3.5 w-3.5" />
            </NavLink>
          ) : null}
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--muted)]">
            <Store className="h-4 w-4" aria-hidden="true" />
            <select
              className="h-10 rounded-md border border-[var(--line)] bg-white px-3 text-sm text-[var(--ink)] shadow-rule outline-none transition focus:border-[var(--focus)]"
              value={businessId}
              onChange={(event) => setBusinessId(event.target.value)}
            >
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {business.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      {error ? <ErrorBanner message={error} /> : null}
      <div className="grid gap-5 py-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(380px,0.8fr)]">
        <AuditLogPanel
          auditLog={auditLog}
          busy={busy}
          filter={filter}
          onFilter={setFilter}
          onRefresh={refreshOwnerData}
        />
        <RulesPanel
          busy={busy}
          rules={rules}
          ruleDraft={ruleDraft}
          onRuleDraft={setRuleDraft}
          onCreateRule={handleCreateRule}
          onToggleRule={handleToggleRule}
          onDeleteRule={handleDeleteRule}
        />
      </div>
    </Shell>
  );
}

function AuditLogPanel({
  auditLog,
  busy,
  filter,
  onFilter,
  onRefresh,
}: {
  auditLog: AuditEntry[];
  busy: boolean;
  filter: OutcomeFilter;
  onFilter: (filter: OutcomeFilter) => void;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-white shadow-rule">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Audit Log</h2>
          <p className="text-xs text-[var(--muted)]">{auditLog.length} entries</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-[var(--line)] bg-white px-2 text-sm outline-none focus:border-[var(--focus)]"
            value={filter}
            onChange={(event) => onFilter(event.target.value as OutcomeFilter)}
          >
            <option value="all">All</option>
            <option value="blocked">Blocked</option>
            <option value="flagged">Flagged</option>
            <option value="allowed">Allowed</option>
          </select>
          <IconButton label="Refresh" onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </IconButton>
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
  );
}

function RulesPanel({
  busy,
  rules,
  ruleDraft,
  onRuleDraft,
  onCreateRule,
  onToggleRule,
  onDeleteRule,
}: {
  busy: boolean;
  rules: RuleRecord[];
  ruleDraft: string;
  onRuleDraft: (value: string) => void;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onToggleRule: (rule: RuleRecord) => void;
  onDeleteRule: (rule: RuleRecord) => void;
}) {
  return (
    <section className="rounded-lg border border-[var(--line)] bg-white shadow-rule">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <h2 className="text-base font-semibold">Rules</h2>
        <p className="text-xs text-[var(--muted)]">{rules.length} configured</p>
      </div>

      <div className="divide-y divide-[var(--line)]">
        {rules.map((rule) => (
          <article className="p-4" key={rule.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-[var(--muted)]">{rule.id}</p>
                <h3 className="mt-1 text-sm font-semibold">{rule.type}</h3>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted-strong)]">
                  <input
                    checked={rule.enabled}
                    className="h-4 w-4 accent-[var(--focus)]"
                    disabled={busy}
                    onChange={() => onToggleRule(rule)}
                    type="checkbox"
                  />
                  Enabled
                </label>
                <IconButton label="Delete rule" onClick={() => onDeleteRule(rule)} disabled={busy}>
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            </div>
            <pre className="mt-3 max-h-44 overflow-auto rounded-md bg-[var(--wash)] p-3 text-xs leading-5 text-[var(--muted-strong)]">
              {JSON.stringify(rule.config, null, 2)}
            </pre>
          </article>
        ))}
      </div>

      <form className="border-t border-[var(--line)] p-4" onSubmit={onCreateRule}>
        <label className="text-sm font-semibold" htmlFor="rule-json">
          New rule JSON
        </label>
        <textarea
          className="mt-2 h-44 w-full resize-y rounded-md border border-[var(--line)] bg-white p-3 font-mono text-xs outline-none focus:border-[var(--focus)]"
          id="rule-json"
          onChange={(event) => onRuleDraft(event.target.value)}
          value={ruleDraft}
        />
        <button
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-[var(--focus)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--focus-dark)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={busy}
          type="submit"
        >
          <Plus className="h-4 w-4" />
          Add rule
        </button>
      </form>
    </section>
  );
}

function Shell({
  actions,
  children,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              {eyebrow}
            </p>
            <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">{title}</h1>
          </div>
          {actions}
        </header>
        {children}
      </section>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div
      className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-6 ${
        message.role === "customer"
          ? "ml-auto bg-[var(--ink)] text-white"
          : "mr-auto border border-[var(--line)] bg-[var(--wash)] text-[var(--ink)]"
      }`}
    >
      {message.content}
    </div>
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

function IconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--wash)] disabled:cursor-not-allowed disabled:opacity-45"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function NavLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <a
      className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold text-[var(--ink)] shadow-rule transition hover:border-[var(--focus)]"
      href={href}
    >
      {children}
    </a>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </div>
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
