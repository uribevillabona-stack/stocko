import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { dismissRecoveryNoticeAction } from "@/actions/recovery-notice";
import { SubmitButton } from "@/components/forms/submit-button";
import { formatDateTime } from "@/lib/dates";
import type { OwnerRecovery } from "@/server/services/recovery-notice";

/** Aviso al dueño: la contraseña de una cuenta de dueño se cambió desde este PC. */
export function RecoveryNotice({ changes, timeZone }: { changes: OwnerRecovery[]; timeZone: string }) {
  return (
    <div role="status" className="mb-6 rounded-2xl border border-warn/30 bg-warn-soft p-4 text-sm text-ink sm:p-5">
      <div className="flex gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-semibold">
            {changes.length === 1
              ? "La contraseña de dueño se cambió desde este PC con «Olvidé mi contraseña»."
              : `La contraseña de dueño se cambió ${changes.length} veces desde este PC con «Olvidé mi contraseña».`}
          </p>
          <ul className="space-y-0.5 text-muted">
            {changes.map((change) => (
              <li key={change.at.toISOString()}>
                {formatDateTime(change.at, timeZone)} · {change.email}
              </li>
            ))}
          </ul>
          <p className="text-muted">
            {changes.length === 1 ? "Si no fuiste tú" : "Si alguna no la hiciste tú"}, alguien que usa este PC entró
            como dueño. Cambia tu contraseña en{" "}
            <Link href="/cuenta" className="font-medium text-brand hover:underline">
              Mi cuenta
            </Link>
            , revisa{" "}
            <Link href="/ajustes/actividad" className="font-medium text-brand hover:underline">
              Ajustes → Actividad
            </Link>{" "}
            y dale a cada trabajador su propia cuenta de Windows.
          </p>
          <form action={dismissRecoveryNoticeAction}>
            <SubmitButton variant="secondary" size="sm" pendingLabel="Guardando…">
              Entendido
            </SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
