import {
  appendEvent,
  createSessionRecord,
  findLatestControllerAudio,
  findRequestResult,
  getSessionRecord,
  listSessionEvents,
  saveSessionRecord,
  type SessionRecord,
} from "@/db";
import { buildDebrief } from "./debrief";
import { interpretTranscript, providerStatus, synthesizeControllerSpeech, transcribeAudio } from "./providers";
import { speakIdentifier } from "./phraseology";
import { getStepForState, nextStepIndex, publicScenarioData, scenario } from "./scenario";
import type { ScenarioState } from "./schemas";
import { correctionFor, parseTransmission, validateTransmission } from "./transmission";

function stateCopy(state: ScenarioState): { title: string; detail: string; tag: string } {
  const holdingPoint = scenario.steps.find((step) => step.instruction.instructionType === "TAXI")?.instruction.holdingPoint ?? "the holding point";
  const runway = scenario.airport.runway;
  const spokenHoldingPoint = holdingPoint === "the holding point" ? holdingPoint : speakIdentifier(holdingPoint);
  const spokenRunway = speakIdentifier(runway).toLowerCase();
  const copy: Record<ScenarioState, { title: string; detail: string; tag: string }> = {
  PARKED: { title: "Aircraft parked", detail: "Preparing the exercise.", tag: "SYSTEM" },
  READY_FOR_GROUND: { title: "Contact Ground when you’re ready to taxi.", detail: "Take your time. Include your call sign, stand, aircraft type, runway, and request.", tag: "YOUR TURN" },
  GROUND_INSTRUCTION: { title: "Listen for your taxi clearance.", detail: "Build the route in your head before reading it back.", tag: "LISTEN" },
  TAXI_READBACK_PENDING: { title: "Read back the taxi clearance when you’re ready.", detail: "Take a moment to include the route, holding point, runway, and hold-short instruction.", tag: "YOUR TURN" },
  TAXIING: { title: "Taxi route accepted.", detail: `Follow the charted route to holding point ${spokenHoldingPoint}.`, tag: "MOVING" },
  HOLDING_POINT: { title: "Read back the Tower frequency when you’re ready.", detail: `Remain holding short of runway ${spokenRunway}, then change frequency.`, tag: "YOUR TURN" },
  TOWER_TRANSITION: { title: "Read back the Tower frequency.", detail: "Then change to Seletar Tower.", tag: "YOUR TURN" },
  TOWER_CONTACT: { title: "Contact Tower when you’re ready for departure.", detail: "Take your time and report your holding point and assigned runway.", tag: "YOUR TURN" },
  RUNWAY_HOLD_OR_LINE_UP: { title: "Read back line up and wait when you’re ready.", detail: "Please include the runway so the safety-critical readback is complete.", tag: "YOUR TURN" },
  TAKEOFF_READBACK_PENDING: { title: "Read back the takeoff clearance when you’re ready.", detail: "Please include your call sign and runway.", tag: "YOUR TURN" },
  TAKEOFF_ROLL: { title: "Takeoff clearance accepted.", detail: `The aircraft is accelerating on runway ${spokenRunway}.`, tag: "TAKEOFF" },
  AIRBORNE: { title: "Airborne.", detail: "The exercise is ending.", tag: "COMPLETE" },
  COMPLETE: { title: "Exercise complete.", detail: "Review the transcript and your coaching debrief.", tag: "DEBRIEF" },
  };
  return copy[state];
}

function routeForMovement(session: SessionRecord) {
  if (session.aircraftProgress >= 1) return null;
  return session.visibleRouteIds.find((id) => scenario.routes[id]?.movementState === session.state) ?? null;
}

export function serializeSession(session: SessionRecord) {
  const step = getStepForState(session.state);
  const progressIndex = Math.min(nextStepIndex(session.state), scenario.steps.length - 1);
  return {
    id: session.id,
    state: session.state,
    stateVersion: session.stateVersion,
    controller: session.controller,
    frequency: session.frequency,
    lastControllerText: session.lastControllerText,
    visibleRouteIds: session.visibleRouteIds,
    aircraftProgress: session.aircraftProgress,
    movementRouteId: routeForMovement(session),
    consecutiveFailures: session.consecutiveFailures,
    hintAvailable: session.consecutiveFailures >= 3,
    assistance: {
      sayAgain: session.sayAgainCount,
      transcriptReveals: session.transcriptRevealCount,
      hints: session.hintCount,
    },
    currentStep: step ? {
      id: step.id,
      instructionType: step.instruction.instructionType,
      initiator: step.initiator,
      requiredFields: step.instruction.requiredFields,
      suggestedPhrase: step.instruction.approvedSpokenText,
    } : null,
    progress: {
      current: session.state === "COMPLETE" ? 6 : Math.min(6, Math.floor((progressIndex / scenario.steps.length) * 6) + 1),
      total: 6,
    },
    copy: stateCopy(session.state),
    scenario: publicScenarioData(session.visibleRouteIds),
    provider: providerStatus(),
    completed: session.state === "COMPLETE",
  };
}

