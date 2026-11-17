import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecoveryForm } from "@/components/forms/recovery-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { verifyRecoveryToken } from "@/lib/desktop-recovery";
import { env } from "@/lib/env";
import { isRecoveryTokenUsed, listRecoverableAccounts } from "@/server/services/recovery";

export const metadata: Metadata = { title: "Recuperar contraseña" };

const ROLES: Record<string, string> = { owner: "dueño", employee: "trabajador" };

/** Solo en Stocko para Windows: la abre Stocko con un enlace de un solo uso. */
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (env.STOCKO_DESKTOP !== "1") notFound();

  const { token } = await searchParams;
  const value = typeof token === "string" ? token : undefined;
  const verified = verifyRecoveryToken(value, env.STOCKO_RECOVERY_KEY);
  const valid = verified !== null && !(await isRecoveryTokenUsed(verified));
  const accounts = valid ? await listRecoverableAccounts() : [];

  return (
    <AuthShell
      title="Recupera tu contraseña"
      description="Elige la cuenta y escribe una contraseña nueva. Se cierran las sesiones abiertas de esa cuenta."
      footer={
        <Link href="/login" className="font-medium text-brand hover:underline">
          Volver a entrar
        </Link>
      }
    >
      {!valid || !value ? (
        <Alert>
          Este enlace ya no sirve: vence a los 15 minutos y se usa una sola vez. Vuelve a «¿Olvidaste tu
          contraseña?» en la pantalla de entrar.
        </Alert>
      ) : accounts.length === 0 ? (
        <Alert>Todavía no hay cuentas en este PC. Crea una desde «Crea una».</Alert>
      ) : (
        <>
          <RecoveryForm
            token={value}
            accounts={accounts.map((account) => ({
              id: account.id,
              label: `${account.name} · ${account.email}${account.role ? ` (${ROLES[account.role] ?? account.role}${account.business ? `, ${account.business}` : ""})` : ""}`,
            }))}
          />
          <p className="mt-4 text-xs leading-5 text-muted">
            Cualquiera que use este PC puede hacer esto, y queda anotado en Ajustes → Actividad. Si tus trabajadores usan
            este PC, dales su propia cuenta de Windows.
          </p>
        </>
      )}
    </AuthShell>
  );
}
