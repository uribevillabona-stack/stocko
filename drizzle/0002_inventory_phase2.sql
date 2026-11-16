ALTER TYPE "public"."reservation_status" ADD VALUE 'fulfilled';--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_product_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "reservation_ref" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN "balance_after_milli" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "business_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "reserved_milli" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "min_stock_milli" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "price_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_cents" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit" text DEFAULT 'und' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_reservation_ref_stock_reservations_id_fk" FOREIGN KEY ("reservation_ref") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_product_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_movements_business_created_idx" ON "inventory_movements" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_variant_created_idx" ON "inventory_movements" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_categories_name_unique" ON "product_categories" USING btree ("business_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku_unique" ON "product_variants" USING btree ("business_id",lower("sku"));--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "products_business_idx" ON "products" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_business_status_idx" ON "stock_reservations" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "stock_reservations_variant_status_idx" ON "stock_reservations" USING btree ("variant_id","status");--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_reserved_nonnegative" CHECK ("product_variants"."reserved_milli" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_min_stock_nonnegative" CHECK ("product_variants"."min_stock_milli" >= 0);--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_nonnegative" CHECK ("product_variants"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_qty_positive" CHECK ("stock_reservations"."qty_milli" > 0);