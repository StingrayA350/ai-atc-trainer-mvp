import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import type { ScenarioState } from "@/lib/schemas";
import { sessionEvents, sessions } from "./schema";

export type SessionRecord = {
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  state: ScenarioState;
  stateVersion: number;
  visibleRouteIds: string[];
  aircraftProgress: number;
  controller: "GROUND" | "TOWER";
  frequency: string;
  lastControllerText: string | null;
  consecutiveFailures: number;
  transcriptRevealCount: number;
  hintCount: number;
  sayAgainCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

let databaseClient: ReturnType<typeof drizzle<typeof import("./schema")>> | null = null;

function database() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is unavailable.");
  databaseClient ??= drizzle(databaseUrl, { schema: { sessions, sessionEvents } });
  return databaseClient;
}

function toSessionRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    ...row,
    visibleRouteIds: row.visibleRouteIds ?? [],
  };
}

export async function createSessionRecord(input: {
  id: string;
  scenarioId: string;
  scenarioVersion: string;
  state: ScenarioState;
  controller: "GROUND" | "TOWER";
  frequency: string;
}) {
  const now = new Date().toISOString();
  const [row] = await database().insert(sessions).values({
    ...input,
    stateVersion: 1,
    visibleRouteIds: [],
    aircraftProgress: 0,
    lastControllerText: null,
    consecutiveFailures: 0,
    transcriptRevealCount: 0,
    hintCount: 0,
    sayAgainCount: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }).returning();
  return row ? toSessionRecord(row) : null;
}

export async function getSessionRecord(id: string) {
  const [row] = await database().select().from(sessions).where(eq(sessions.id, id)).limit(1);
  return row ? toSessionRecord(row) : null;
}

export async function saveSessionRecord(session: SessionRecord, expectedVersion: number) {
  const [row] = await database().update(sessions).set({
    state: session.state,
    stateVersion: expectedVersion + 1,
    visibleRouteIds: session.visibleRouteIds,
    aircraftProgress: session.aircraftProgress,
    controller: session.controller,
    frequency: session.frequency,
    lastControllerText: session.lastControllerText,
    consecutiveFailures: session.consecutiveFailures,
    transcriptRevealCount: session.transcriptRevealCount,
    hintCount: session.hintCount,
    sayAgainCount: session.sayAgainCount,
    updatedAt: new Date().toISOString(),
    completedAt: session.completedAt,
  }).where(and(eq(sessions.id, session.id), eq(sessions.stateVersion, expectedVersion))).returning();
  return row ? toSessionRecord(row) : null;
}

export async function appendEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  requestId?: string,
) {
  await database().insert(sessionEvents).values({
    id: crypto.randomUUID(),
    sessionId,
    type,
    requestId: requestId ?? null,
    payload,
    createdAt: new Date().toISOString(),
  });
}

export async function findRequestResult(requestId: string) {
  const [row] = await database().select({ payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(eq(sessionEvents.requestId, requestId))
    .limit(1);
  return row?.payload.response ?? null;
}

export async function findLatestControllerAudio(sessionId: string, controllerText: string) {
  const rows = await database().select({ payload: sessionEvents.payload })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(desc(sessionEvents.sequence));

  for (const row of rows) {
    const payload = row.payload as {
      response?: { controllerReply?: { text?: unknown; audioDataUrl?: unknown } };
    };
    const reply = payload.response?.controllerReply;
    if (reply?.text === controllerText && typeof reply.audioDataUrl === "string" && reply.audioDataUrl) {
      return reply.audioDataUrl;
    }
  }

  return null;
}

export async function listSessionEvents(sessionId: string) {
  const rows = await database().select({
    type: sessionEvents.type,
    payload: sessionEvents.payload,
    createdAt: sessionEvents.createdAt,
  }).from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(sessionEvents.sequence);

  return rows.map((row) => ({
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt,
  }));
}
