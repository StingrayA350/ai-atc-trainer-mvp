import { describe, expect, it } from "vitest";
import evaluationData from "@/data/evaluation-cases.v1.json";
import { isSilentRecording } from "@/lib/audio";
import { buildDebrief } from "@/lib/debrief";
import { prepareSpeechText, speakFrequency, speakIdentifier, speakPosition } from "@/lib/phraseology";
import { publicScenarioData, scenario } from "@/lib/scenario";
import { correctionFor, parseTransmission, validateTransmission } from "@/lib/transmission";

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

  it("uses phonetic aviation wording in every learner-facing ATC exchange", () => {
    const spokenText = [
      scenario.aircraft.spokenCallsign,
      ...Object.values(scenario.routes).flatMap((route) => [route.label, route.completionControllerText]),
      ...scenario.steps.flatMap((step) => [step.instruction.approvedSpokenText, step.successControllerText, step.hint]),
    ];

    expect(scenario.aircraft.spokenCallsign).toBe("9 Victor Bravo Charlie Alpha");
    expect(spokenText.every((text) => !text.includes("9V-BCA"))).toBe(true);
    expect(spokenText.join(" ")).not.toMatch(/\b(?:WP|W1|C6)\b|runway 21|118\.45/i);
  });

  it("formats chart identifiers as spoken aviation phraseology", () => {
    expect(speakIdentifier("WP")).toBe("Whiskey Papa");
    expect(speakIdentifier("W1")).toBe("Whiskey One");
    expect(speakIdentifier("21")).toBe("Two One");
    expect(speakPosition("STAND_C6")).toBe("Stand Charlie Six");
    expect(speakFrequency("118.450")).toBe("One One Eight Decimal Four Five");
    expect(prepareSpeechText("Proceed via WP to W1, 9V-BCA.")).toBe(
      "Proceed via Whiskey Papa to Whiskey One, 9 Victor Bravo Charlie Alpha.",
    );
  });

  it("contains at least 120 labeled evaluation cases awaiting SME review", () => {
    expect(evaluationData.cases.length).toBeGreaterThanOrEqual(120);
    expect(evaluationData.reviewStatus).toBe("AWAITING_SME_LABEL_REVIEW");
  });

  it("treats silent push-to-talk input as a cancelled recording", () => {
    expect(isSilentRecording("", 0)).toBe(true);
    expect(isSilentRecording("   ", 2)).toBe(true);
    expect(isSilentRecording("", 3)).toBe(false);
    expect(isSilentRecording("Whiskey Papa", 0)).toBe(false);
  });
});

describe("deterministic readback validation", () => {
  it("accepts Whiskey or Whisky Papa rather than requiring the letters W P", () => {
    const step = scenario.steps.find((candidate) => candidate.id === "taxi-readback")!;
    const transcript = "Taxi via Whisky Papa to holding point Whisky One, hold short of runway two one, 9 Victor Bravo Charlie Alpha.";
    const parsed = parseTransmission(transcript);

    expect(parsed.taxiways).toEqual(["WP"]);
    expect(parsed.holdingPoint).toBe("W1");
    expect(validateTransmission(step.instruction, parsed, step.successTransition).status).toBe("ACCEPTED");
  });

  it("uses calm coaching language and expands taxiway arrays in corrections", () => {
    const step = scenario.steps.find((candidate) => candidate.id === "taxi-readback")!;
    const parsed = parseTransmission("Holding point Whiskey One, hold short of runway two one, 9 Victor Bravo Charlie Alpha.");
    const result = validateTransmission(step.instruction, parsed, step.successTransition);
    const message = correctionFor(result);

    expect(message).toContain("you're close");
    expect(message).toContain("taxiway should be Whiskey Papa");
    expect(message).not.toMatch(/\bWP\b|negative|wrong/i);
  });

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
