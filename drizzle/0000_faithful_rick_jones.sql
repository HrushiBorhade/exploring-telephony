CREATE TABLE "capture_transcripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "capture_transcripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"capture_id" varchar(12) NOT NULL,
	"speaker" varchar(10) NOT NULL,
	"text" text NOT NULL,
	"is_final" boolean DEFAULT true NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" varchar(12) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone_a" varchar(20) NOT NULL,
	"phone_b" varchar(20) NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"conference_name" varchar(50) NOT NULL,
	"call_sid_a" varchar(40),
	"call_sid_b" varchar(40),
	"conference_sid" varchar(40),
	"recording_url" text,
	"recording_sid" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_scripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_scripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(12) NOT NULL,
	"step_number" integer NOT NULL,
	"prompt" text NOT NULL,
	"expected_keywords" jsonb
);
--> statement-breakpoint
CREATE TABLE "test_sessions" (
	"id" varchar(12) PRIMARY KEY NOT NULL,
	"scenario_name" text NOT NULL,
	"persona" text DEFAULT '' NOT NULL,
	"agent_phone" varchar(20) NOT NULL,
	"tester_phone" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'created' NOT NULL,
	"conference_name" varchar(50) NOT NULL,
	"tester_call_sid" varchar(40),
	"agent_call_sid" varchar(40),
	"conference_sid" varchar(40),
	"current_script_step" integer DEFAULT 0 NOT NULL,
	"recording_url" text,
	"recording_sid" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "test_transcripts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "test_transcripts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"session_id" varchar(12) NOT NULL,
	"speaker" varchar(10) NOT NULL,
	"text" text NOT NULL,
	"is_final" boolean DEFAULT true NOT NULL,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capture_transcripts" ADD CONSTRAINT "capture_transcripts_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scripts" ADD CONSTRAINT "test_scripts_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_transcripts" ADD CONSTRAINT "test_transcripts_session_id_test_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."test_sessions"("id") ON DELETE cascade ON UPDATE no action;