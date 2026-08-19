import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  scenarioVersion: text("scenario_version").notNull(),
  state: text("state").notNull(),
  stateVersion: integer("state_version").notNull(),
  visibleRoutesJson: text("visible_routes_json").notNull(),
  aircraftProgress: real("aircraft_progress").notNull().default(0),
  controller: text("controller").notNull(),
  frequency: text("frequency").notNull(),
  lastControllerText: text("last_controller_text"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  transcriptRevealCount: integer("transcript_reveal_count").notNull().default(0),
  hintCount: integer("hint_count").notNull().default(0),
  sayAgainCount: integer("say_again_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
}, (table) => [index("idx_sessions_updated_at").on(table.updatedAt)]);

export const sessionEvents = sqliteTable("session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  requestId: text("request_id"),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_session_events_session_sequence").on(table.sessionId, table.sequence),
  uniqueIndex("idx_session_events_request_id").on(table.requestId),
  index("idx_session_events_session_id").on(table.sessionId),
]);
