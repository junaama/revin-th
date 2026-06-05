import { describe, expect, it } from "vitest";

import type { OwnerRuleProposal, RuleRecord } from "./api";
import {
  flashTargetForRule,
  restorePayloadFromSnapshot,
  shouldFlashService,
  snapshotForProposal,
} from "./ownerCopilot";

function makeAreaRule(): RuleRecord {
  return {
    id: "rule_area",
    business_id: "biz_toms_hvac",
    type: "service_area",
    config: {
      id: "rule_area",
      type: "service_area",
      zip_codes: ["78704"],
      cities: ["Austin, TX"],
    },
    enabled: true,
    created_at: 1,
    updated_at: 2,
  };
}

const serviceAreaProposal: OwnerRuleProposal = {
  ruleType: "service_area",
  ruleTitle: "Service area",
  fieldLabel: "ZIP codes",
  summary: "I'll add ZIP code 60622 to your service area.",
  before: [{ op: "keep", text: "78704" }],
  after: [{ op: "add", text: "60622" }],
  note: "You'll start accepting bookings and quotes in 60622.",
  patch: {
    operation: "update",
    ruleId: "rule_area",
    payload: { zip_codes: ["78704", "60622"] },
  },
};

describe("owner copilot helpers", () => {
  it("captures an immutable update snapshot for undo", () => {
    const areaRule = makeAreaRule();
    const rules = [areaRule];

    const snapshot = snapshotForProposal(rules, serviceAreaProposal);
    (areaRule.config as { zip_codes: string[] }).zip_codes = ["99999"];

    expect(snapshot).toEqual({
      operation: "update",
      previousRule: {
        ...areaRule,
        config: {
          id: "rule_area",
          type: "service_area",
          zip_codes: ["78704"],
          cities: ["Austin, TX"],
        },
      },
    });
  });

  it("restores the full previous config and enabled state", () => {
    const areaRule = makeAreaRule();
    const snapshot = snapshotForProposal([areaRule], serviceAreaProposal);

    if (!snapshot || snapshot.operation !== "update") {
      throw new Error("expected update snapshot");
    }

    expect(restorePayloadFromSnapshot(snapshot)).toEqual({
      id: "rule_area",
      type: "service_area",
      zip_codes: ["78704"],
      cities: ["Austin, TX"],
      enabled: true,
    });
  });

  it("returns null until a created rule id exists", () => {
    const areaRule = makeAreaRule();
    const proposal: OwnerRuleProposal = {
      ...serviceAreaProposal,
      patch: {
        operation: "create",
        payload: {
          type: "booking_policy",
          min_lead_minutes: 1440,
          max_advance_days: 365,
        },
      },
    };

    expect(snapshotForProposal([areaRule], proposal)).toBeNull();
  });

  it("matches service row flash targets by normalized service name", () => {
    const areaRule = makeAreaRule();
    const scopedRule: RuleRecord = {
      ...areaRule,
      id: "rule_panel_area",
      config: {
        ...areaRule.config,
        service: "Panel Repair",
      },
    };

    const target = flashTargetForRule(scopedRule, 42);

    expect(target).toEqual({
      ruleId: "rule_panel_area",
      serviceName: "Panel Repair",
      nonce: 42,
    });
    expect(shouldFlashService(" panel   repair ", target)).toBe(true);
    expect(shouldFlashService("outlet installation", target)).toBe(false);
  });
});
