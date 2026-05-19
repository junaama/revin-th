import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Code2,
  ExternalLink,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  SlidersHorizontal,
  ShieldAlert,
  Store,
  Trash2,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AuditEntry,
  Business,
  ChatMessage,
  RuleRecord,
  createRule,
  deleteService,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { Textarea } from "./components/ui/textarea";
import { ServiceRuleWizardDialog } from "./components/ServiceRuleWizardDialog";
import { formatRuleType, presentRule, type RulePresentation } from "./rules/presentation";
import { ServiceSummary, getServiceSummaries } from "./wizard/state";

type OutcomeFilter = "all" | AuditEntry["outcome"];
type DashboardTab = "rules" | "audit";
type ServiceWizardIntent = {
  mode: "create" | "edit";
  serviceName: string | null;
} | null;

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
  if (path === "/dashboard/services/new") {
    return <OwnerDashboardPage initialWizard={{ mode: "create", serviceName: null }} />;
  }
  const editMatch = path.match(/^\/dashboard\/services\/([^/]+)\/edit$/);
  if (editMatch) {
    const name = decodeURIComponent(editMatch[1]);
    return <OwnerDashboardPage initialWizard={{ mode: "edit", serviceName: name }} />;
  }
  if (path === "/dashboard/services") {
    return <OwnerDashboardPage />;
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
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <NavLink href="/">
            <ArrowLeft className="h-3.5 w-3.5" />
            Change business
          </NavLink>
          <NavLink href="/dashboard">Owner dashboard</NavLink>
        </div>
      }
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

