import { describe, expect, it } from "vitest";
import evaluationData from "@/data/evaluation-cases.v1.json";
import { buildDebrief } from "@/lib/debrief";
import { publicScenarioData, scenario } from "@/lib/scenario";
import { parseTransmission, validateTransmission } from "@/lib/transmission";

describe("WSSL scenario package", () => {
  it("loads a build-validated scenario with hidden routes", () => {
    expect(scenario.steps).toHaveLength(6);
    expect(scenario.routeIds).toHaveLength(3);
    expect(Object.keys(publicScenarioData([]).routes)).toHaveLength(0);
  });

  it("uses only chart-published stand and movement identifiers", () => {
    const taxi = scenario.steps.find((step) => step.id === "taxi-readback")!.instruction;
    expect(scenario.startPositionId).toBe("STAND_C6");
    expect(scenario.airport.runway).toBe("21");
    expect(taxi.taxiways).toEqual(["WP"]);
    expect(taxi.holdingPoint).toBe("W1");
    expect(JSON.stringify(scenario)).not.toMatch(/STAND_C7|Echo Six|EC5|runway zero three/i);
  });

  it("contains at least 120 labeled evaluation cases awaiting SME review", () => {
    expect(evaluationData.cases.length).toBeGreaterThanOrEqual(120);
    expect(evaluationData.reviewStatus).toBe("AWAITING_SME_LABEL_REVIEW");
  });
});

describe("deterministic readback validation", () => {
  for (const fixture of evaluationData.cases) {
    it(`${fixture.id} → ${fixture.expectedStatus}`, () => {
      const step = scenario.steps.find((candidate) => candidate.id === fixture.stepId);
      expect(step).toBeDefined();
      const parsed = parseTransmission(fixture.transcript, fixture.confidence);
      const result = validateTransmission(step!.instruction, parsed, step!.successTransition);
      expect(result.status).toBe(fixture.expectedStatus);
    });
  }

  it("never accepts the held-out safety-critical wrong-runway set", () => {
    const safetyCases = evaluationData.cases.filter((fixture) => fixture.id.includes("safety") && fixture.transcript.toLowerCase().includes("zero three"));
    expect(safetyCases.length).toBeGreaterThan(0);
    for (const fixture of safetyCases) {
      const step = scenario.steps.find((candidate) => candidate.id === fixture.stepId)!;
      const result = validateTransmission(step.instruction, parseTransmission(fixture.transcript, fixture.confidence), step.successTransition);
      expect(result.status).not.toBe("ACCEPTED");
    }
  });
});

describe("debrief facts", () => {
  it("prioritizes runway corrections over assistance use", () => {
    const debrief = buildDebrief([
      { type: "TRANSMISSION_EVALUATED", payload: { status: "CORRECTION_REQUIRED", incorrectFields: ["RUNWAY"] }, createdAt: "2026-08-19T00:00:00Z" },
      { type: "HINT_USED", payload: {}, createdAt: "2026-08-19T00:00:01Z" },
    ], "COMPLETE");
    expect(debrief.nextPracticeFocus).toBe("Runway safety readbacks");
    expect(debrief.metrics.hintsUsed).toBe(1);
  });
});
