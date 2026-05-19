import { Plus, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import type { DayOfWeek, ServiceWizardPayload } from "../api";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
  BusinessDefaults,
  DAYS,
  WizardAction,
  WizardForm,
  WizardState,
  describePayload,
} from "./state";

type StepProps = {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  timezone: string;
  defaults: BusinessDefaults;
};

export function IdentificationStep({ state, dispatch }: StepProps) {
  const isEdit = state.mode === "edit";
  const renamed = isEdit && state.originalName !== null && state.form.name !== state.originalName;
  return (
    <StepShell
      title="Identify the service"
      hint="Pick the customer-facing name. Renaming an existing service updates every rule scoped to it."
    >
      <Field label="Service name">
        <Input
          placeholder="e.g. plumbing"
          value={state.form.name}
          onChange={(event) =>
            dispatch({ kind: "set_form", patch: { name: event.target.value } })
          }
        />
        {renamed ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Renaming from <span className="font-mono">{state.originalName}</span> —
            scoped rules and the services_offered allow-list will move with it on submit.
          </p>
        ) : null}
      </Field>
    </StepShell>
  );
}

export function ServiceAreaStep({ state, dispatch, defaults }: StepProps) {
  const { serviceArea } = state.form;
  return (
    <StepShell
      title="Service area"
      hint='Zip codes (5-digit) or cities ("City, ST"). Use the default if this service has the same area.'
    >
      <UseDefaultToggle
        label="Use the default service area"
        checked={serviceArea.inheritDefault}
        onChange={(value) =>
          dispatch({ kind: "set_service_area", patch: { inheritDefault: value } })
        }
      />
      <ServiceAreaDefault defaults={defaults.serviceArea} />
      {!serviceArea.inheritDefault ? (
        <div className="grid gap-4 md:grid-cols-2">
          <ChipListField
            label="Zip codes"
            placeholder="e.g. 78704"
            items={serviceArea.zipCodes}
            onChange={(zipCodes) => dispatch({ kind: "set_service_area", patch: { zipCodes } })}
          />
          <ChipListField
            label="Cities"
            placeholder="Austin, TX"
            items={serviceArea.cities}
            onChange={(cities) => dispatch({ kind: "set_service_area", patch: { cities } })}
          />
        </div>
      ) : null}
    </StepShell>
  );
}

