import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { businesses, memberships } from "@/lib/db/schema";
import type { MemberRole } from "@/lib/db/schema";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
};

export type BusinessSummary = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  whatsappNumber: string | null;
  allowOversell: boolean;
  reservationTtlHours: number;
};

export type AuthContext =
  | { status: "anonymous" }
  | { status: "no-business"; user: SessionUser }
  | { status: "member"; user: SessionUser; business: BusinessSummary; role: MemberRole };

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
});

export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const user = await getSessionUser();
  if (!user) return { status: "anonymous" };

  const [row] = await db
    .select({
      role: memberships.role,
      business: {
        id: businesses.id,
        name: businesses.name,
        currency: businesses.currency,
        timezone: businesses.timezone,
        whatsappNumber: businesses.whatsappNumber,
        allowOversell: businesses.allowOversell,
        reservationTtlHours: businesses.reservationTtlHours,
      },
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(eq(memberships.userId, user.id))
    .limit(1);

  if (!row) return { status: "no-business", user };

  return {
    status: "member",
    user,
    business: row.business,
    role: row.role,
  };
});

export async function requireMember() {
  const context = await getAuthContext();
  if (context.status === "anonymous") redirect("/login");
  if (context.status === "no-business") redirect("/onboarding");
  return context;
}

export async function requireOwner() {
  const context = await requireMember();
  if (context.role !== "owner") redirect("/");
  return context;
}
