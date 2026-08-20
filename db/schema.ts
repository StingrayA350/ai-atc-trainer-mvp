import { bigserial, doublePrecision, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ScenarioState } from "@/lib/schemas";

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  scenarioVersion: text("scenario_version").notNull(),
  state: text("state").$type<ScenarioState>().notNull(),
  stateVersion: integer("state_version").notNull(),
  visibleRouteIds: jsonb("visible_route_ids").$type<string[]>().notNull().default([]),
  aircraftProgress: doublePrecision("aircraft_progress").notNull().default(0),
  controller: text("controller").$type<"GROUND" | "TOWER">().notNull(),
  frequency: text("frequency").notNull(),
  lastControllerText: text("last_controller_text"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  transcriptRevealCount: integer("transcript_reveal_count").notNull().default(0),
  hintCount: integer("hint_count").notNull().default(0),
  sayAgainCount: integer("say_again_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true, mode: "string" }),
}, (table) => [index("idx_sessions_updated_at").on(table.updatedAt)]);

export const sessionEvents = pgTable("session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
  type: text("type").notNull(),
  requestId: text("request_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull(),
}, (table) => [
  uniqueIndex("idx_session_events_request_id").on(table.requestId),
  index("idx_session_events_session_sequence").on(table.sessionId, table.sequence),
]);
