import type {
  DayOfWeek,
  RuleRecord,
  ServiceWizardPayload,
  WizardFieldError,
} from "../api";

export type WizardMode = "create" | "edit";

export type HoursWindowDraft = {
  id: string;
  day: DayOfWeek;
  openTime: string;
  closeTime: string;
};

export type ExceptionDraft = {
  id: string;
  label: string;
  start: string;
  end: string;
};

export type WizardForm = {
  name: string;
  serviceArea: {
    inheritDefault: boolean;
    zipCodes: string[];
    cities: string[];
  };
  availability: {
    inheritDefault: boolean;
    windows: HoursWindowDraft[];
    exceptions: ExceptionDraft[];
  };
  bookingPolicy: {
    minLeadMinutes: number;
    maxAdvanceDays: number;
  };
};

export type WizardStep = 0 | 1 | 2 | 3 | 4 | 5;

export const WIZARD_STEP_TITLES: Record<WizardStep, string> = {
  0: "Identification",
  1: "Service area",
  2: "Availability",
  3: "Calendar exceptions",
  4: "Booking policy",
  5: "Preview",
};

export type WizardState = {
  mode: WizardMode;
  originalName: string | null;
  step: WizardStep;
  form: WizardForm;
  fieldErrors: WizardFieldError[];
  submitError: string | null;
  busy: boolean;
};

export type WizardAction =
  | { kind: "set_form"; patch: Partial<WizardForm> }
  | { kind: "set_service_area"; patch: Partial<WizardForm["serviceArea"]> }
  | { kind: "set_availability"; patch: Partial<WizardForm["availability"]> }
  | { kind: "set_booking_policy"; patch: Partial<WizardForm["bookingPolicy"]> }
  | { kind: "add_window" }
  | { kind: "remove_window"; id: string }
  | { kind: "update_window"; id: string; patch: Partial<HoursWindowDraft> }
  | { kind: "add_exception" }
  | { kind: "remove_exception"; id: string }
  | { kind: "update_exception"; id: string; patch: Partial<ExceptionDraft> }
  | { kind: "set_step"; step: WizardStep }
  | { kind: "set_field_errors"; errors: WizardFieldError[] }
  | { kind: "set_submit_error"; error: string | null }
  | { kind: "set_busy"; busy: boolean }
  | { kind: "reset"; state: WizardState };

export const DAYS: DayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function makeId(): string {
  return `draft-${crypto.randomUUID()}`;
}

export function makeEmptyForm(): WizardForm {
  return {
    name: "",
    serviceArea: {
      inheritDefault: true,
      zipCodes: [],
      cities: [],
    },
    availability: {
      inheritDefault: true,
      windows: [],
      exceptions: [],
    },
    bookingPolicy: {
      minLeadMinutes: 120,
      maxAdvanceDays: 30,
    },
  };
}

export function makeInitialState(mode: WizardMode, form: WizardForm, originalName: string | null): WizardState {
  return {
    mode,
    originalName,
    step: 0,
    form,
    fieldErrors: [],
    submitError: null,
    busy: false,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.kind) {
    case "set_form":
      return { ...state, form: { ...state.form, ...action.patch } };
    case "set_service_area":
      return {
        ...state,
        form: {
          ...state.form,
          serviceArea: { ...state.form.serviceArea, ...action.patch },
        },
      };
    case "set_availability":
      return {
        ...state,
        form: {
          ...state.form,
          availability: { ...state.form.availability, ...action.patch },
        },
      };
    case "set_booking_policy":
      return {
        ...state,
        form: {
          ...state.form,
          bookingPolicy: { ...state.form.bookingPolicy, ...action.patch },
        },
      };
    case "add_window": {
      const next: HoursWindowDraft = {
        id: makeId(),
        day: "monday",
        openTime: "09:00",
        closeTime: "17:00",
      };
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            windows: [...state.form.availability.windows, next],
          },
        },
      };
    }
    case "remove_window":
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            windows: state.form.availability.windows.filter((w) => w.id !== action.id),
          },
        },
      };
    case "update_window":
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            windows: state.form.availability.windows.map((w) =>
              w.id === action.id ? { ...w, ...action.patch } : w,
            ),
          },
        },
      };
    case "add_exception": {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      const next: ExceptionDraft = {
        id: makeId(),
        label: "",
        start: `${iso}T00:00`,
        end: `${iso}T23:59`,
      };
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            exceptions: [...state.form.availability.exceptions, next],
          },
        },
      };
    }
    case "remove_exception":
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            exceptions: state.form.availability.exceptions.filter((e) => e.id !== action.id),
          },
        },
      };
    case "update_exception":
      return {
        ...state,
        form: {
          ...state.form,
          availability: {
            ...state.form.availability,
            exceptions: state.form.availability.exceptions.map((e) =>
              e.id === action.id ? { ...e, ...action.patch } : e,
            ),
          },
        },
      };
    case "set_step":
      return { ...state, step: action.step };
    case "set_field_errors":
      return { ...state, fieldErrors: action.errors };
    case "set_submit_error":
      return { ...state, submitError: action.error };
    case "set_busy":
      return { ...state, busy: action.busy };
    case "reset":
      return action.state;
    default:
      return state;
  }
}

