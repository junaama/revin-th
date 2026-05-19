import { Pencil, Plus, Store, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Business,
  RuleRecord,
  deleteService,
  listBusinesses,
  listRules,
} from "../api";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { ServiceSummary, getServiceSummaries } from "../wizard/state";

export function ServicesListPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const services = useMemo<ServiceSummary[]>(() => getServiceSummaries(rules), [rules]);
  const selectedBusiness = useMemo(
    () => businesses.find((b) => b.id === businessId),
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
    void refresh();
  }, [businessId]);

  async function refresh() {
    if (!businessId) return;
    setBusy(true);
    setError(null);
    try {
      setRules(await listRules(businessId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load services");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(service: ServiceSummary) {
    if (!confirm(`Delete all rules for "${service.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await deleteService(businessId, service.name);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete service");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              Service configuration
            </p>
            <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">
              {selectedBusiness?.name ?? "Services"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <a href="/dashboard">Owner dashboard</a>
            </Button>
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
            <Button asChild>
              <a href="/dashboard/services/new">
                <Plus className="h-4 w-4" />
                New service
              </a>
            </Button>
          </div>
        </header>

        {error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Configured services</CardTitle>
            <CardDescription>{services.length} configured</CardDescription>
          </CardHeader>

          {services.length === 0 ? (
            <CardContent className="p-10 text-center text-sm text-[var(--muted)]">
              {busy ? "Loading…" : "No services yet. Click \"New service\" to add one."}
            </CardContent>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {services.map((service) => (
                <li
                  key={service.name}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
                >
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold capitalize">{service.name}</h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {summarizeBadges(service)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a href={`/dashboard/services/${encodeURIComponent(service.name)}/edit`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </a>
                    </Button>
                    <Button
                      type="button"
                      onClick={() => handleDelete(service)}
                      disabled={busy}
                      title="Delete service"
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
        </Card>
      </section>
    </main>
  );
}

function summarizeBadges(service: ServiceSummary): string {
  const parts: string[] = [];
  parts.push(service.hasServiceArea ? "service area: custom" : "service area: inherit");
  parts.push(service.hasAvailability ? "availability: custom" : "availability: inherit");
  parts.push(service.hasBookingPolicy ? "booking policy: set" : "booking policy: default");
  return parts.join(" · ");
}