export function AvailabilityStep({ state, dispatch, timezone, defaults }: StepProps) {
  const { availability } = state.form;
  return (
    <StepShell
      title="Availability (recurring hours)"
      hint={`Weekly windows in ${timezone}. Use the default to skip a per-service rule.`}
    >
      <UseDefaultToggle
        label="Use the default availability"
        checked={availability.inheritDefault}
        onChange={(value) =>
          dispatch({ kind: "set_availability", patch: { inheritDefault: value } })
        }
      />
      <AvailabilityDefault defaults={defaults.availability} />
      {!availability.inheritDefault ? (
        <div className="space-y-2">
          {availability.windows.length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--line)] bg-[var(--wash)] p-3 text-sm text-[var(--muted)]">
              No open windows yet. Add one below.
            </p>
          ) : null}
          {availability.windows.map((window) => (
            <div
              key={window.id}
              className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,140px)_minmax(0,140px)_auto] sm:items-end"
            >
              <Field label="Day">
                <select
                  className={inputClass}
                  value={window.day}
                  onChange={(event) =>
                    dispatch({
                      kind: "update_window",
                      id: window.id,
                      patch: { day: event.target.value as DayOfWeek },
                    })
                  }
                >
                  {DAYS.map((day) => (
                    <option key={day} value={day}>
                      {capitalize(day)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Opens">
                <Input
                  type="time"
                  value={window.openTime}
                  onChange={(event) =>
                    dispatch({
                      kind: "update_window",
                      id: window.id,
                      patch: { openTime: event.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Closes">
                <Input
                  type="time"
                  value={window.closeTime}
                  onChange={(event) =>
                    dispatch({
                      kind: "update_window",
                      id: window.id,
                      patch: { closeTime: event.target.value },
                    })
                  }
                />
              </Field>
              <Button
                type="button"
                onClick={() => dispatch({ kind: "remove_window", id: window.id })}
                title="Remove window"
                size="icon"
                variant="outline"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            onClick={() => dispatch({ kind: "add_window" })}
            variant="outline"
          >
            <Plus className="h-4 w-4" /> Add window
          </Button>
        </div>
      ) : null}
    </StepShell>
  );
}

export function ExceptionsStep({ state, dispatch }: StepProps) {
  const { exceptions } = state.form.availability;
  return (
    <StepShell
      title="Calendar exceptions"
      hint="Date ranges that close this service no matter what (holidays, vacations)."
    >
      <div className="space-y-2">
        {exceptions.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--line)] bg-[var(--wash)] p-3 text-sm text-[var(--muted)]">
            No exceptions yet — add one to close the service for a date range.
          </p>
        ) : null}
        {exceptions.map((entry) => (
          <div
            key={entry.id}
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,200px)_auto] sm:items-end"
          >
            <Field label="Label (optional)">
              <Input
                placeholder="Christmas Day"
                value={entry.label}
                onChange={(event) =>
                  dispatch({
                    kind: "update_exception",
                    id: entry.id,
                    patch: { label: event.target.value },
                  })
                }
              />
            </Field>
            <Field label="Start">
              <Input
                type="datetime-local"
                value={entry.start}
                onChange={(event) =>
                  dispatch({
                    kind: "update_exception",
                    id: entry.id,
                    patch: { start: event.target.value },
                  })
                }
              />
            </Field>
            <Field label="End">
              <Input
                type="datetime-local"
                value={entry.end}
                onChange={(event) =>
                  dispatch({
                    kind: "update_exception",
                    id: entry.id,
                    patch: { end: event.target.value },
                  })
                }
              />
            </Field>
            <Button
              type="button"
              title="Remove exception"
              onClick={() => dispatch({ kind: "remove_exception", id: entry.id })}
              size="icon"
              variant="outline"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          onClick={() => dispatch({ kind: "add_exception" })}
          variant="outline"
        >
          <Plus className="h-4 w-4" /> Add exception
        </Button>
      </div>
    </StepShell>
  );
}

export function BookingPolicyStep({ state, dispatch, defaults }: StepProps) {
  const { bookingPolicy } = state.form;
  return (
    <StepShell
      title="Booking policy"
      hint="How far ahead and how far out customers can book this service."
    >
      <BookingPolicyDefault defaults={defaults.bookingPolicy} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Minimum lead time (minutes)">
          <Input
            type="number"
            min={0}
            value={bookingPolicy.minLeadMinutes}
            onChange={(event) =>
              dispatch({
                kind: "set_booking_policy",
                patch: { minLeadMinutes: Number(event.target.value) },
              })
            }
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            120 means customers must book at least 2 hours out.
          </p>
        </Field>
        <Field label="Maximum advance (days)">
          <Input
            type="number"
            min={1}
            value={bookingPolicy.maxAdvanceDays}
            onChange={(event) =>
              dispatch({
                kind: "set_booking_policy",
                patch: { maxAdvanceDays: Number(event.target.value) },
              })
            }
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            30 means no bookings further than 30 days out.
          </p>
        </Field>
      </div>
    </StepShell>
  );
}

export function PreviewStep({
  payload,
  mode,
}: {
  payload: ServiceWizardPayload;
  mode: WizardState["mode"];
}) {
  const lines = describePayload(payload, mode);
  return (
    <StepShell
      title="Preview"
      hint="Submitting writes all rule changes for this service in a single transaction."
    >
      <ul className="space-y-1.5 rounded-md border border-[var(--line)] bg-[var(--wash)] p-3 text-sm text-[var(--muted-strong)]">
        {lines.map((line, index) => (
          <li className="flex gap-2" key={index}>
            <span aria-hidden="true">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-xs text-[var(--muted)]">
        <summary className="cursor-pointer select-none">Show raw payload</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-[var(--wash)] p-3 text-xs leading-5">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </StepShell>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--line)] bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-[var(--focus)]";

function StepShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{hint}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function UseDefaultToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--muted-strong)]">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      {label}
    </label>
  );
}

function DefaultRulePanel({
  children,
  status,
  title,
}: {
  children: React.ReactNode;
  status: string;
  title: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--wash)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[var(--ink)]">{title}</p>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[var(--muted-strong)]">
          {status}
        </span>
      </div>
      <div className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{children}</div>
    </div>
  );
}

function ServiceAreaDefault({
  defaults,
}: {
  defaults: BusinessDefaults["serviceArea"];
}) {
  const locations = [...defaults.cities, ...defaults.zipCodes];
  return (
    <DefaultRulePanel
      title="Default service area"
      status={defaults.configured ? "Configured" : "Not configured"}
    >
      {locations.length ? (
        <div className="flex flex-wrap gap-1.5">
          {locations.map((location) => (
            <span
              key={location}
              className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[var(--ink)]"
            >
              {location}
            </span>
          ))}
        </div>
      ) : (
        <p>No default service area is configured.</p>
      )}
    </DefaultRulePanel>
  );
}

function AvailabilityDefault({
  defaults,
}: {
  defaults: BusinessDefaults["availability"];
}) {
  return (
    <DefaultRulePanel
      title="Default availability"
      status={defaults.configured ? defaults.timezone : "Not configured"}
    >
      {defaults.windows.length ? (
        <div className="space-y-1">
          {defaults.windows.map((window) => (
            <p key={`${window.day}-${window.openTime}-${window.closeTime}`}>
              {capitalize(window.day)}: {window.openTime}-{window.closeTime}
            </p>
          ))}
        </div>
      ) : (
        <p>No default recurring hours are configured.</p>
      )}
      {defaults.exceptions.length ? (
        <div className="mt-2 border-t border-[var(--line)] pt-2">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            Exceptions
          </p>
          {defaults.exceptions.map((entry) => (
            <p key={`${entry.start}-${entry.end}-${entry.label}`}>
              {formatDateTime(entry.start)} to {formatDateTime(entry.end)}
              {entry.label ? ` (${entry.label})` : ""}
            </p>
          ))}
        </div>
      ) : null}
    </DefaultRulePanel>
  );
}

function BookingPolicyDefault({
  defaults,
}: {
  defaults: BusinessDefaults["bookingPolicy"];
}) {
  return (
    <DefaultRulePanel
      title="Default booking policy"
      status={defaults.configured ? "Configured" : "App default"}
    >
      <p>
        {defaults.minLeadMinutes} minute lead time; {defaults.maxAdvanceDays} day advance window.
      </p>
    </DefaultRulePanel>
  );
}

function ChipListField({
  label,
  placeholder,
  items,
  onChange,
}: {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  return (
    <Field label={label}>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, index) => (
            <span
              key={`${item}-${index}`}
              className="inline-flex items-center gap-1 rounded-md bg-[var(--wash)] px-2 py-1 text-xs font-semibold text-[var(--ink)]"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                aria-label={`Remove ${item}`}
                className="text-[var(--muted)] hover:text-[var(--ink)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <Input
          placeholder={`${placeholder} (press Enter to add)`}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const input = event.currentTarget;
            const value = input.value.trim().replace(/,$/, "").trim();
            if (value && !items.includes(value)) {
              onChange([...items, value]);
            }
            input.value = "";
          }}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim().replace(/,$/, "").trim();
            if (value && !items.includes(value)) {
              onChange([...items, value]);
              event.currentTarget.value = "";
            }
          }}
        />
      </div>
    </Field>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDateTime(value: string): string {
  if (!value) return "Unset";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function getStepComponent(step: WizardState["step"]) {
  const map: Record<
    WizardState["step"],
    (props: StepProps & { payload: ServiceWizardPayload }) => JSX.Element
  > = {
    0: (props) => <IdentificationStep {...props} />,
    1: (props) => <ServiceAreaStep {...props} />,
    2: (props) => <AvailabilityStep {...props} />,
    3: (props) => <ExceptionsStep {...props} />,
    4: (props) => <BookingPolicyStep {...props} />,
    5: (props) => <PreviewStep payload={props.payload} mode={props.state.mode} />,
  };
  return map[step];
}

export type { WizardForm };
