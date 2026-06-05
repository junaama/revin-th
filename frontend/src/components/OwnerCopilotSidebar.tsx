import {
  CalendarClock,
  Check,
  Clock,
  Code2,
  Info,
  MapPin,
  RefreshCw,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Wrench,
  X,
} from "lucide-react";
import type { ComponentType, KeyboardEvent, SVGProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ClarifyChip,
  DiffLine,
  OwnerCopilotResponse,
  OwnerRuleProposal,
  RuleRecord,
} from "../api";
import { sendOwnerCopilotMessage } from "../api";
import type { CopilotUndoSnapshot } from "../ownerCopilot";
import { Button } from "./ui/button";

type ConfirmMode = "preview" | "auto";

type OwnerCopilotSidebarProps = {
  businessId: string;
  confirmMode?: ConfirmMode;
  onApply: (proposal: OwnerRuleProposal) => Promise<CopilotUndoSnapshot>;
  onOpenChange: (open: boolean) => void;
  onUndo: (snapshot: CopilotUndoSnapshot) => Promise<void>;
  open: boolean;
};

type OwnerMessage = {
  id: string;
  role: "owner";
  kind: "text";
  text: string;
};

type AgentMessage =
  | {
      id: string;
      role: "agent";
      kind: "thinking";
    }
  | {
      id: string;
      role: "agent";
      kind: "text";
      text: string;
    }
  | {
      id: string;
      role: "agent";
      kind: "steps";
      active: number;
      steps: string[];
    }
  | {
      id: string;
      role: "agent";
      kind: "diff";
      proposal: OwnerRuleProposal;
      snapshot?: CopilotUndoSnapshot;
      status: "pending" | "applied" | "dismissed";
    }
  | {
      id: string;
      role: "agent";
      kind: "clarify";
      chips: ClarifyChip[];
      message: string;
      question: string;
    };

type CopilotMessage = OwnerMessage | AgentMessage;
type MessageDraft = CopilotMessage extends infer Message
  ? Message extends CopilotMessage
    ? Omit<Message, "id">
    : never
  : never;

const SUGGESTIONS = [
  {
    icon: CalendarClock,
    text: "Close at 2:00 PM on Sundays",
  },
  {
    icon: MapPin,
    text: "Add ZIP code 60622 to our service area",
  },
  {
    icon: Clock,
    text: "Require 24 hours notice before booking",
  },
  {
    icon: CalendarClock,
    text: "We should close earlier on weekends",
  },
] as const;

const DEFAULT_STEPS = [
  "Reading your request",
  "Matched rule",
  "Drafting the change",
] as const;