export async function createSession() {
  const id = crypto.randomUUID();
  const session = await createSessionRecord({
    id,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    state: "READY_FOR_GROUND",
    controller: "GROUND",
    frequency: scenario.airport.groundFrequency,
  });
  if (!session) throw new Error("SESSION_CREATION_FAILED");
  await appendEvent(id, "SESSION_CREATED", {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    airportDataVersion: scenario.airportDataVersion,
    transition: { from: "PARKED", to: "READY_FOR_GROUND" },
  });
  return serializeSession(session);
}

export async function restoreSession(id: string) {
  const session = await getSessionRecord(id);
  if (!session || session.scenarioId !== scenario.id || session.scenarioVersion !== scenario.version) return null;
  return serializeSession(session);
}

export async function processTransmission(input: {
  sessionId: string;
  requestId: string;
  stateVersion: number;
  transcript?: string;
  confidence?: number;
  audio?: File;
}) {
  const duplicate = await findRequestResult(input.requestId);
  if (duplicate) return duplicate;
  const session = await getSessionRecord(input.sessionId);
  if (!session) throw new ServiceError(404, "SESSION_NOT_FOUND");
  if (session.stateVersion !== input.stateVersion) throw new ServiceError(409, "STALE_STATE", serializeSession(session));
  const step = getStepForState(session.state);
  if (!step) throw new ServiceError(409, "TRANSMISSION_NOT_EXPECTED", serializeSession(session));

  let transcript = input.transcript?.trim();
  if (!transcript && input.audio && input.audio.size) {
    try {
      transcript = await transcribeAudio(input.audio);
    } catch (error) {
      await appendEvent(session.id, "TRANSCRIPTION_FAILED", { reason: String(error) }, input.requestId);
      throw new ServiceError(503, "TRANSCRIPTION_UNAVAILABLE", serializeSession(session));
    }
  }
  if (!transcript) throw new ServiceError(400, "TRANSCRIPT_OR_AUDIO_REQUIRED");

  const quickParse = parseTransmission(transcript, input.confidence ?? 0.99);
  if (quickParse.requestsSayAgain) {
    return repeatControllerMessage({ sessionId: session.id, requestId: input.requestId, stateVersion: input.stateVersion });
  }

  const parsed = await interpretTranscript(transcript, step, input.confidence ?? 0.99);
  const validation = validateTransmission(step.instruction, parsed, step.successTransition);
  const controllerText = validation.status === "ACCEPTED"
    ? step.successControllerText
    : correctionFor(validation, scenario.aircraft.spokenCallsign);
  const next: SessionRecord = { ...session, lastControllerText: controllerText };

  if (validation.status === "ACCEPTED") {
    next.state = step.successTransition;
    next.consecutiveFailures = 0;
    next.aircraftProgress = 0;
    if (step.routeToReveal && !next.visibleRouteIds.includes(step.routeToReveal)) {
      next.visibleRouteIds = [...next.visibleRouteIds, step.routeToReveal];
    }
    if (step.successController) next.controller = step.successController;
    if (step.successFrequency) next.frequency = step.successFrequency;
  } else if (validation.status === "CORRECTION_REQUIRED") {
    next.consecutiveFailures += 1;
  }

  const saved = await saveSessionRecord(next, session.stateVersion);
  if (!saved) throw new ServiceError(409, "STALE_STATE", await restoreSession(session.id));
  const audioDataUrl = await synthesizeControllerSpeech(controllerText);
  const response = {
    session: serializeSession(saved),
    transcript,
    parsed,
    validation,
    controllerReply: { text: controllerText, audioDataUrl, playbackRate: 1 },
  };
  await appendEvent(session.id, "TRANSMISSION_EVALUATED", {
    transcript,
    parsed,
    status: validation.status,
    stepId: step.id,
    incorrectFields: validation.fieldResults.filter((field) => !field.correct).map((field) => field.field),
    stateFrom: session.state,
    stateTo: saved.state,
    response,
  }, input.requestId);
  if (validation.status === "ACCEPTED") {
    await appendEvent(session.id, "STATE_TRANSITION", { from: session.state, to: saved.state, stepId: step.id });
  }
  return response;
}

export async function repeatControllerMessage(input: { sessionId: string; requestId: string; stateVersion: number }) {
  const duplicate = await findRequestResult(input.requestId);
  if (duplicate) return duplicate;
  const session = await requireCurrentSession(input.sessionId, input.stateVersion);
  if (!session.lastControllerText) throw new ServiceError(409, "NOTHING_TO_REPEAT", serializeSession(session));
  const next = { ...session, sayAgainCount: session.sayAgainCount + 1 };
  const saved = await saveSessionRecord(next, session.stateVersion);
  if (!saved) throw new ServiceError(409, "STALE_STATE", await restoreSession(session.id));
  const audioDataUrl = await findLatestControllerAudio(session.id, session.lastControllerText);
  const response = {
    session: serializeSession(saved),
    controllerReply: { text: session.lastControllerText, audioDataUrl, playbackRate: 0.8 },
  };
  await appendEvent(session.id, "SAY_AGAIN_USED", { response }, input.requestId);
  return response;
}

