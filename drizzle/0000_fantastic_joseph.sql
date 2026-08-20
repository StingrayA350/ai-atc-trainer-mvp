CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"sequence" bigserial NOT NULL,
	"type" text NOT NULL,
	"request_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"scenario_version" text NOT NULL,
	"state" text NOT NULL,
	"state_version" integer NOT NULL,
	"visible_route_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aircraft_progress" double precision DEFAULT 0 NOT NULL,
	"controller" text NOT NULL,
	"frequency" text NOT NULL,
	"last_controller_text" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"transcript_reveal_count" integer DEFAULT 0 NOT NULL,
	"hint_count" integer DEFAULT 0 NOT NULL,
	"say_again_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_session_events_request_id" ON "session_events" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "idx_session_events_session_sequence" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_sessions_updated_at" ON "sessions" USING btree ("updated_at");