export type ServiceSummary = {
  name: string;
  hasServiceArea: boolean;
  hasAvailability: boolean;
  hasBookingPolicy: boolean;
};

export function getOfferedServices(rules: RuleRecord[]): string[] {
  const offered = rules.find(
    (r) => r.type === "services_offered" && !(r.config as { service?: string }).service,
  );
  const list = (offered?.config as { services?: string[] } | undefined)?.services ?? [];
  return list.map((s) => s.trim()).filter(Boolean);
}

export function getServiceSummaries(rules: RuleRecord[]): ServiceSummary[] {
  const offered = getOfferedServices(rules);
  const fromScoped = new Set<string>();
  for (const rule of rules) {
    const service = (rule.config as { service?: string }).service;
    if (service) fromScoped.add(service);
  }
  const unique = Array.from(new Set([...offered, ...fromScoped]));
  return unique.map((name) => ({
    name,
    hasServiceArea: rules.some(
      (r) => r.type === "service_area" && (r.config as { service?: string }).service === name,
    ),
    hasAvailability: rules.some(
      (r) => r.type === "business_hours" && (r.config as { service?: string }).service === name,
    ),
    hasBookingPolicy: rules.some(
      (r) => r.type === "booking_policy" && (r.config as { service?: string }).service === name,
    ),
  }));
}

function timeToHHMM(value: unknown): string {
  if (typeof value !== "string") return "09:00";
  return value.slice(0, 5);
}

export function deriveFormFromRules(serviceName: string, rules: RuleRecord[]): WizardForm {
  const form = makeEmptyForm();
  form.name = serviceName;

  const areaRule = rules.find(
    (r) => r.type === "service_area" && (r.config as { service?: string }).service === serviceName,
  );
  if (areaRule) {
    const cfg = areaRule.config as { zip_codes?: string[]; cities?: string[] };
    form.serviceArea = {
      inheritDefault: false,
      zipCodes: cfg.zip_codes ?? [],
      cities: cfg.cities ?? [],
    };
  }

  const hoursRule = rules.find(
    (r) =>
      r.type === "business_hours" && (r.config as { service?: string }).service === serviceName,
  );
  if (hoursRule) {
    const cfg = hoursRule.config as {
      windows?: Array<{ day: DayOfWeek; open_time: string; close_time: string }>;
      exceptions?: Array<{
        start_date?: string;
        end_date?: string;
        start?: string;
        end?: string;
        reason?: string;
        label?: string;
      }>;
    };
    form.availability = {
      inheritDefault: false,
      windows: (cfg.windows ?? []).map((w) => ({
        id: makeId(),
        day: w.day,
        openTime: timeToHHMM(w.open_time),
        closeTime: timeToHHMM(w.close_time),
      })),
      exceptions: (cfg.exceptions ?? []).map((e) => {
        const start = e.start ?? (e.start_date ? `${e.start_date}T00:00` : "");
        const end = e.end ?? (e.end_date ? `${e.end_date}T23:59` : "");
        return {
          id: makeId(),
          label: e.label ?? e.reason ?? "",
          start: start.slice(0, 16),
          end: end.slice(0, 16),
        };
      }),
    };
  }

  const policyRule = rules.find(
    (r) =>
      r.type === "booking_policy" && (r.config as { service?: string }).service === serviceName,
  );
  if (policyRule) {
    const cfg = policyRule.config as { min_lead_minutes?: number; max_advance_days?: number };
    form.bookingPolicy = {
      minLeadMinutes: cfg.min_lead_minutes ?? 120,
      maxAdvanceDays: cfg.max_advance_days ?? 30,
    };
  }

  return form;
}

export function buildPayload(state: WizardState): ServiceWizardPayload {
  const { form, mode } = state;
  return {
    mode,
    service: {
      name: form.name.trim(),
      service_area: {
        inherit_default: form.serviceArea.inheritDefault,
        zip_codes: form.serviceArea.inheritDefault ? [] : form.serviceArea.zipCodes,
        cities: form.serviceArea.inheritDefault ? [] : form.serviceArea.cities,
      },
      availability: {
        inherit_default: form.availability.inheritDefault,
        windows: form.availability.inheritDefault
          ? []
          : form.availability.windows.map((w) => ({
              day: w.day,
              open_time: w.openTime,
              close_time: w.closeTime,
            })),
        exceptions: form.availability.exceptions.map((e) => ({
          label: e.label.trim(),
          start: e.start,
          end: e.end,
        })),
      },
      booking_policy: {
        min_lead_minutes: form.bookingPolicy.minLeadMinutes,
        max_advance_days: form.bookingPolicy.maxAdvanceDays,
      },
    },
  };
}

