import type { RuleRecord, RuleType } from "../api";

export type RuleTone = "secondary" | "success" | "warning" | "outline";

export type RuleChip = {
  label: string;
  tone?: RuleTone;
};

export type RuleMetric = {
  label: string;
  value: string;
};

export type RulePresentation = {
  title: string;
  subtitle: string;
  scope: string;
  summary: string;
  chips: RuleChip[];
  details: string[];
  metrics: RuleMetric[];
  warning?: string;
};

type RuleConfig = Record<string, unknown>;

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

const SHORT_DAYS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const RULE_TITLES: Record<RuleType, string> = {
  booking_policy: "Booking policy",
  business_hours: "Availability",
  service_area: "Service area",
  services_offered: "Services offered",
};

export function presentRule(rule: RuleRecord): RulePresentation {
  const config = rule.config ?? {};

  if (rule.type === "services_offered") {
    const services = stringList(config.services);
    return {
      title: RULE_TITLES[rule.type],
      subtitle: "What customers are allowed to request",
      scope: scopeLabel(config.service),
      summary: services.length
        ? `Customers can request ${pluralize(services.length, "service")}.`
        : "No services are listed yet.",
      chips: services.map((service) => ({ label: service, tone: "success" })),
      details: services.length ? [] : ["Add at least one customer-facing service."],
      metrics: [{ label: "Services", value: String(services.length) }],
      warning: services.length ? undefined : "This rule has no services configured.",
    };
  }

  if (rule.type === "service_area") {
    const zipCodes = stringList(config.zip_codes);
    const cities = stringList(config.cities);
    const locations = [...cities, ...zipCodes];
    return {
      title: RULE_TITLES[rule.type],
      subtitle: "Where bookings and quotes are allowed",
      scope: scopeLabel(config.service),
      summary: locations.length
        ? `Allowed in ${formatLocationSummary(zipCodes.length, cities.length)}.`
        : "No location limits are configured.",
      chips: [
        ...cities.map((city) => ({ label: city, tone: "secondary" as const })),
        ...zipCodes.map((zip) => ({ label: zip, tone: "outline" as const })),
      ],
      details: locations.length ? [] : ["This currently allows every location."],
      metrics: [
        { label: "Cities", value: String(cities.length) },
        { label: "Zip codes", value: String(zipCodes.length) },
      ],
      warning: locations.length ? undefined : "No cities or zip codes are set.",
    };
  }

  if (rule.type === "business_hours") {
    const windows = windowLines(config.windows);
    const exceptions = exceptionLines(config.exceptions);
    const timezone = textValue(config.timezone) ?? "Business timezone";
    return {
      title: RULE_TITLES[rule.type],
      subtitle: "When appointments can be booked",
      scope: scopeLabel(config.service),
      summary: windows.length
        ? `Open during ${pluralize(windows.length, "weekly window")}.`
        : "No recurring open hours are configured.",
      chips: windows.map((line) => ({ label: line, tone: "secondary" })),
      details: exceptions.map((line) => `Closed: ${line}`),
      metrics: [
        { label: "Timezone", value: timezone },
        { label: "Exceptions", value: String(exceptions.length) },
      ],
      warning: windows.length ? undefined : "This rule has no open windows.",
    };
  }

  if (rule.type === "booking_policy") {
    const leadMinutes = numberValue(config.min_lead_minutes) ?? 0;
    const maxAdvanceDays = numberValue(config.max_advance_days) ?? 0;
    return {
      title: RULE_TITLES[rule.type],
      subtitle: "How soon and how far out customers can book",
      scope: scopeLabel(config.service),
      summary: `Require ${formatMinutes(leadMinutes)} lead time and allow booking up to ${maxAdvanceDays} days ahead.`,
      chips: [],
      details: [],
      metrics: [
        { label: "Lead time", value: formatMinutes(leadMinutes) },
        { label: "Advance window", value: `${maxAdvanceDays} days` },
      ],
      warning: maxAdvanceDays <= 0 ? "Advance window is missing or invalid." : undefined,
    };
  }

  return {
    title: formatRuleType(rule.type),
    subtitle: "Custom rule",
    scope: scopeLabel(config.service),
    summary: "This rule type does not have a business-readable renderer yet.",
    chips: [],
    details: [],
    metrics: [],
    warning: "Open technical details to inspect this rule.",
  };
}

export function formatRuleType(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function scopeLabel(value: unknown): string {
  const service = textValue(value);
  return service ? `Only ${service}` : "All services";
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function pluralize(count: number, noun: string): string {
  if (noun.endsWith("y")) {
    return `${count} ${count === 1 ? noun : `${noun.slice(0, -1)}ies`}`;
  }
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatLocationSummary(zipCount: number, cityCount: number): string {
  const parts: string[] = [];
  if (cityCount) parts.push(pluralize(cityCount, "city"));
  if (zipCount) parts.push(pluralize(zipCount, "zip code"));
  return parts.join(" and ");
}

function windowLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const byRange = new Map<string, string[]>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const day = textValue(item.day)?.toLowerCase();
    const open = textValue(item.open_time);
    const close = textValue(item.close_time);
    if (!day || !DAYS.includes(day as (typeof DAYS)[number]) || !open || !close) continue;

    const range = `${formatTime(open)}-${formatTime(close)}`;
    byRange.set(range, [...(byRange.get(range) ?? []), day]);
  }

  return Array.from(byRange.entries()).map(
    ([range, days]) => `${formatDays(days)}: ${range}`,
  );
}

function exceptionLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const start = textValue(item.start_date) ?? textValue(item.start);
    const end = textValue(item.end_date) ?? textValue(item.end);
    const reason = textValue(item.reason) ?? textValue(item.label);
    if (!start || !end) return [];
    const range = start === end ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;
    return reason ? `${range} (${reason})` : range;
  });
}

function isRecord(value: unknown): value is RuleConfig {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatDays(days: string[]): string {
  const indexes = days
    .map((day) => DAYS.indexOf(day as (typeof DAYS)[number]))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);

  if (indexes.join(",") === "0,1,2,3,4") return "Mon-Fri";
  if (indexes.join(",") === "0,1,2,3,4,5,6") return "Every day";
  if (indexes.length > 1 && indexes[indexes.length - 1] - indexes[0] === indexes.length - 1) {
    return `${SHORT_DAYS[DAYS[indexes[0]]]}-${SHORT_DAYS[DAYS[indexes[indexes.length - 1]]]}`;
  }
  return indexes.map((index) => SHORT_DAYS[DAYS[index]]).join(", ");
}

function formatTime(value: string): string {
  const [hourPart, minutePart = "00"] = value.split(":");
  const hour = Number(hourPart);
  const minute = Number(minutePart);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return value;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function formatDate(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `${hours} ${hours === 1 ? "hour" : "hours"} ${remainder} min`;
}
