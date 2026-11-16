CREATE TYPE "public"."whatsapp_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"direction" "whatsapp_direction" NOT NULL,
	"phone" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text,
	"wa_message_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "catalog_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "whatsapp_messages_window_idx" ON "whatsapp_messages" USING btree ("business_id","phone","direction","created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_messages_business_created_idx" ON "whatsapp_messages" USING btree ("business_id","direction","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "whatsapp_messages_wa_id_unique" ON "whatsapp_messages" USING btree ("business_id","wa_message_id") WHERE "whatsapp_messages"."wa_message_id" is not null;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_slug_unique" UNIQUE("slug");