export async function revealTranscript(input: { sessionId: string; requestId: string; stateVersion: number }) {
  const duplicate = await findRequestResult(input.requestId);
  if (duplicate) return duplicate;
  const session = await requireCurrentSession(input.sessionId, input.stateVersion);
  if (!session.lastControllerText) throw new ServiceError(409, "NO_TRANSCRIPT_AVAILABLE", serializeSession(session));
  const next = { ...session, transcriptRevealCount: session.transcriptRevealCount + 1 };
  const saved = await saveSessionRecord(next, session.stateVersion);
  if (!saved) throw new ServiceError(409, "STALE_STATE", await restoreSession(session.id));
  const response = { session: serializeSession(saved), transcript: session.lastControllerText };
  await appendEvent(session.id, "TRANSCRIPT_REVEALED", { stepId: getStepForState(session.state)?.id, response }, input.requestId);
  return response;
}

export async function recordHintUse(input: { sessionId: string; requestId: string; stateVersion: number }) {
  const duplicate = await findRequestResult(input.requestId);
  if (duplicate) return duplicate;
  const session = await requireCurrentSession(input.sessionId, input.stateVersion);
  const step = getStepForState(session.state);
  if (!step) throw new ServiceError(409, "NO_HINT_AVAILABLE", serializeSession(session));
  const next = { ...session, hintCount: session.hintCount + 1 };
  const saved = await saveSessionRecord(next, session.stateVersion);
  if (!saved) throw new ServiceError(409, "STALE_STATE", await restoreSession(session.id));
  const missedInitiation = step.initiator === "STUDENT" && Date.now() - Date.parse(session.updatedAt) >= 15_000;
  const response = {
    session: serializeSession(saved),
    hint: step.hint,
    suggestedPhrase: step.instruction.approvedSpokenText,
  };
  await appendEvent(session.id, "HINT_USED", { stepId: step.id, response }, input.requestId);
  if (missedInitiation) await appendEvent(session.id, "MISSED_INITIATION", { stepId: step.id });
  return response;
}

export async function completeMovement(input: { sessionId: string; requestId: string; stateVersion: number }) {
  const duplicate = await findRequestResult(input.requestId);
  if (duplicate) return duplicate;
  const session = await requireCurrentSession(input.sessionId, input.stateVersion);
  const routeId = routeForMovement(session);
  const route = routeId ? scenario.routes[routeId] : null;
  if (!route) throw new ServiceError(409, "MOVEMENT_NOT_EXPECTED", serializeSession(session));
  const next = {
    ...session,
    aircraftProgress: 1,
    state: route.completionState,
    lastControllerText: route.completionControllerText,
  };
  if (next.state === "COMPLETE") next.completedAt = new Date().toISOString();
  const saved = await saveSessionRecord(next, session.stateVersion);
  if (!saved) throw new ServiceError(409, "STALE_STATE", await restoreSession(session.id));
  const audioDataUrl = next.lastControllerText ? await synthesizeControllerSpeech(next.lastControllerText) : null;
  const response = {
    session: serializeSession(saved),
    controllerReply: next.lastControllerText ? { text: next.lastControllerText, audioDataUrl, playbackRate: 1 } : null,
  };
  await appendEvent(session.id, "MOVEMENT_COMPLETED", { from: session.state, to: saved.state, response }, input.requestId);
  await appendEvent(session.id, "STATE_TRANSITION", { from: session.state, to: saved.state });
  if (saved.state === "COMPLETE") await appendEvent(session.id, "SESSION_COMPLETED", { scenarioVersion: scenario.version });
  return response;
}

export async function getDebrief(sessionId: string) {
  const session = await getSessionRecord(sessionId);
  if (!session) throw new ServiceError(404, "SESSION_NOT_FOUND");
  if (session.state !== "COMPLETE") throw new ServiceError(409, "SESSION_NOT_COMPLETE", serializeSession(session));
  const events = await listSessionEvents(sessionId);
  const transcript = events
    .filter((event) => event.type === "TRANSMISSION_EVALUATED")
    .map((event) => ({
      speaker: "STUDENT",
      text: String(event.payload.transcript ?? ""),
      status: String(event.payload.status ?? ""),
      at: event.createdAt,
    }));
  return { session: serializeSession(session), ...buildDebrief(events, session.state), transcript };
}

export async function getDiagnostic(sessionId: string) {
  const session = await getSessionRecord(sessionId);
  if (!session) throw new ServiceError(404, "SESSION_NOT_FOUND");
  const events = await listSessionEvents(sessionId);
  return {
    exportedAt: new Date().toISOString(),
    scenario: {
      id: scenario.id,
      version: scenario.version,
      airportDataVersion: scenario.airportDataVersion,
      validationStatus: scenario.metadata.validationStatus,
    },
    session: serializeSession(session),
    events,
  };
}

async function requireCurrentSession(id: string, stateVersion: number) {
  const session = await getSessionRecord(id);
  if (!session) throw new ServiceError(404, "SESSION_NOT_FOUND");
  if (session.stateVersion !== stateVersion) throw new ServiceError(409, "STALE_STATE", serializeSession(session));
  return session;
}

export class ServiceError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
