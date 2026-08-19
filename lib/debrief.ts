import type { ScenarioState } from "./schemas";

export type SessionEvent = {
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export function deriveMetrics(events: SessionEvent[]) {
  const attempts = events.filter((event) => event.type === "TRANSMISSION_EVALUATED");
  const accepted = attempts.filter((event) => event.payload.status === "ACCEPTED");
  const corrections = attempts.filter((event) => event.payload.status === "CORRECTION_REQUIRED");
  const clarification = attempts.filter((event) => event.payload.status === "CLARIFICATION_REQUIRED");
  const correctionFields = corrections.flatMap((event) =>
    Array.isArray(event.payload.incorrectFields) ? (event.payload.incorrectFields as string[]) : [],
  );
  const fieldCounts = Object.fromEntries(
    [...new Set(correctionFields)].map((field) => [field, correctionFields.filter((item) => item === field).length]),
  );

  return {
    totalAttempts: attempts.length,
    acceptedTransmissions: accepted.length,
    corrections: corrections.length,
    clarifications: clarification.length,
    sayAgainUses: events.filter((event) => event.type === "SAY_AGAIN_USED").length,
    transcriptReveals: events.filter((event) => event.type === "TRANSCRIPT_REVEALED").length,
    hintsUsed: events.filter((event) => event.type === "HINT_USED").length,
    missedInitiations: events.filter((event) => event.type === "MISSED_INITIATION").length,
    correctionFields: fieldCounts,
    accuracyPercent: attempts.length ? Math.round((accepted.length / attempts.length) * 100) : 0,
  };
}

export function buildDebrief(events: SessionEvent[], state: ScenarioState) {
  const metrics = deriveMetrics(events);
  const fields = metrics.correctionFields as Record<string, number>;
  const focus = fields.RUNWAY
    ? "Runway safety readbacks"
    : fields.ACTION && events.some((event) => String(event.payload.incorrectFields).includes("HOLD"))
      ? "Holding instructions"
      : fields.TAXIWAYS
        ? "Taxi-route readbacks"
        : fields.CALLSIGN
          ? "Consistent callsign use"
          : metrics.missedInitiations
            ? "Knowing when to initiate"
            : (metrics.hintsUsed || metrics.sayAgainUses || metrics.transcriptReveals)
              ? "Building unaided listening confidence"
              : "Maintaining concise, complete readbacks";

  const strengths = [
    metrics.acceptedTransmissions >= 6
      ? "Completed every required Ground and Tower exchange."
      : `Completed ${metrics.acceptedTransmissions} required radio exchanges.`,
    fields.RUNWAY ? "Kept working until the runway instruction was correct." : "Read back all runway-critical instructions correctly.",
    state === "COMPLETE" ? "Connected each accepted clearance to the correct aircraft action." : "Progressed safely through the scenario states.",
  ];
  const improvements = metrics.corrections
    ? [
        `Worked through ${metrics.corrections} practice retr${metrics.corrections === 1 ? "y" : "ies"}; pausing briefly before transmitting can make the full readback easier.`,
        metrics.sayAgainUses || metrics.transcriptReveals
          ? "Use assistance deliberately, then repeat the instruction once from memory."
          : "Keep a calm, steady pace when the instruction contains several elements.",
      ]
    : [
        "Every readback was complete; next time, build on that confidence at a comfortable pace.",
        "Continue using standard phrase order so the safety-critical fields are easy to hear.",
      ];

  return { metrics, strengths, improvements, nextPracticeFocus: focus };
}
