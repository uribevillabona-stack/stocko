import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const memberRole = pgEnum("member_role", ["owner", "employee"]);

export const movementType = pgEnum("movement_type", ["entry", "exit", "adjustment", "reserve", "release"]);

export const productStatus = pgEnum("product_status", ["active", "inactive"]);

export const reservationStatus = pgEnum("reservation_status", [
  "active",
  "released",
  "expired",
  "fulfilled",
]);

export const whatsappDirection = pgEnum("whatsapp_direction", ["inbound", "outbound"]);

export const saleStatus = pgEnum("sale_status", ["completed", "cancelled"]);

export const paymentMethod = pgEnum("payment_method", ["cash", "transfer", "card", "other"]);

/* -------------------------------------------------------------------------- */
/* Negocio                                                                     */
/* -------------------------------------------------------------------------- */

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  currency: char("currency", { length: 3 }).notNull().default("COP"),
  timezone: text("timezone").notNull().default("America/Bogota"),
  whatsappNumber: text("whatsapp_number"),
  allowOversell: boolean("allow_oversell").notNull().default(false),
  reservationTtlHours: integer("reservation_ttl_hours").notNull().default(24),
  /** Dirección pública del catálogo: /catalogo/<slug>. */
  slug: text("slug").unique(),
  catalogEnabled: boolean("catalog_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Better Auth                                                                 */
/* Los nombres de tabla los exige el adaptador de Better Auth.                 */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Límite de intentos. Mismo formato que exige Better Auth (storage "database")
 * y que usa src/lib/rate-limit.ts para las server actions.
 */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Pertenencia y equipo                                                        */
/* -------------------------------------------------------------------------- */

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("employee"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_user_unique").on(table.userId),
    index("memberships_business_idx").on(table.businessId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: memberRole("role").notNull().default("employee"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_business_idx").on(table.businessId),
    uniqueIndex("invitations_pending_unique")
      .on(table.businessId, table.email)
      .where(sql`${table.acceptedAt} is null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* WhatsApp                                                                    */
/* -------------------------------------------------------------------------- */

export const whatsappConfig = pgTable("whatsapp_config", {
  businessId: uuid("business_id")
    .primaryKey()
    .references(() => businesses.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("basic"),
  phoneNumberId: text("phone_number_id"),
  wabaId: text("waba_id"),
  catalogId: text("catalog_id"),
  accessTokenEnc: text("access_token_enc"),
  appSecretEnc: text("app_secret_enc"),
  verifyToken: text("verify_token"),
  messagesEnabled: boolean("messages_enabled").notNull().default(false),
  messageCap: integer("message_cap").notNull().default(900),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registro de mensajes de la Cloud API. Los entrantes solo guardan teléfono y
 * hora (abren la ventana de 24 h); el texto de los salientes se guarda para
 * soporte. Nunca se guardan tokens.
 */
export const whatsappMessages = pgTable(
  "whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    direction: whatsappDirection("direction").notNull(),
    /** Teléfono en E.164. */
    phone: text("phone").notNull(),
    kind: text("kind").notNull().default("text"),
    body: text("body"),
    waMessageId: text("wa_message_id"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("whatsapp_messages_window_idx").on(table.businessId, table.phone, table.direction, table.createdAt),
    index("whatsapp_messages_business_created_idx").on(table.businessId, table.direction, table.createdAt),
    uniqueIndex("whatsapp_messages_wa_id_unique")
      .on(table.businessId, table.waMessageId)
      .where(sql`${table.waMessageId} is not null`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Productos y variantes (Fase 2)                                             */
/* -------------------------------------------------------------------------- */

export const productCategories = pgTable(
  "product_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_categories_name_unique").on(table.businessId, sql`lower(${table.name})`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => productCategories.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    unit: text("unit").notNull().default("und"),
    /** Clave de la foto en el almacenamiento (S3 de Neon o carpeta local en desarrollo). */
    photoKey: text("photo_key"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("products_business_idx").on(table.businessId)],
);

/**
 * `qty_milli` es el stock físico y `reserved_milli` la suma de reservas activas.
 * Disponible = físico − reservado. Ambos solo cambian por movimientos, dentro de
 * una transacción con la fila bloqueada (SELECT ... FOR UPDATE).
 */
export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name"),
    qty_milli: integer("qty_milli").notNull().default(0),
    reservedMilli: integer("reserved_milli").notNull().default(0),
    minStockMilli: integer("min_stock_milli").notNull().default(0),
    priceCents: bigint("price_cents", { mode: "number" }).notNull().default(0),
    costCents: bigint("cost_cents", { mode: "number" }),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_variants_sku_unique").on(table.businessId, sql`lower(${table.sku})`),
    index("product_variants_product_idx").on(table.productId),
    check("product_variants_reserved_nonnegative", sql`${table.reservedMilli} >= 0`),
    check("product_variants_min_stock_nonnegative", sql`${table.minStockMilli} >= 0`),
    check("product_variants_price_nonnegative", sql`${table.priceCents} >= 0`),
  ],
);

export const stockReservations = pgTable(
  "stock_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    qty_milli: integer("qty_milli").notNull(),
    /** Referencia libre: para quién o para qué pedido es la reserva. */
    reservationId: text("reservation_id").notNull(),
    status: reservationStatus("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("stock_reservations_business_status_idx").on(table.businessId, table.status),
    index("stock_reservations_variant_status_idx").on(table.variantId, table.status),
    check("stock_reservations_qty_positive", sql`${table.qty_milli} > 0`),
  ],
);

/**
 * `qty_milli` es el cambio con signo sobre el saldo que toca el movimiento:
 * entry/exit/adjustment cambian el físico; reserve/release cambian lo reservado.
 * `balance_after_milli` guarda el físico resultante para el historial.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    reservationRef: uuid("reservation_ref").references(() => stockReservations.id),
    type: movementType("type").notNull(),
    qty_milli: integer("qty_milli").notNull(),
    balanceAfterMilli: integer("balance_after_milli"),
    reason: text("reason"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("inventory_movements_business_created_idx").on(table.businessId, table.createdAt),
    index("inventory_movements_variant_created_idx").on(table.variantId, table.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Clientes, ventas y pagos (Fase 3)                                           */
/* -------------------------------------------------------------------------- */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Teléfono en E.164 (+573001234567). */
    phone: text("phone"),
    email: text("email"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("customers_business_idx").on(table.businessId),
    uniqueIndex("customers_phone_unique")
      .on(table.businessId, table.phone)
      .where(sql`${table.phone} is not null`),
  ],
);

/**
 * Una venta descuenta stock al crearse. `paid_cents` es la suma de pagos no
 * anulados; el saldo por cobrar (fiado) es `total_cents − paid_cents`.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    customerId: uuid("customer_id").references(() => customers.id),
    status: saleStatus("status").notNull().default("completed"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    paidCents: bigint("paid_cents", { mode: "number" }).notNull().default(0),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: text("cancelled_by"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    uniqueIndex("sales_number_unique").on(table.businessId, table.number),
    index("sales_business_created_idx").on(table.businessId, table.createdAt),
    index("sales_customer_idx").on(table.customerId),
    check("sales_amounts_valid", sql`${table.discountCents} >= 0 AND ${table.totalCents} >= 0 AND ${table.paidCents} >= 0 AND ${table.paidCents} <= ${table.totalCents}`),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    /** Orden de la línea dentro de la venta. */
    position: integer("position").notNull().default(0),
    productId: uuid("product_id").references(() => products.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    /** Copia del nombre al momento de vender. */
    description: text("description").notNull(),
    qtyMilli: integer("qty_milli").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    /** Costo al momento de vender, para márgenes. Nulo si no se conocía. */
    unitCostCents: bigint("unit_cost_cents", { mode: "number" }),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  },
  (table) => [
    index("sale_items_sale_idx").on(table.saleId),
    index("sale_items_business_idx").on(table.businessId),
    check("sale_items_qty_positive", sql`${table.qtyMilli} > 0`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    method: paymentMethod("method").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (table) => [
    index("payments_business_created_idx").on(table.businessId, table.createdAt),
    index("payments_sale_idx").on(table.saleId),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

/* -------------------------------------------------------------------------- */
/* Auditoría (Fase 7)                                                          */
/* -------------------------------------------------------------------------- */

/** Acciones sensibles: quién hizo qué y cuándo. Nunca guarda secretos. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_business_created_idx").on(table.businessId, table.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                  */
/* -------------------------------------------------------------------------- */

export const businessesRelations = relations(businesses, ({ many, one }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
  whatsappConfig: one(whatsappConfig, {
    fields: [businesses.id],
    references: [whatsappConfig.businessId],
  }),
}));

export const userRelations = relations(user, ({ one }) => ({
  membership: one(memberships, {
    fields: [user.id],
    references: [memberships.userId],
  }),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  business: one(businesses, {
    fields: [memberships.businessId],
    references: [businesses.id],
  }),
  user: one(user, {
    fields: [memberships.userId],
    references: [user.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  business: one(businesses, {
    fields: [invitations.businessId],
    references: [businesses.id],
  }),
}));

export const productCategoriesRelations = relations(productCategories, ({ one, many }) => ({
  business: one(businesses, {
    fields: [productCategories.businessId],
    references: [businesses.id],
  }),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  business: one(businesses, {
    fields: [products.businessId],
    references: [businesses.id],
  }),
  category: one(productCategories, {
    fields: [products.categoryId],
    references: [productCategories.id],
  }),
  variants: many(productVariants),
  movements: many(inventoryMovements),
}));

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, {
    fields: [productVariants.productId],
    references: [products.id],
  }),
  reservations: many(stockReservations),
  movements: many(inventoryMovements),
}));

export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  business: one(businesses, {
    fields: [inventoryMovements.businessId],
    references: [businesses.id],
  }),
  product: one(products, {
    fields: [inventoryMovements.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [inventoryMovements.variantId],
    references: [productVariants.id],
  }),
}));

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  business: one(businesses, {
    fields: [stockReservations.businessId],
    references: [businesses.id],
  }),
  product: one(products, {
    fields: [stockReservations.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [stockReservations.variantId],
    references: [productVariants.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Tipos                                                                       */
/* -------------------------------------------------------------------------- */

export type Business = typeof businesses.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type MemberRole = (typeof memberRole.enumValues)[number];
export type ProductCategory = typeof productCategories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type StockReservation = typeof stockReservations.$inferSelect;
export type MovementType = (typeof movementType.enumValues)[number];
export type ReservationStatus = (typeof reservationStatus.enumValues)[number];
export type Customer = typeof customers.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type SaleItem = typeof saleItems.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type PaymentMethod = (typeof paymentMethod.enumValues)[number];
export type SaleStatus = (typeof saleStatus.enumValues)[number];
export type WhatsappConfig = typeof whatsappConfig.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
