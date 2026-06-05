import type { OwnerRuleProposal, RuleRecord } from "./api";

export type CopilotUndoSnapshot =
  | {
      operation: "update";
      previousRule: RuleRecord;
    }
  | {
      operation: "create";
      createdRuleId: string;
    };

export type RuleFlashTarget = {
  ruleId: string;
  serviceName: string | null;
  nonce: number;
};

export function cloneRule(rule: RuleRecord): RuleRecord {
  return {
    ...rule,
    config: structuredClone(rule.config),
  };
}

export function snapshotForProposal(
  rules: RuleRecord[],
  proposal: OwnerRuleProposal,
): CopilotUndoSnapshot | null {
  if (proposal.patch.operation === "create") {
    return null;
  }
  const ruleId = proposal.patch.ruleId;
  const previousRule = ruleId ? rules.find((rule) => rule.id === ruleId) : undefined;
  if (!previousRule) {
    return null;
  }
  return {
    operation: "update",
    previousRule: cloneRule(previousRule),
  };
}

export function restorePayloadFromSnapshot(
  snapshot: Extract<CopilotUndoSnapshot, { operation: "update" }>,
): Record<string, unknown> {
  return {
    ...structuredClone(snapshot.previousRule.config),
    enabled: snapshot.previousRule.enabled,
  };
}

export function flashTargetForRule(rule: RuleRecord, nonce: number): RuleFlashTarget {
  return {
    ruleId: rule.id,
    serviceName: typeof rule.config.service === "string" ? rule.config.service : null,
    nonce,
  };
}

export function shouldFlashService(
  serviceName: string,
  target: RuleFlashTarget | null,
): boolean {
  if (!target?.serviceName) return false;
  return normalizeText(serviceName) === normalizeText(target.serviceName);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