export function OwnerCopilotSidebar({
  businessId,
  confirmMode = "preview",
  onApply,
  onOpenChange,
  onUndo,
  open,
}: OwnerCopilotSidebarProps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const timersRef = useRef<number[]>([]);

  const scrollDown = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages, scrollDown]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(window.clearTimeout);
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  function wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      timersRef.current.push(timer);
    });
  }

  function nextId() {
    return `copilot-${crypto.randomUUID()}`;
  }

  function push(message: MessageDraft): string {
    const id = nextId();
    setMessages((current) => [...current, { id, ...message } as CopilotMessage]);
    return id;
  }

  function patchMessage(id: string, fields: Partial<AgentMessage>) {
    setMessages((current) =>
      current.map((message) =>
        message.id === id ? ({ ...message, ...fields } as CopilotMessage) : message,
      ),
    );
  }

  function updateDiffMessage(
    id: string,
    fields: Partial<Extract<AgentMessage, { kind: "diff" }>>,
  ) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id || message.kind !== "diff") return message;
        return { ...message, ...fields };
      }),
    );
  }

  function autoResizeTextarea() {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
  }

  async function sendText(rawText: string) {
    const content = rawText.trim();
    if (!content || busy || !businessId) return;

    setBusy(true);
    push({ role: "owner", kind: "text", text: content });
    setDraft("");
    requestAnimationFrame(autoResizeTextarea);
    const thinkingId = push({ role: "agent", kind: "thinking" });

    try {
      const [response] = await Promise.all([
        sendOwnerCopilotMessage(businessId, content),
        wait(260),
      ]);
      await renderResponse(thinkingId, response);
    } catch (error) {
      patchMessage(thinkingId, {
        kind: "text",
        text: error instanceof Error ? error.message : "Revin Copilot is unavailable right now.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function renderResponse(thinkingId: string, response: OwnerCopilotResponse) {
    if (response.kind === "message") {
      patchMessage(thinkingId, { kind: "text", text: response.message });
      return;
    }

    if (response.kind === "clarify") {
      patchMessage(thinkingId, {
        kind: "clarify",
        message: response.message,
        question: response.question,
        chips: response.chips,
      });
      return;
    }

    const steps = response.reasoning?.length ? response.reasoning : [...DEFAULT_STEPS];
    patchMessage(thinkingId, { kind: "steps", steps, active: 0 });
    for (let index = 1; index <= steps.length; index += 1) {
      await wait(180);
      patchMessage(thinkingId, { active: index });
    }
    await wait(120);
    patchMessage(thinkingId, { kind: "text", text: response.proposal.summary });

    if (confirmMode === "auto") {
      const snapshot = await onApply(response.proposal);
      push({
        role: "agent",
        kind: "diff",
        proposal: response.proposal,
        status: "applied",
        snapshot,
      });
      queueAgentText("Done - your dashboard is updated. Anything else?", 280);
      return;
    }

    push({
      role: "agent",
      kind: "diff",
      proposal: response.proposal,
      status: "pending",
    });
  }

  function queueAgentText(text: string, delay: number) {
    const timer = window.setTimeout(() => {
      push({ role: "agent", kind: "text", text });
    }, delay);
    timersRef.current.push(timer);
  }

  async function confirmChange(message: Extract<AgentMessage, { kind: "diff" }>) {
    if (message.status !== "pending" || busy) return;
    setBusy(true);
    try {
      const snapshot = await onApply(message.proposal);
      updateDiffMessage(message.id, { status: "applied", snapshot });
      queueAgentText("Done - your dashboard is updated. Anything else?", 280);
    } catch (error) {
      push({
        role: "agent",
        kind: "text",
        text: error instanceof Error ? error.message : "That edit could not be applied.",
      });
    } finally {
      setBusy(false);
    }
  }

  function cancelChange(message: Extract<AgentMessage, { kind: "diff" }>) {
    updateDiffMessage(message.id, { status: "dismissed" });
  }

  async function undoChange(message: Extract<AgentMessage, { kind: "diff" }>) {
    if (!message.snapshot || busy) return;
    setBusy(true);
    try {
      await onUndo(message.snapshot);
      updateDiffMessage(message.id, { status: "dismissed" });
      push({
        role: "agent",
        kind: "text",
        text: "Reverted. Your previous settings are back in place.",
      });
    } catch (error) {
      push({
        role: "agent",
        kind: "text",
        text: error instanceof Error ? error.message : "That edit could not be reverted.",
      });
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendText(draft);
    }
  }

  const empty = messages.length === 0;

  return (
    <>
      <button
        aria-label="Ask Revin"
        className="ask-revin-button"
        data-open={open}
        onClick={() => onOpenChange(true)}
        type="button"
      >
        <span className="ask-revin-mark">
          <span className="ask-revin-triangle" />
          <span className="ask-revin-pulse" />
        </span>
        Ask Revin
      </button>
      <div
        aria-hidden="true"
        className="owner-copilot-scrim"
        data-open={open}
        onClick={() => onOpenChange(false)}
      />
      <aside
        aria-hidden={!open}
        aria-label="Revin Copilot"
        className="owner-copilot-sidebar"
        data-open={open}
      >
        <header className="owner-copilot-header">
          <div className="owner-copilot-avatar">
            <span className="ask-revin-triangle" />
          </div>
          <div className="min-w-0">
            <h2>Revin Copilot</h2>
            <p>Edit your rules by asking</p>
          </div>
          <span className="owner-copilot-status">
            <span />
            Connected
          </span>
          <Button
            aria-label="Close copilot"
            className="h-9 w-9"
            onClick={() => onOpenChange(false)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="owner-copilot-body" ref={bodyRef}>
          {empty ? (
            <CopilotEmptyState disabled={busy || !businessId} onSend={sendText} />
          ) : (
            messages.map((message) => (
              <CopilotMessageView
                busy={busy}
                key={message.id}
                message={message}
                onCancel={cancelChange}
                onConfirm={confirmChange}
                onSend={sendText}
                onUndo={undoChange}
              />
            ))
          )}
        </div>

        <footer className="owner-copilot-footer">
          <div className="owner-copilot-composer">
            <textarea
              disabled={busy || !businessId}
              onChange={(event) => {
                setDraft(event.target.value);
                autoResizeTextarea();
              }}
              onInput={autoResizeTextarea}
              onKeyDown={handleKeyDown}
              placeholder="Ask Revin to change a rule..."
              ref={textareaRef}
              rows={1}
              value={draft}
            />
            <button
              aria-label="Send"
              className="owner-copilot-send"
              disabled={busy || !draft.trim() || !businessId}
              onClick={() => void sendText(draft)}
              type="button"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <div className="owner-copilot-hint">
            <span>Revin shows every edit before applying.</span>
            <span>
              <kbd>Enter</kbd> to send
            </span>
          </div>
        </footer>
      </aside>
    </>
  );
}

function CopilotEmptyState({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  return (
    <div className="owner-copilot-empty">
      <p>
        Hi - I'm your <b>rules copilot</b>. Tell me what to change in plain language and
        I'll show you the exact edit before it goes live.
      </p>
      <div className="owner-copilot-suggestions">
        <span>Try asking</span>
        {SUGGESTIONS.map((suggestion) => {
          const Icon = suggestion.icon;
          return (
            <button
              className="owner-copilot-suggestion"
              disabled={disabled}
              key={suggestion.text}
              onClick={() => void onSend(suggestion.text)}
              type="button"
            >
              <Icon className="h-[17px] w-[17px]" />
              <span>{suggestion.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CopilotMessageView({
  busy,
  message,
  onCancel,
  onConfirm,
  onSend,
  onUndo,
}: {
  busy: boolean;
  message: CopilotMessage;
  onCancel: (message: Extract<AgentMessage, { kind: "diff" }>) => void;
  onConfirm: (message: Extract<AgentMessage, { kind: "diff" }>) => Promise<void>;
  onSend: (text: string) => Promise<void>;
  onUndo: (message: Extract<AgentMessage, { kind: "diff" }>) => Promise<void>;
}) {
  if (message.role === "owner") {
    return (
      <div className="owner-copilot-owner-row">
        <div className="owner-copilot-owner-bubble owner-copilot-pop">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="owner-copilot-agent-row owner-copilot-pop">
      <div className="owner-copilot-agent-avatar">
        <span className="ask-revin-triangle" />
      </div>
      <div className="owner-copilot-agent-stack">
        {message.kind === "thinking" ? <ThinkingBubble /> : null}
        {message.kind === "text" ? <AgentTextBubble text={message.text} /> : null}
        {message.kind === "steps" ? <StepsCard active={message.active} steps={message.steps} /> : null}
        {message.kind === "clarify" ? (
          <ClarifyMessage busy={busy} message={message} onSend={onSend} />
        ) : null}
        {message.kind === "diff" ? (
          <DiffCard
            busy={busy}
            message={message}
            onCancel={onCancel}
            onConfirm={onConfirm}
            onUndo={onUndo}
          />
        ) : null}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="owner-copilot-agent-bubble">
      <span className="owner-copilot-thinking">
        Thinking
        <span>
          <i />
          <i />
          <i />
        </span>
      </span>
    </div>
  );
}

function AgentTextBubble({ text }: { text: string }) {
  return <div className="owner-copilot-agent-bubble owner-copilot-pop">{text}</div>;
}

function StepsCard({ active, steps }: { active: number; steps: string[] }) {
  return (
    <div className="owner-copilot-steps">
      {steps.map((step, index) => {
        const state = index < active ? "done" : index === active ? "active" : "todo";
        return (
          <div
            className="owner-copilot-step"
            data-active={state === "active"}
            data-done={state === "done"}
            key={`${step}-${index}`}
          >
            <span>
              {state === "done" ? (
                <Check className="h-3 w-3" strokeWidth={3} />
              ) : state === "active" ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <i />
              )}
            </span>
            {step}
          </div>
        );
      })}
    </div>
  );
}

function ClarifyMessage({
  busy,
  message,
  onSend,
}: {
  busy: boolean;
  message: Extract<AgentMessage, { kind: "clarify" }>;
  onSend: (text: string) => Promise<void>;
}) {
  return (
    <>
      <AgentTextBubble text={message.message} />
      <div className="owner-copilot-agent-bubble font-semibold">{message.question}</div>
      <div className="owner-copilot-chips">
        {message.chips.map((chip) => (
          <button
            className="owner-copilot-chip"
            disabled={busy}
            key={chip.fill}
            onClick={() => void onSend(chip.fill)}
            type="button"
          >
            {chip.label}
          </button>
        ))}
      </div>
    </>
  );
}

function DiffCard({
  busy,
  message,
  onCancel,
  onConfirm,
  onUndo,
}: {
  busy: boolean;
  message: Extract<AgentMessage, { kind: "diff" }>;
  onCancel: (message: Extract<AgentMessage, { kind: "diff" }>) => void;
  onConfirm: (message: Extract<AgentMessage, { kind: "diff" }>) => Promise<void>;
  onUndo: (message: Extract<AgentMessage, { kind: "diff" }>) => Promise<void>;
}) {
  const proposal = message.proposal;
  const applied = message.status === "applied";
  const dismissed = message.status === "dismissed";

  return (
    <div className="owner-copilot-diff owner-copilot-pop">
      <div className="owner-copilot-diff-head">
        <div className="owner-copilot-rule-icon">
          <RuleIcon type={proposal.ruleType} />
        </div>
        <div className="min-w-0">
          <span>{applied ? "Applied change" : "Proposed change"}</span>
          <h4>{proposal.ruleTitle}</h4>
        </div>
      </div>
      <div className="owner-copilot-diff-body">
        <div>
          <div className="owner-copilot-diff-label">{proposal.fieldLabel}</div>
          {proposal.before.map((line, index) => (
            <DiffLineView key={`before-${index}-${line.text}`} line={line} />
          ))}
          {proposal.after.map((line, index) => (
            <DiffLineView key={`after-${index}-${line.text}`} line={line} />
          ))}
        </div>
        {proposal.note ? (
          <div className="owner-copilot-diff-note">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{proposal.note}</span>
          </div>
        ) : null}
      </div>
      <div className="owner-copilot-diff-actions">
        {applied ? (
          <>
            <span className="owner-copilot-applied">
              <Check className="h-4 w-4" strokeWidth={3} />
              Applied to dashboard
            </span>
            <Button
              disabled={busy || !message.snapshot}
              onClick={() => void onUndo(message)}
              size="sm"
              type="button"
              variant="ghost"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Undo
            </Button>
          </>
        ) : dismissed ? (
          <span className="text-sm text-[var(--muted)]">Discarded - nothing changed.</span>
        ) : (
          <>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => onCancel(message)}
              size="sm"
              type="button"
              variant="outline"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={busy}
              onClick={() => void onConfirm(message)}
              size="sm"
              type="button"
            >
              <Check className="h-3.5 w-3.5" />
              Confirm &amp; apply
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DiffLineView({ line }: { line: DiffLine }) {
  const marker = line.op === "add" || line.op === "change-to" ? "+" : line.op === "keep" ? "·" : "-";
  return (
    <div className={`owner-copilot-diff-line owner-copilot-diff-line-${line.op}`}>
      <span>{marker}</span>
      <span>{renderDiffValue(line)}</span>
    </div>
  );
}

function renderDiffValue(line: DiffLine) {
  if (line.op === "add" || line.op === "change-to") {
    return <span className="owner-copilot-diff-pill">{line.text}</span>;
  }
  if (line.op === "del") {
    return <span className="owner-copilot-diff-pill owner-copilot-diff-pill-del">{line.text}</span>;
  }
  if (line.op === "change-from") {
    return <span className="owner-copilot-diff-old">{line.text}</span>;
  }
  return line.text;
}

function RuleIcon({ type }: { type: RuleRecord["type"] }) {
  const iconMap: Record<RuleRecord["type"], ComponentType<SVGProps<SVGSVGElement>>> = {
    booking_policy: SlidersHorizontal,
    business_hours: CalendarClock,
    service_area: MapPin,
    services_offered: Wrench,
  };
  const Icon = iconMap[type] ?? Code2;
  return <Icon className="h-[18px] w-[18px]" />;
}
