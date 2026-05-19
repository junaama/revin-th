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
  RuleRecord,
  createRule,
  deleteRule,
  listAuditLog,
  listBusinesses,
  listRules,
  streamMessage,
  updateRule,
} from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Checkbox } from "./components/ui/checkbox";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { Textarea } from "./components/ui/textarea";
import { ServicesListPage } from "./pages/ServicesListPage";
import { ServiceWizardPage } from "./pages/ServiceWizardPage";

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
  if (path === "/dashboard/services") {
    return <ServicesListPage />;
  }
  if (path === "/dashboard/services/new") {
    return <ServiceWizardPage mode="create" serviceName={null} />;
  }
  const editMatch = path.match(/^\/dashboard\/services\/([^/]+)\/edit$/);
  if (editMatch) {
    const name = decodeURIComponent(editMatch[1]);
    return <ServiceWizardPage mode="edit" serviceName={name} />;
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
      eyebrow="Agent Revin"
      title="Demo routes"
      actions={<NavLink href="/dashboard">Owner dashboard</NavLink>}
    >
      <section className="grid gap-4 py-6 md:grid-cols-2">
        {error ? <ErrorBanner message={error} /> : null}
        {businesses.map((business) => (
          <a
            className="block transition hover:-translate-y-0.5"
            href={`/chat/${business.id}`}
            key={business.id}
          >
            <Card className="h-full transition-colors hover:border-[var(--focus)]">
              <CardHeader>
                <CardDescription>Customer chat</CardDescription>
                <CardTitle className="text-lg">{business.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-[var(--muted)]">{business.timezone}</p>
              </CardContent>
            </Card>
          </a>
        ))}
      </section>
    </Shell>
  );
}

type AgentPhase = "idle" | "thinking" | "responding";

