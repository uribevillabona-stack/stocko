import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/forms/onboarding-form";
import { AuthShell } from "@/components/layout/auth-shell";
import { getAuthContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Tu negocio" };

export default async function OnboardingPage() {
  const context = await getAuthContext();
  if (context.status === "anonymous") redirect("/login");
  if (context.status === "member") redirect("/");

  return (
    <AuthShell
      title="Crea tu negocio"
      description={`Hola, ${context.user.name}. Falta un paso: el nombre de tu negocio.`}
    >
      <OnboardingForm />
    </AuthShell>
  );
}
