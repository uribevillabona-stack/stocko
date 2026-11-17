import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { RecoveryNotice } from "@/components/layout/recovery-notice";
import { env } from "@/lib/env";
import { requireMember } from "@/server/auth/context";
import { ownerRecoveryNotice } from "@/server/services/recovery-notice";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const context = await requireMember();
  // «Olvidé mi contraseña» solo existe en Stocko para Windows.
  const recoveries =
    env.STOCKO_DESKTOP === "1" && context.role === "owner"
      ? await ownerRecoveryNotice(context.business.id, context.user.id)
      : [];

  return (
    <AppShell user={context.user} role={context.role} businessName={context.business.name}>
      {recoveries.length > 0 ? <RecoveryNotice changes={recoveries} timeZone={context.business.timezone} /> : null}
      {children}
    </AppShell>
  );
}
