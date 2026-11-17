import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/login-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { RECOVERY_ACTION_URL } from "@/lib/desktop-recovery";
import { env } from "@/lib/env";
import { getAuthContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const context = await getAuthContext();
  if (context.status === "member") redirect("/");
  if (context.status === "no-business") redirect("/onboarding");
  const { recuperada } = await searchParams;

  return (
    <AuthShell
      title="Entra a tu negocio"
      description="Inventario, equipo y ajustes con tu cuenta."
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link href="/registro" className="font-medium text-brand hover:underline">
            Crea una
          </Link>
        </>
      }
    >
      {recuperada === "1" ? (
        <div className="mb-4">
          <Alert tone="success">Listo, ya tienes contraseña nueva. Entra con ella.</Alert>
        </div>
      ) : null}
      {/* En Windows lo atiende Stocko (desktop/main.cjs), que abre /recuperar con un enlace de un solo uso. */}
      <LoginForm
        recoveryHref={env.STOCKO_DESKTOP === "1" && env.STOCKO_RECOVERY_KEY ? RECOVERY_ACTION_URL : undefined}
      />
    </AuthShell>
  );
}