function OwnerDashboardPage({
  initialWizard = null,
}: {
  initialWizard?: ServiceWizardIntent;
}) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [ruleDraft, setRuleDraft] = useState(defaultRuleJson);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("rules");
  const [wizardIntent, setWizardIntent] = useState<ServiceWizardIntent>(initialWizard);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === businessId),
    [businessId, businesses],
  );
  const services = useMemo<ServiceSummary[]>(() => getServiceSummaries(rules), [rules]);

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

  async function handleDeleteServiceRule(service: ServiceSummary) {
    if (!confirm(`Delete all rules for "${service.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteService(businessId, service.name);
      await refreshOwnerData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Service rule delete failed");
    } finally {
      setBusy(false);
    }
  }

  function openServiceWizard(intent: NonNullable<ServiceWizardIntent>) {
    setActiveTab("rules");
    setWizardIntent(intent);
  }

  function handleWizardOpenChange(open: boolean) {
    if (open || !wizardIntent) return;
    setWizardIntent(null);
    if (window.location.pathname.startsWith("/dashboard/services")) {
      window.history.replaceState(null, "", "/dashboard");
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
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as DashboardTab)}>
        <div className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="Dashboard sections">
            <TabsTrigger value="rules">Configured rules</TabsTrigger>
            <TabsTrigger value="audit">Audit log</TabsTrigger>
          </TabsList>
          <p className="text-sm text-[var(--muted)]">
            Configure what the agent can offer, then review decisions it blocked or flagged.
          </p>
        </div>
        <TabsContent value="rules">
          <RulesPanel
            busy={busy}
            rules={rules}
            services={services}
            ruleDraft={ruleDraft}
            onRuleDraft={setRuleDraft}
            onCreateRule={handleCreateRule}
            onToggleRule={handleToggleRule}
            onDeleteRule={handleDeleteRule}
            onDeleteServiceRule={handleDeleteServiceRule}
            onAddServiceRule={() => openServiceWizard({ mode: "create", serviceName: null })}
            onEditServiceRule={(service) =>
              openServiceWizard({ mode: "edit", serviceName: service.name })
            }
          />
        </TabsContent>
        <TabsContent value="audit">
          <AuditLogPanel
            auditLog={auditLog}
            busy={busy}
            filter={filter}
            onFilter={setFilter}
            onRefresh={refreshOwnerData}
          />
        </TabsContent>
      </Tabs>
      <ServiceRuleWizardDialog
        businessId={businessId}
        businessName={selectedBusiness?.name}
        mode={wizardIntent?.mode ?? "create"}
        onOpenChange={handleWizardOpenChange}
        onSaved={refreshOwnerData}
        open={Boolean(wizardIntent)}
        serviceName={wizardIntent?.serviceName}
        timezone={selectedBusiness?.timezone ?? "America/Chicago"}
      />
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
                <TableCell className="text-sm font-medium">
                  {formatRuleType(String(entry.action_proposed.type ?? "action"))}
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
  services,
  ruleDraft,
  onRuleDraft,
  onCreateRule,
  onToggleRule,
  onDeleteRule,
  onDeleteServiceRule,
  onAddServiceRule,
  onEditServiceRule,
}: {
  busy: boolean;
  rules: RuleRecord[];
  services: ServiceSummary[];
  ruleDraft: string;
  onRuleDraft: (value: string) => void;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onToggleRule: (rule: RuleRecord) => void;
  onDeleteRule: (rule: RuleRecord) => void;
  onDeleteServiceRule: (service: ServiceSummary) => void;
  onAddServiceRule: () => void;
  onEditServiceRule: (service: ServiceSummary) => void;
}) {
  const defaultRules = rules.filter((rule) => !(rule.config as { service?: string }).service);
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
      <div className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-rule">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Default rules</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Used for every service unless a service-specific rule overrides them.
            </p>
          </div>
          <Badge variant="secondary">{defaultRules.length} configured</Badge>
        </div>

        <div className="mt-4 space-y-3">
          {defaultRules.map((rule) => (
            <RuleCard
              busy={busy}
              key={rule.id}
              onDeleteRule={onDeleteRule}
              onToggleRule={onToggleRule}
              rule={rule}
            />
          ))}
          {!defaultRules.length ? (
            <div className="rounded-lg border border-dashed border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--muted)]">
              No default rules configured yet.
            </div>
          ) : null}
          <AdvancedRuleJsonForm
            busy={busy}
            ruleDraft={ruleDraft}
            onCreateRule={onCreateRule}
            onRuleDraft={onRuleDraft}
          />
        </div>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-rule">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">Service-specific rules</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Add or edit exceptions for one service without leaving the dashboard.
            </p>
          </div>
          <Button type="button" onClick={onAddServiceRule}>
            <Plus className="h-4 w-4" />
            Add rule
          </Button>
        </div>

        {services.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[var(--line)] bg-[var(--wash)] p-8 text-center text-sm text-[var(--muted)]">
            No service-specific rules yet.
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
            {services.map((service) => (
              <li
                key={service.name}
                className="flex flex-col gap-3 bg-white px-4 py-4 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <h3 className="text-base font-semibold capitalize">{service.name}</h3>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <ServiceStatusBadge
                      label="Service area"
                      active={service.hasServiceArea}
                      activeText="Custom"
                      inactiveText="Default"
                    />
                    <ServiceStatusBadge
                      label="Availability"
                      active={service.hasAvailability}
                      activeText="Custom"
                      inactiveText="Default"
                    />
                    <ServiceStatusBadge
                      label="Booking policy"
                      active={service.hasBookingPolicy}
                      activeText="Custom"
                      inactiveText="Default"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onEditServiceRule(service)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit rule
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onDeleteServiceRule(service)}
                    disabled={busy}
                    title="Delete service rules"
                    size="icon"
                    variant="outline"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ServiceStatusBadge({
  active,
  activeText,
  inactiveText,
  label,
}: {
  active: boolean;
  activeText: string;
  inactiveText: string;
  label: string;
}) {
  return (
    <Badge variant={active ? "success" : "secondary"}>
      {label}: {active ? activeText : inactiveText}
    </Badge>
  );
}

function RuleCard({
  busy,
  onDeleteRule,
  onToggleRule,
  rule,
}: {
  busy: boolean;
  onDeleteRule: (rule: RuleRecord) => void;
  onToggleRule: (rule: RuleRecord) => void;
  rule: RuleRecord;
}) {
  const presentation = presentRule(rule);

  return (
    <article className="rounded-lg border border-[var(--line)] bg-white p-4 shadow-rule">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--wash)] text-[var(--focus)]">
            <RuleIcon type={rule.type} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold leading-tight">{presentation.title}</h3>
              <Badge variant={rule.enabled ? "success" : "secondary"}>
                {rule.enabled ? "Enabled" : "Paused"}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--muted)]">{presentation.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`enabled-${rule.id}`}
                checked={rule.enabled}
                disabled={busy}
                onCheckedChange={() => onToggleRule(rule)}
              />
              <Label
                htmlFor={`enabled-${rule.id}`}
                className="hidden text-xs font-semibold text-[var(--muted-strong)] sm:inline"
              >
                Enabled
              </Label>
            </div>
            <Button
              aria-label={`Delete ${presentation.title}`}
              disabled={busy}
              onClick={() => onDeleteRule(rule)}
              size="icon"
              title="Delete rule"
              type="button"
              variant="ghost"
              className="text-[var(--muted)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm leading-6 text-[var(--muted-strong)]">{presentation.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{presentation.scope}</Badge>
            {presentation.chips.map((chip) => (
              <Badge key={chip.label} variant={chip.tone ?? "secondary"}>
                {chip.label}
              </Badge>
            ))}
          </div>
          {presentation.metrics.length ? <RuleMetrics presentation={presentation} /> : null}
          {presentation.details.length || presentation.warning ? (
            <div className="space-y-1.5 rounded-md bg-[var(--wash)] p-3 text-sm text-[var(--muted-strong)]">
              {presentation.warning ? (
                <p className="font-semibold text-[var(--amber)]">{presentation.warning}</p>
              ) : null}
              {presentation.details.map((detail) => (
                <p key={detail}>{detail}</p>
              ))}
            </div>
          ) : null}
        </div>

        <TechnicalDetails rule={rule} />
      </div>
    </article>
  );
}

function RuleMetrics({ presentation }: { presentation: RulePresentation }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {presentation.metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-md border border-[var(--line)] bg-[var(--wash)] px-3 py-2"
        >
          <dt className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            {metric.label}
          </dt>
          <dd className="mt-1 text-sm font-semibold text-[var(--ink)]">{metric.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function TechnicalDetails({ rule }: { rule: RuleRecord }) {
  return (
    <details className="group border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
      <summary className="inline-flex cursor-pointer select-none items-center gap-2 rounded-md px-0 py-1 font-semibold text-[var(--muted-strong)]">
        <Code2 className="h-3.5 w-3.5" />
        Technical details
      </summary>
      <div className="mt-2 space-y-2">
        <p className="font-mono text-[0.7rem] text-[var(--muted)]">{rule.id}</p>
        <pre className="max-h-56 overflow-auto rounded-md bg-[var(--wash)] p-3 text-xs leading-5 text-[var(--muted-strong)]">
          {JSON.stringify(rule.config, null, 2)}
        </pre>
      </div>
    </details>
  );
}

function AdvancedRuleJsonForm({
  busy,
  onCreateRule,
  onRuleDraft,
  ruleDraft,
}: {
  busy: boolean;
  onCreateRule: (event: FormEvent<HTMLFormElement>) => void;
  onRuleDraft: (value: string) => void;
  ruleDraft: string;
}) {
  return (
    <details className="rounded-lg border border-dashed border-[var(--line)] bg-white p-4 text-sm shadow-rule">
      <summary className="cursor-pointer select-none font-semibold text-[var(--muted-strong)]">
        Advanced: add raw JSON rule
      </summary>
      <form className="mt-4" onSubmit={onCreateRule}>
        <Label htmlFor="rule-json">Rule JSON</Label>
        <Textarea
          className="mt-2 h-44 resize-y font-mono text-xs"
          id="rule-json"
          onChange={(event) => onRuleDraft(event.target.value)}
          value={ruleDraft}
        />
        <Button className="mt-3" disabled={busy} type="submit" size="sm">
          <Plus className="h-4 w-4" />
          Add rule
        </Button>
      </form>
    </details>
  );
}

function RuleIcon({ type }: { type: RuleRecord["type"] }) {
  if (type === "services_offered") return <Wrench className="h-5 w-5" />;
  if (type === "service_area") return <MapPin className="h-5 w-5" />;
  if (type === "business_hours") return <CalendarClock className="h-5 w-5" />;
  if (type === "booking_policy") return <SlidersHorizontal className="h-5 w-5" />;
  return <Code2 className="h-5 w-5" />;
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
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <BrandMark />
            <p className="mt-5 font-mono text-xs font-normal uppercase tracking-[0.18em] text-[var(--focus)]">
              {eyebrow}
            </p>
            <h1 className="mt-1 font-display text-3xl font-medium leading-tight sm:text-4xl">
              {title}
            </h1>
          </div>
          {actions}
        </header>
        {children}
      </section>
    </main>
  );
}

function BrandMark() {
  return (
    <a className="brand-mark" href="/dashboard" aria-label="Revin dashboard">
      REVIN
    </a>
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