export function validateStep(state: WizardState, step: WizardStep): WizardFieldError[] {
  const errors: WizardFieldError[] = [];
  const { form } = state;

  if (step === 0) {
    if (!form.name.trim()) {
      errors.push({ step: 0, field: "name", message: "Service name is required." });
    }
  }

  if (step === 1 && !form.serviceArea.inheritDefault) {
    if (form.serviceArea.zipCodes.length === 0 && form.serviceArea.cities.length === 0) {
      errors.push({
        step: 1,
        field: "service_area",
        message: "Add at least one zip code or city, or inherit the business default.",
      });
    }
    for (const zip of form.serviceArea.zipCodes) {
      if (!/^\d{5}(-\d{4})?$/.test(zip)) {
        errors.push({ step: 1, field: "zip_codes", message: `"${zip}" is not a valid US zip code.` });
        break;
      }
    }
    for (const city of form.serviceArea.cities) {
      if (!/,\s*[A-Za-z]{2}$/.test(city)) {
        errors.push({
          step: 1,
          field: "cities",
          message: `"${city}" must be in "City, State" format.`,
        });
        break;
      }
    }
  }

  if (step === 2 && !form.availability.inheritDefault) {
    if (form.availability.windows.length === 0) {
      errors.push({
        step: 2,
        field: "windows",
        message: "Add at least one open window, or inherit the business default.",
      });
    }
    for (const w of form.availability.windows) {
      if (!/^\d{2}:\d{2}$/.test(w.openTime) || !/^\d{2}:\d{2}$/.test(w.closeTime)) {
        errors.push({
          step: 2,
          field: "windows",
          message: "Open and close times must be in HH:MM format.",
        });
        break;
      }
      if (w.openTime >= w.closeTime) {
        errors.push({
          step: 2,
          field: "windows",
          message: `On ${w.day}, open time must be earlier than close time.`,
        });
        break;
      }
    }
  }

  if (step === 3) {
    for (const e of form.availability.exceptions) {
      if (!e.start || !e.end) {
        errors.push({ step: 3, field: "exceptions", message: "Each exception needs a start and end." });
        break;
      }
      if (new Date(e.start) >= new Date(e.end)) {
        errors.push({
          step: 3,
          field: "exceptions",
          message: "Exception start must be before its end.",
        });
        break;
      }
    }
  }

  if (step === 4) {
    if (form.bookingPolicy.minLeadMinutes < 0) {
      errors.push({
        step: 4,
        field: "min_lead_minutes",
        message: "Minimum lead time cannot be negative.",
      });
    }
    if (form.bookingPolicy.maxAdvanceDays < 1) {
      errors.push({
        step: 4,
        field: "max_advance_days",
        message: "Max advance days must be at least 1.",
      });
    }
  }

  return errors;
}

export function describePayload(payload: ServiceWizardPayload, mode: WizardMode): string[] {
  const lines: string[] = [];
  const { service } = payload;
  const verb = mode === "edit" ? "Replace" : "Create";

  if (mode === "create") {
    lines.push(`Add "${service.name}" to services_offered`);
  } else {
    lines.push(`Keep "${service.name}" in services_offered`);
  }

  if (service.service_area.inherit_default) {
    lines.push("Service area: inherit business default (no per-service rule)");
  } else {
    const parts: string[] = [];
    if (service.service_area.zip_codes.length > 0) {
      parts.push(`zips=[${service.service_area.zip_codes.join(", ")}]`);
    }
    if (service.service_area.cities.length > 0) {
      parts.push(`cities=[${service.service_area.cities.join(", ")}]`);
    }
    lines.push(`${verb} service_area rule (service=${service.name}, ${parts.join(", ")})`);
  }

  if (service.availability.inherit_default) {
    lines.push("Availability: inherit business default");
    if (service.availability.exceptions.length > 0) {
      lines.push(
        `${verb} business_hours rule (service=${service.name}, ${service.availability.exceptions.length} exception(s) only)`,
      );
    }
  } else {
    lines.push(
      `${verb} business_hours rule (service=${service.name}, ${service.availability.windows.length} window(s), ${service.availability.exceptions.length} exception(s))`,
    );
  }

  lines.push(
    `${verb} booking_policy rule (service=${service.name}, lead=${service.booking_policy.min_lead_minutes}m, advance=${service.booking_policy.max_advance_days}d)`,
  );

  return lines;
}
