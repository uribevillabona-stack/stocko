import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/forms/register-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { LegalConsent } from "@/components/legal/legal-consent";
import { getAuthContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage() {
  const context = await getAuthContext();
  if (context.status === "member") redirect("/");
  if (context.status === "no-business") redirect("/onboarding");

  return (
    <AuthShell
      title="Crea tu cuenta"
      description="Tu negocio queda listo desde el primer minuto."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="font-medium text-brand hover:underline">
            Entra
          </Link>
        </>
      }
    >
      <RegisterForm />
      <LegalConsent />
    </AuthShell>
  );
}
