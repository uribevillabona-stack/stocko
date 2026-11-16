import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/forms/login-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { getAuthContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage() {
  const context = await getAuthContext();
  if (context.status === "member") redirect("/");
  if (context.status === "no-business") redirect("/onboarding");

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
      <LoginForm />
    </AuthShell>
  );
}
