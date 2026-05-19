import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";

import { listRules, submitServiceWizard } from "../api";
import type { RuleRecord } from "../api";
import {
  WIZARD_STEP_TITLES,
  buildPayload,
  deriveFormFromRules,
  getBusinessDefaults,
  makeEmptyForm,
  makeInitialState,
  validateStep,
  wizardReducer,
} from "../wizard/state";
import type { WizardMode, WizardState, WizardStep } from "../wizard/state";
import { getStepComponent } from "../wizard/steps";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

const TOTAL_STEPS = 6;
const DEFAULT_TIMEZONE = "America/Chicago";

type BootstrapState = {
  loading: boolean;
  error: string | null;
};

export type ServiceRuleWizardDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  businessName?: string;
  timezone: string;
  mode: WizardMode;
  serviceName?: string | null;
  onSaved: () => void | Promise<void>;
};

export function ServiceRuleWizardDialog({
  open,
  onOpenChange,
  businessId,
  businessName,
  timezone,
  mode,
  serviceName,
  onSaved,
}: ServiceRuleWizardDialogProps) {
  const effectiveTimezone = timezone || DEFAULT_TIMEZONE;
  const initialName = serviceName?.trim() ?? "";
  const [rules, setRules] = useState<RuleRecord[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapState>({
    loading: false,
    error: null,
  });
  const [state, dispatch] = useReducer(
    wizardReducer,
    makeInitialState(mode, makeEmptyForm(), mode === "edit" ? initialName || null : null),
  );

  const defaults = useMemo(
    () => getBusinessDefaults(rules, effectiveTimezone),
    [effectiveTimezone, rules],
  );
  const payload = useMemo(() => buildPayload(state), [state]);
  const stepRender = getStepComponent(state.step);

  useEffect(() => {
    if (!open) return;

    const trimmedServiceName = serviceName?.trim() ?? "";
    const starterDefaults = getBusinessDefaults([], effectiveTimezone);
    const starterForm = makeEmptyForm(starterDefaults);
    if (trimmedServiceName) {
      starterForm.name = trimmedServiceName;
    }

    dispatch({
      kind: "reset",
      state: makeInitialState(
        mode,
        starterForm,
        mode === "edit" ? trimmedServiceName || null : null,
      ),
    });
    setRules([]);

    if (!businessId) {
      setBootstrap({
        loading: false,
        error: "Select a business before configuring a service.",
      });
      return;
    }

    if (mode === "edit" && !trimmedServiceName) {
      setBootstrap({ loading: false, error: "Missing service name." });
      return;
    }

    let cancelled = false;
    setBootstrap({ loading: true, error: null });

    listRules(businessId)
      .then((loadedRules) => {
        if (cancelled) return;

        const nextDefaults = getBusinessDefaults(loadedRules, effectiveTimezone);
        const nextForm =
          mode === "edit"
            ? deriveFormFromRules(trimmedServiceName, loadedRules, nextDefaults)
            : makeEmptyForm(nextDefaults);

        if (mode === "create" && trimmedServiceName) {
          nextForm.name = trimmedServiceName;
        }

        setRules(loadedRules);
        dispatch({
          kind: "reset",
          state: makeInitialState(
            mode,
            nextForm,
            mode === "edit" ? trimmedServiceName : null,
          ),
        });
        setBootstrap({ loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setBootstrap({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load service rules.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [businessId, effectiveTimezone, mode, open, serviceName]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && state.busy) return;
    onOpenChange(nextOpen);
  }

  function handleNext() {
    if (bootstrap.loading || bootstrap.error) return;
    const errors = validateStep(state, state.step);
    if (errors.length > 0) {
      dispatch({ kind: "set_field_errors", errors });
      return;
    }
    dispatch({ kind: "set_field_errors", errors: [] });
    if (state.step < TOTAL_STEPS - 1) {
      dispatch({ kind: "set_step", step: (state.step + 1) as WizardStep });
    }
  }

  function handleBack() {
    dispatch({ kind: "set_field_errors", errors: [] });
    if (state.step > 0) {
      dispatch({ kind: "set_step", step: (state.step - 1) as WizardStep });
    }
  }

  async function handleSubmit() {
    if (bootstrap.loading || bootstrap.error) return;

    const errors: typeof state.fieldErrors = [];
    for (let index = 0; index < TOTAL_STEPS - 1; index += 1) {
      errors.push(...validateStep(state, index as WizardStep));
    }
    if (errors.length > 0) {
      dispatch({ kind: "set_field_errors", errors });
      dispatch({ kind: "set_step", step: errors[0].step as WizardStep });
      return;
    }

    dispatch({ kind: "set_busy", busy: true });
    dispatch({ kind: "set_submit_error", error: null });
    try {
      await submitServiceWizard(businessId, payload);
      await onSaved();
      onOpenChange(false);
    } catch (err) {
      dispatch({
        kind: "set_submit_error",
        error: err instanceof Error ? err.message : "Submit failed.",
      });
    } finally {
      dispatch({ kind: "set_busy", busy: false });
    }
  }

  const title = mode === "edit" ? "Edit service rule" : "Add service rule";
  const description = businessName
    ? `${businessName} service rules in ${effectiveTimezone}.`
    : `Service rules in ${effectiveTimezone}.`;
  const canAdvance = !state.busy && !bootstrap.loading && !bootstrap.error;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--line)] px-5 py-4 pr-12">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="border-b border-[var(--line)] bg-[var(--wash)] px-4 py-3">
          <Stepper current={state.step} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {bootstrap.error ? <ErrorBanner message={bootstrap.error} /> : null}
          {state.fieldErrors.length > 0 ? <FieldErrorBanner state={state} /> : null}
          {state.submitError ? <ErrorBanner message={state.submitError} /> : null}

          {bootstrap.loading ? (
            <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-[var(--line)] bg-[var(--wash)] text-sm text-[var(--muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading service rules...
            </div>
          ) : bootstrap.error ? null : (
            stepRender({
              state,
              dispatch,
              timezone: effectiveTimezone,
              defaults,
              payload,
            })
          )}
        </div>

        <DialogFooter className="items-center justify-between border-t border-[var(--line)] bg-white px-5 py-4 sm:flex-row sm:justify-between">
          <Button
            type="button"
            onClick={handleBack}
            disabled={state.step === 0 || state.busy}
            variant="outline"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <p className="text-xs font-medium text-[var(--muted)]">
            Step {state.step + 1} of {TOTAL_STEPS} - {WIZARD_STEP_TITLES[state.step]}
          </p>
          {state.step < TOTAL_STEPS - 1 ? (
            <Button type="button" onClick={handleNext} disabled={!canAdvance}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" onClick={handleSubmit} disabled={!canAdvance}>
              {state.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {state.busy ? "Submitting..." : mode === "edit" ? "Save changes" : "Create service"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({ current }: { current: WizardStep }) {
  const steps = [0, 1, 2, 3, 4, 5] as const;
  return (
    <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-6">
      {steps.map((step) => {
        const isActive = step === current;
        const isDone = step < current;
        return (
          <li
            key={step}
            className={[
              "flex min-h-10 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition",
              isActive
                ? "border-[var(--focus)] bg-[var(--focus)] text-white"
                : isDone
                  ? "border-[var(--line)] bg-white text-[var(--muted-strong)]"
                  : "border-[var(--line)] bg-white/70 text-[var(--muted)]",
            ].join(" ")}
          >
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/40 text-[10px]">
              {isDone ? <Check className="h-3 w-3" /> : step + 1}
            </span>
            <span className="truncate">{WIZARD_STEP_TITLES[step]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {message}
    </div>
  );
}

function FieldErrorBanner({ state }: { state: WizardState }) {
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-[var(--amber-soft)] p-3 text-sm text-[var(--amber)]">
      <p className="font-semibold">Please fix the following before continuing:</p>
      <ul className="ml-4 mt-1 list-disc space-y-1">
        {state.fieldErrors.map((err, index) => (
          <li key={`${err.field}-${index}`}>
            <span className="font-mono text-xs">
              {WIZARD_STEP_TITLES[err.step as WizardStep]} - {err.field}
            </span>{" "}
            - {err.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
