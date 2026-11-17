import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/actions/auth";
import { InvitationForm } from "@/components/forms/invitation-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { LegalConsent } from "@/components/legal/legal-consent";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { getSessionUser } from "@/server/auth/context";
import { findInvitationByToken } from "@/server/services/invitations";

export const metadata: Metadata = { title: "Invitación" };

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invitation, sessionUser] = await Promise.all([
    findInvitationByToken(token),
    getSessionUser(),
  ]);

  if (!invitation) {
    return (
      <AuthShell
        title="Invitación no válida"
        description="El enlace venció o ya fue usado. Pide uno nuevo a quien administra el negocio."
        footer={
          <Link href="/login" className="font-medium text-brand hover:underline">
            Ir a entrar
          </Link>
        }
      >
        <ButtonLink href="/login" className="w-full">
          Entrar a Stocko
        </ButtonLink>
      </AuthShell>
    );
  }

  const sameEmail = sessionUser?.email.toLowerCase() === invitation.email.toLowerCase();
  const roleLabel = invitation.role === "owner" ? "Dueño" : "Empleado";

  return (
    <AuthShell
      title={`Únete a ${invitation.businessName}`}
      description="Tu cuenta quedará vinculada a este negocio."
      footer={
        sameEmail ? (
          <Link href="/" className="font-medium text-brand hover:underline">
            Ir a mi negocio
          </Link>
        ) : sessionUser ? null : (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              Entra y vuelve a abrir el enlace
            </Link>
          </>
        )
      }
    >
      <div className="mb-5 rounded-xl border border-border bg-surface px-3 py-2.5">
        <p className="text-xs text-muted">Invitación para</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{invitation.email}</span>
          <Badge tone={invitation.role === "owner" ? "brand" : "neutral"}>{roleLabel}</Badge>
        </div>
      </div>

      {sessionUser && !sameEmail ? (
        <div className="space-y-4">
          <Alert tone="warn">
            Esta invitación es para {invitation.email}. Cierra sesión y vuelve a abrir el enlace
            para aceptarla con esa cuenta.
          </Alert>
          <form action={logoutAction}>
            <input type="hidden" name="redirectTo" value={`/invitacion/${token}`} />
            <Button type="submit" variant="secondary" className="w-full">
              Cerrar sesión y continuar
            </Button>
          </form>
        </div>
      ) : (
        <>
          <InvitationForm token={token} mode={sameEmail ? "join" : "signup"} />
          {sameEmail ? null : <LegalConsent />}
        </>
      )}
    </AuthShell>
  );
}
