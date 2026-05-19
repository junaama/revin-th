import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useReducer, useState } from "react";
import {
  Business,
  listBusinesses,
  listRules,
  submitServiceWizard,
} from "../api";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import {
  WIZARD_STEP_TITLES,
  WizardState,
  WizardStep,
  buildPayload,
  deriveFormFromRules,
  makeEmptyForm,
  makeInitialState,
  validateStep,
  wizardReducer,
} from "../wizard/state";
import { getStepComponent } from "../wizard/steps";

const TOTAL_STEPS = 6;

type Props = {
  mode: "create" | "edit";
  serviceName: string | null;
};

export function ServiceWizardPage({ mode, serviceName }: Props) {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [bootstrap, setBootstrap] = useState<{ loading: boolean; error: string | null }>({
    loading: true,
    error: null,
  });

  const initialState = useMemo<WizardState>(() => {
    const form = makeEmptyForm();
    if (mode === "edit" && serviceName) {
      form.name = serviceName;
    }
    return makeInitialState(mode, form, serviceName);
  }, [mode, serviceName]);

  const [state, dispatch] = useReducer(wizardReducer, initialState);

  const business = useMemo(
    () => businesses.find((b) => b.id === businessId),
    [businessId, businesses],
  );

  useEffect(() => {
    listBusinesses()
      .then((items) => {
        setBusinesses(items);
        setBusinessId(items[0]?.id ?? "");
      })
      .catch((err) =>
        setBootstrap({ loading: false, error: err instanceof Error ? err.message : "Bootstrap failed" }),
      );
  }, []);

  useEffect(() => {
    if (!businessId) return;
    setBootstrap({ loading: true, error: null });

    if (mode === "create") {
      dispatch({ kind: "reset", state: makeInitialState("create", makeEmptyForm(), null) });
      setBootstrap({ loading: false, error: null });
      return;
    }

    listRules(businessId)
      .then((rules) => {
        if (!serviceName) {
          setBootstrap({ loading: false, error: "Missing service name." });
          return;
        }
        const form = deriveFormFromRules(serviceName, rules);
        dispatch({ kind: "reset", state: makeInitialState("edit", form, serviceName) });
        setBootstrap({ loading: false, error: null });
      })
      .catch((err) =>
        setBootstrap({
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load service",
        }),
      );
  }, [businessId, mode, serviceName]);

  const payload = useMemo(() => buildPayload(state), [state]);

  async function handleNext() {
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
    const errors: typeof state.fieldErrors = [];
    for (let i = 0; i < TOTAL_STEPS - 1; i += 1) {
      errors.push(...validateStep(state, i as WizardStep));
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
      window.location.href = "/dashboard/services";
    } catch (err) {
      dispatch({
        kind: "set_submit_error",
        error: err instanceof Error ? err.message : "Submit failed",
      });
    } finally {
      dispatch({ kind: "set_busy", busy: false });
    }
  }

  const stepRender = getStepComponent(state.step);

  return (
    <main className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--line)] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
              {mode === "edit" ? "Edit service" : "New service"}
            </p>
            <h1 className="mt-1 font-display text-3xl leading-tight sm:text-4xl">
              {state.form.name || "Untitled service"}
            </h1>
          </div>
          <Button asChild variant="outline">
            <a href="/dashboard/services">
              <ArrowLeft className="h-4 w-4" /> All services
            </a>
          </Button>
        </header>

        <Stepper current={state.step} />

        {bootstrap.error ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {bootstrap.error}
          </div>
        ) : null}

        {state.fieldErrors.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-[var(--amber-soft)] p-3 text-sm text-[var(--amber)]">
            <p className="font-semibold">Please fix the following before continuing:</p>
            <ul className="ml-4 mt-1 list-disc space-y-1">
              {state.fieldErrors.map((err, index) => (
                <li key={index}>
                  <span className="font-mono text-xs">{WIZARD_STEP_TITLES[err.step as WizardStep]} · {err.field}</span>{" "}
                  — {err.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {state.submitError ? (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {state.submitError}
          </div>
        ) : null}

        <Card className="mt-5">
          <CardContent className="p-5">
            {bootstrap.loading ? (
              <p className="text-sm text-[var(--muted)]">Loading…</p>
            ) : (
              stepRender({
                state,
                dispatch,
                timezone: business?.timezone ?? "America/Chicago",
                payload,
              })
            )}
          </CardContent>
        </Card>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <Button
            type="button"
            onClick={handleBack}
            disabled={state.step === 0 || state.busy}
            variant="outline"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <p className="text-xs text-[var(--muted)]">
            Step {state.step + 1} of {TOTAL_STEPS} — {WIZARD_STEP_TITLES[state.step]}
          </p>
          {state.step < TOTAL_STEPS - 1 ? (
            <Button
              type="button"
              onClick={handleNext}
              disabled={state.busy || bootstrap.loading}
            >
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={state.busy || bootstrap.loading}
            >
              <Check className="h-4 w-4" />
              {state.busy ? "Submitting…" : mode === "edit" ? "Save changes" : "Create service"}
            </Button>
          )}
        </footer>
      </section>
    </main>
  );
}

function Stepper({ current }: { current: WizardStep }) {
  const steps = [0, 1, 2, 3, 4, 5] as const;
  return (
    <ol className="mt-4 flex flex-wrap gap-1.5">
      {steps.map((step) => {
        const isActive = step === current;
        const isDone = step < current;
        return (
          <li
            key={step}
            className={[
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition",
              isActive
                ? "border-[var(--focus)] bg-[var(--focus)] text-white"
                : isDone
                ? "border-[var(--line)] bg-[var(--wash)] text-[var(--muted-strong)]"
                : "border-[var(--line)] bg-white text-[var(--muted)]",
            ].join(" ")}
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/40 text-[10px]">
              {isDone ? <Check className="h-3 w-3" /> : step + 1}
            </span>
            {WIZARD_STEP_TITLES[step]}
          </li>
        );
      })}
    </ol>
  );
}
