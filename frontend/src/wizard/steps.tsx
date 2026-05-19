import { Plus, Trash2 } from "lucide-react";
import type { Dispatch } from "react";
import type { DayOfWeek, ServiceWizardPayload } from "../api";
import {
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
};

export function IdentificationStep({ state, dispatch }: StepProps) {
  const readOnly = state.mode === "edit";
  return (
    <StepShell
      title="Identify the service"
      hint="Pick the customer-facing name. In edit mode the name is fixed and existing rules load below."
    >
      <Field label="Service name">
        <input
          className={inputClass}
          disabled={readOnly}
          placeholder="e.g. plumbing"
          value={state.form.name}
          onChange={(event) =>
            dispatch({ kind: "set_form", patch: { name: event.target.value } })
          }
        />
        {readOnly ? (
          <p className="mt-1 text-xs text-[var(--muted)]">
            Editing an existing service — name is read-only.
          </p>
        ) : null}
      </Field>
    </StepShell>
  );
}

export function ServiceAreaStep({ state, dispatch }: StepProps) {
  const { serviceArea } = state.form;
  return (
    <StepShell
      title="Service area"
      hint='Zip codes (5-digit) or cities ("City, ST"). Inherit the business default if this service has the same area.'
    >
      <InheritToggle
        label="Inherit business default service area"
        checked={serviceArea.inheritDefault}
        onChange={(value) =>
          dispatch({ kind: "set_service_area", patch: { inheritDefault: value } })
        }
      />
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

export function AvailabilityStep({ state, dispatch, timezone }: StepProps) {
  const { availability } = state.form;
  return (
    <StepShell
      title="Availability (recurring hours)"
      hint={`Weekly windows in ${timezone}. Inherit the business default to skip a per-service rule.`}
    >
      <InheritToggle
        label="Inherit business default availability"
        checked={availability.inheritDefault}
        onChange={(value) =>
          dispatch({ kind: "set_availability", patch: { inheritDefault: value } })
        }
      />
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
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,140px)_minmax(0,140px)_auto] items-end gap-2"
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
                <input
                  type="time"
                  className={inputClass}
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
                <input
                  type="time"
                  className={inputClass}
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
              <button
                type="button"
                onClick={() => dispatch({ kind: "remove_window", id: window.id })}
                title="Remove window"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--wash)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => dispatch({ kind: "add_window" })}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold transition hover:border-[var(--focus)]"
          >
            <Plus className="h-4 w-4" /> Add window
          </button>
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
            className="grid grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,200px)_auto] items-end gap-2"
          >
            <Field label="Label (optional)">
              <input
                className={inputClass}
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
              <input
                type="datetime-local"
                className={inputClass}
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
              <input
                type="datetime-local"
                className={inputClass}
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
            <button
              type="button"
              title="Remove exception"
              onClick={() => dispatch({ kind: "remove_exception", id: entry.id })}
              className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[var(--line)] bg-white text-[var(--ink)] transition hover:bg-[var(--wash)]"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => dispatch({ kind: "add_exception" })}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--line)] bg-white px-3 text-sm font-semibold transition hover:border-[var(--focus)]"
        >
          <Plus className="h-4 w-4" /> Add exception
        </button>
      </div>
    </StepShell>
  );
}

export function BookingPolicyStep({ state, dispatch }: StepProps) {
  const { bookingPolicy } = state.form;
  return (
    <StepShell
      title="Booking policy"
      hint="How far ahead and how far out customers can book this service."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Minimum lead time (minutes)">
          <input
            type="number"
            min={0}
            className={inputClass}
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
          <input
            type="number"
            min={1}
            className={inputClass}
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

function InheritToggle({
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
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--focus)]"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
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
        <input
          className={inputClass}
          placeholder={`${placeholder} (press Enter or comma to add)`}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              const input = event.currentTarget;
              const value = input.value.trim();
              if (value && !items.includes(value)) {
                onChange([...items, value]);
              }
              input.value = "";
            }
          }}
          onBlur={(event) => {
            const value = event.currentTarget.value.trim();
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
