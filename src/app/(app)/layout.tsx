import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { requireMember } from "@/server/auth/context";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requireMember();

  return (
    <AppShell user={context.user} role={context.role} businessName={context.business.name}>
      {children}
    </AppShell>
  );
}