function CustomerChatPage({ businessId }: { businessId: string }) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(starterMessages);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== "idle";

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

    const pendingId = `pending-${crypto.randomUUID()}`;
    setMessages((current) => [
      ...current,
      { id: `local-${crypto.randomUUID()}`, role: "customer", content },
      { id: pendingId, role: "agent", content: "" },
    ]);
    setDraft("");
    setPhase("thinking");
    setError(null);

    try {
      await streamMessage(
        businessId,
        content,
        conversationId,
        {
          onStatus: (nextPhase) => setPhase(nextPhase),
          onToken: (token) => {
            setPhase("responding");
            setMessages((current) =>
              current.map((message) =>
                message.id === pendingId
                  ? { ...message, content: message.content + token }
                  : message,
              ),
            );
          },
          onDone: ({ conversation_id, message_id }) => {
            setConversationId(conversation_id);
            setMessages((current) =>
              current.map((message) =>
                message.id === pendingId ? { ...message, id: message_id } : message,
              ),
            );
          },
          onError: (message) => setError(message),
        },
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Agent error";
      setError(detail || "The agent is unavailable right now.");
      setMessages((current) =>
        current.map((message) =>
          message.id === pendingId
            ? { ...message, content: "The agent is unavailable right now." }
            : message,
        ),
      );
    } finally {
      setPhase("idle");
    }
  }

  return (
    <Shell
      eyebrow={business?.name ?? businessId}
      title="Customer chat"
      actions={<NavLink href="/dashboard">Owner dashboard</NavLink>}
    >
      {error ? <ErrorBanner message={error} /> : null}
      <Card className="mx-auto flex min-h-[calc(100vh-170px)] w-full max-w-3xl flex-col">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle>{business?.name ?? "Business chat"}</CardTitle>
            <CardDescription>Customer session</CardDescription>
          </div>
          <Badge variant={phase === "idle" ? "secondary" : "warning"}>
            {phase === "thinking" ? "thinking…" : phase === "responding" ? "responding…" : "ready"}
          </Badge>
        </CardHeader>

        <CardContent className="flex-1 space-y-3 overflow-y-auto">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </CardContent>

        <CardFooter>
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
          <Input
            className="min-w-0 flex-1"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Can you book AC repair Sunday at 2pm in 78704?"
          />
          <Button
            size="icon"
            type="submit"
            disabled={busy || !draft.trim()}
            title="Send"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
          </form>
        </CardFooter>
      </Card>
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
          <NavLink href="/dashboard/services">Services</NavLink>
          {businessId ? (
            <NavLink href={`/chat/${businessId}`}>
              Customer chat <ExternalLink className="h-3.5 w-3.5" />
            </NavLink>
          ) : null}
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--muted)]">
            <Store className="h-4 w-4" aria-hidden="true" />
            <Select
              value={businessId}
              onValueChange={setBusinessId}
              disabled={!businesses.length}
            >
              <SelectTrigger aria-label="Business" className="min-w-[13rem]">
                <SelectValue placeholder="Select business" />
              </SelectTrigger>
              <SelectContent>
                {businesses.map((business) => (
                  <SelectItem key={business.id} value={business.id}>
                    {business.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Audit Log</CardTitle>
          <CardDescription>{auditLog.length} entries</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onValueChange={(value) => onFilter(value as OutcomeFilter)}
          >
            <SelectTrigger aria-label="Audit outcome filter" className="h-9 min-w-[8rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="flagged">Flagged</SelectItem>
              <SelectItem value="allowed">Allowed</SelectItem>
            </SelectContent>
          </Select>
          <IconButton label="Refresh" onClick={onRefresh}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          </IconButton>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Outcome</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {auditLog.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>
                  <OutcomeBadge outcome={entry.outcome} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {String(entry.action_proposed.type ?? "action")}
                </TableCell>
                <TableCell className="max-w-[360px] text-[var(--muted-strong)]">
                  {entry.violations[0]?.reason ?? "Allowed"}
                </TableCell>
                <TableCell className="text-xs text-[var(--muted)]">
                  {formatTime(entry.created_at)}
                </TableCell>
              </TableRow>
            ))}
            {!auditLog.length ? (
              <TableRow>
                <TableCell className="py-10 text-center text-sm text-[var(--muted)]" colSpan={4}>
                  No entries yet.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>Rules</CardTitle>
        <CardDescription>{rules.length} configured</CardDescription>
      </CardHeader>

      <CardContent className="divide-y divide-[var(--line)] p-0">
        {rules.map((rule) => (
          <article className="p-4" key={rule.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-[var(--muted)]">{rule.id}</p>
                <h3 className="mt-1 text-sm font-semibold">{rule.type}</h3>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`enabled-${rule.id}`}
                  checked={rule.enabled}
                  disabled={busy}
                  onCheckedChange={() => onToggleRule(rule)}
                />
                <Label
                  htmlFor={`enabled-${rule.id}`}
                  className="text-xs font-semibold text-[var(--muted-strong)]"
                >
                  Enabled
                </Label>
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
      </CardContent>

      <CardFooter>
      <form className="w-full" onSubmit={onCreateRule}>
        <Label htmlFor="rule-json">
          New rule JSON
        </Label>
        <Textarea
          className="mt-2 h-44 resize-y font-mono text-xs"
          id="rule-json"
          onChange={(event) => onRuleDraft(event.target.value)}
          value={ruleDraft}
        />
        <Button
          className="mt-3"
          disabled={busy}
          type="submit"
        >
          <Plus className="h-4 w-4" />
          Add rule
        </Button>
      </form>
      </CardFooter>
    </Card>
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
  const isAgent = message.role !== "customer";
  const isEmptyAgent = isAgent && message.content === "";
  return (
    <div
      className={`max-w-[88%] rounded-lg px-3 py-2 text-sm leading-6 ${
        message.role === "customer"
          ? "ml-auto bg-[var(--ink)] text-white"
          : "mr-auto border border-[var(--line)] bg-[var(--wash)] text-[var(--ink)]"
      }`}
    >
      {isEmptyAgent ? (
        <ThinkingIndicator />
      ) : isAgent ? (
        <AssistantText content={message.content} />
      ) : (
        message.content
      )}
      {isAgent && !isEmptyAgent && message.id.startsWith("pending-") ? (
        <span className="ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] animate-pulse bg-[var(--ink)] align-middle" />
      ) : null}
    </div>
  );
}

function AssistantText({ content }: { content: string }) {
  return (
    <span className="whitespace-pre-wrap">
      {content.split("\n").map((line, lineIndex) => (
        <span key={`${line}-${lineIndex}`}>
          {lineIndex > 0 ? "\n" : null}
          {renderBoldSegments(line)}
        </span>
      ))}
    </span>
  );
}

function renderBoldSegments(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function ThinkingIndicator() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--muted)]">
      <span>thinking</span>
      <span className="flex gap-0.5">
        <span className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" />
        <span
          className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]"
          style={{ animationDelay: "120ms" }}
        />
        <span
          className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]"
          style={{ animationDelay: "240ms" }}
        />
      </span>
    </span>
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
    <Button
      variant="outline"
      size="icon"
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </Button>
  );
}

function NavLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Button asChild variant="outline">
      <a href={href}>{children}</a>
    </Button>
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
