DO $$ BEGIN
 CREATE TYPE "public"."channel_type" AS ENUM('EMAIL', 'NTFY', 'TELEGRAM');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."contest_phase" AS ENUM('UPCOMING', 'ONGOING', 'FINISHED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."delivery_status" AS ENUM('PENDING', 'SENT', 'FAILED');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."platform_type" AS ENUM('LEETCODE', 'CODEFORCES', 'CODECHEF', 'ATCODER');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."reminder_type" AS ENUM('24H_BEFORE', '30M_BEFORE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "platform_type" NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"name" varchar(255) NOT NULL,
	"url" varchar(512) NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"phase" "contest_phase" DEFAULT 'UPCOMING' NOT NULL,
	"schedule_hash" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" "channel_type" NOT NULL,
	"destination" varchar(255) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "platform_type" NOT NULL,
	"remind_24h" boolean DEFAULT true NOT NULL,
	"remind_30m" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(120) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Asia/Kolkata' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contest_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_type" "channel_type" NOT NULL,
	"reminder_type" "reminder_type" NOT NULL,
	"destination" varchar(255) NOT NULL,
	"status" "delivery_status" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_channels" ADD CONSTRAINT "user_channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_contest_id_contests_id_fk" FOREIGN KEY ("contest_id") REFERENCES "public"."contests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_contests_platform_external_id" ON "contests" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_contests_start_time" ON "contests" USING btree ("start_time");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_channel_dest" ON "user_channels" USING btree ("user_id","channel_type","destination");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_channels_user_id" ON "user_channels" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_user_prefs_user_platform" ON "user_preferences" USING btree ("user_id","platform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_prefs_fanout_24h" ON "user_preferences" USING btree ("platform","remind_24h","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_prefs_fanout_30m" ON "user_preferences" USING btree ("platform","remind_30m","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_outbox_idempotency_key" ON "notification_outbox" USING btree ("contest_id","user_id","channel_type","reminder_type");