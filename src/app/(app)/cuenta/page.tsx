import type { Metadata } from "next";
import { PasswordForm, ProfileForm } from "@/components/forms/account-forms";
import { PageHeader } from "@/components/layout/page-header";
import { InstallButton } from "@/components/pwa/install-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireMember } from "@/server/auth/context";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const { user, business, role } = await requireMember();

  return (
    <>
      <PageHeader
        title="Mi cuenta"
        description={`${user.email} · ${business.name}`}
        action={<Badge tone={role === "owner" ? "brand" : "neutral"}>{role === "owner" ? "Dueño" : "Empleado"}</Badge>}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Perfil" description="Así te ven tus compañeros y aparece en ventas y movimientos." />
          <CardBody>
            <ProfileForm name={user.name} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Contraseña" description="Al cambiarla se cierran tus sesiones en otros dispositivos." />
          <CardBody>
            <PasswordForm />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="App en tu teléfono"
            description="Stocko se instala como app desde el navegador: en Android usa «Instalar app» o el menú del navegador; en iPhone, Compartir → «Agregar a inicio»."
          />
          <CardBody>
            <InstallButton />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
