import { env } from "cloudflare:workers";
import type { ScenarioState } from "@/lib/schemas";

type DbEnv = { DB?: D1Database };

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

type SessionRow = {
  id: string;
  scenario_id: string;
  scenario_version: string;
  state: ScenarioState;
  state_version: number;
  visible_routes_json: string;
  aircraft_progress: number;
  controller: "GROUND" | "TOWER";
  frequency: string;
  last_controller_text: string | null;
  consecutive_failures: number;
  transcript_reveal_count: number;
  hint_count: number;
  say_again_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

function database() {
  const db = (env as unknown as DbEnv).DB;
  if (!db) throw new Error("Cloudflare D1 binding `DB` is unavailable.");
  return db;
}

let initialized = false;

export async function ensureDatabase() {
  if (initialized) return;
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      scenario_version TEXT NOT NULL,
      state TEXT NOT NULL,
      state_version INTEGER NOT NULL,
      visible_routes_json TEXT NOT NULL,
      aircraft_progress REAL NOT NULL DEFAULT 0,
      controller TEXT NOT NULL,
      frequency TEXT NOT NULL,
      last_controller_text TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      transcript_reveal_count INTEGER NOT NULL DEFAULT 0,
      hint_count INTEGER NOT NULL DEFAULT 0,
      say_again_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      request_id TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_session_sequence ON session_events(session_id, sequence)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_session_events_request_id ON session_events(request_id) WHERE request_id IS NOT NULL"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_session_events_session_id ON session_events(session_id)"),
  ]);
  await db.prepare("PRAGMA optimize").run();
  initialized = true;
}

function fromRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    scenarioVersion: row.scenario_version,
    state: row.state,
    stateVersion: row.state_version,
    visibleRouteIds: JSON.parse(row.visible_routes_json),
    aircraftProgress: row.aircraft_progress,
    controller: row.controller,
    frequency: row.frequency,
    lastControllerText: row.last_controller_text,
    consecutiveFailures: row.consecutive_failures,
    transcriptRevealCount: row.transcript_reveal_count,
    hintCount: row.hint_count,
    sayAgainCount: row.say_again_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
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
  await ensureDatabase();
  const now = new Date().toISOString();
  await database().prepare(`INSERT INTO sessions (
    id, scenario_id, scenario_version, state, state_version, visible_routes_json,
    aircraft_progress, controller, frequency, consecutive_failures,
    transcript_reveal_count, hint_count, say_again_count, created_at, updated_at
  ) VALUES (?, ?, ?, ?, 1, '[]', 0, ?, ?, 0, 0, 0, 0, ?, ?)`)
    .bind(input.id, input.scenarioId, input.scenarioVersion, input.state, input.controller, input.frequency, now, now)
    .run();
  return getSessionRecord(input.id);
}

export async function getSessionRecord(id: string) {
  await ensureDatabase();
  const row = await database().prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  return row ? fromRow(row) : null;
}

export async function saveSessionRecord(session: SessionRecord, expectedVersion: number) {
  const nextVersion = expectedVersion + 1;
  const result = await database().prepare(`UPDATE sessions SET
    state = ?, state_version = ?, visible_routes_json = ?, aircraft_progress = ?,
    controller = ?, frequency = ?, last_controller_text = ?, consecutive_failures = ?,
    transcript_reveal_count = ?, hint_count = ?, say_again_count = ?, updated_at = ?, completed_at = ?
    WHERE id = ? AND state_version = ?`)
    .bind(
      session.state,
      nextVersion,
      JSON.stringify(session.visibleRouteIds),
      session.aircraftProgress,
      session.controller,
      session.frequency,
      session.lastControllerText,
      session.consecutiveFailures,
      session.transcriptRevealCount,
      session.hintCount,
      session.sayAgainCount,
      new Date().toISOString(),
      session.completedAt,
      session.id,
      expectedVersion,
    ).run();
  if (!result.success || result.meta.changes !== 1) return null;
  return getSessionRecord(session.id);
}

export async function appendEvent(
  sessionId: string,
  type: string,
  payload: Record<string, unknown>,
  requestId?: string,
) {
  await ensureDatabase();
  const row = await database().prepare(
    "SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM session_events WHERE session_id = ?",
  ).bind(sessionId).first<{ sequence: number }>();
  const sequence = row?.sequence ?? 1;
  await database().prepare(`INSERT INTO session_events
    (id, session_id, sequence, type, request_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), sessionId, sequence, type, requestId ?? null, JSON.stringify(payload), new Date().toISOString())
    .run();
}

export async function findRequestResult(requestId: string) {
  await ensureDatabase();
  const row = await database().prepare(
    "SELECT payload_json FROM session_events WHERE request_id = ? LIMIT 1",
  ).bind(requestId).first<{ payload_json: string }>();
  if (!row) return null;
  const payload = JSON.parse(row.payload_json) as { response?: unknown };
  return payload.response ?? null;
}

export async function findLatestControllerAudio(sessionId: string, controllerText: string) {
  await ensureDatabase();
  const result = await database().prepare(
    `SELECT payload_json FROM session_events
     WHERE session_id = ?
     ORDER BY sequence DESC`,
  ).bind(sessionId).all<{ payload_json: string }>();

  for (const row of result.results) {
    try {
      const payload = JSON.parse(row.payload_json) as {
        response?: { controllerReply?: { text?: unknown; audioDataUrl?: unknown } };
      };
      const reply = payload.response?.controllerReply;
      if (reply?.text === controllerText && typeof reply.audioDataUrl === "string" && reply.audioDataUrl) {
        return reply.audioDataUrl;
      }
    } catch {
      // Ignore malformed historical events and keep looking for the last playable reply.
    }
  }

  return null;
}

export async function listSessionEvents(sessionId: string) {
  await ensureDatabase();
  const result = await database().prepare(
    "SELECT type, payload_json, created_at FROM session_events WHERE session_id = ? ORDER BY sequence ASC",
  ).bind(sessionId).all<{ type: string; payload_json: string; created_at: string }>();
  return result.results.map((row) => ({
    type: row.type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}
