import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { BusinessForm } from "@/components/forms/business-form";
import { ConfirmSubmit } from "@/components/forms/confirm-submit";
import { EmployeeForm } from "@/components/forms/employee-form";
import { InviteForm } from "@/components/forms/invite-form";
import { CatalogForm, WhatsappSettingsForm } from "@/components/forms/whatsapp-forms";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { db } from "@/lib/db/client";
import { businesses, invitations, memberships, user } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/dates";
import { requireOwner } from "@/server/auth/context";
import { slugify } from "@/server/services/catalog";
import { getWhatsappSettings } from "@/server/services/whatsapp";
import { removeMemberAction, revokeInvitationAction } from "@/actions/team";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const context = await requireOwner();
  const now = new Date();

  const [members, pendingInvitations, whatsapp, [catalog]] = await Promise.all([
    db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        name: user.name,
        email: user.email,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(eq(memberships.businessId, context.business.id))
      .orderBy(asc(memberships.createdAt)),
    db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.businessId, context.business.id),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .orderBy(asc(invitations.createdAt)),
    getWhatsappSettings(context.business.id),
    db
      .select({ slug: businesses.slug, enabled: businesses.catalogEnabled })
      .from(businesses)
      .where(eq(businesses.id, context.business.id))
      .limit(1),
  ]);
  const desktop = env.STOCKO_DESKTOP === "1";
  const webhookUrl = new URL(`/api/whatsapp/webhook/${context.business.id}`, env.NEXT_PUBLIC_APP_URL).toString();

  return (
    <>
      <PageHeader
        title="Ajustes"
        description="Negocio, WhatsApp, catálogo y equipo."
        action={
          <ButtonLink href="/ajustes/actividad" variant="secondary" size="sm">
            Ver actividad
          </ButtonLink>
        }
      />

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Negocio"
            description="El nombre, la moneda y la zona horaria se usan en toda la aplicación."
          />
          <CardBody>
            <BusinessForm business={context.business} />
          </CardBody>
        </Card>

        <Card id="whatsapp">
          <CardHeader
            title="WhatsApp"
            description="Cómo se envían recibos y recordatorios a tus clientes."
          />
          <CardBody>
            {desktop ? (
              <p className="text-sm leading-6 text-muted">
                En Stocko para Windows, los recibos y recordatorios abren WhatsApp con el mensaje listo
                para enviar (necesita internet en ese momento). El envío automático con la API de Meta
                solo está en la versión web de Stocko.
              </p>
            ) : (
              <WhatsappSettingsForm settings={whatsapp} webhookUrl={webhookUrl} />
            )}
          </CardBody>
        </Card>

        <Card id="catalogo">
          <CardHeader
            title="Catálogo en línea"
            description="Una página pública con tus productos para compartir por WhatsApp o redes."
          />
          <CardBody>
            {desktop ? (
              <p className="text-sm leading-6 text-muted">
                El catálogo para tus clientes es una página en internet, así que solo está en la
                versión web de Stocko. Esta versión guarda todo en este PC.
              </p>
            ) : (
              <CatalogForm
                slug={catalog?.slug ?? null}
                enabled={catalog?.enabled ?? false}
                suggestion={slugify(context.business.name)}
                appUrl={env.NEXT_PUBLIC_APP_URL}
                hasWhatsapp={Boolean(context.business.whatsappNumber)}
              />
            )}
          </CardBody>
        </Card>

        <Card id="equipo">
          <CardHeader
            title="Equipo"
            description="Un negocio por cuenta. Cada persona entra con su propio correo."
          />
          <CardBody>
            <ul className="divide-y divide-border">
              {members.map((member) => {
                const isOwner = member.role === "owner";
                const isCurrentUser = member.userId === context.user.id;

                return (
                  <li key={member.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={member.name} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {member.name}
                          {isCurrentUser ? (
                            <span className="font-normal text-muted"> (tú)</span>
                          ) : null}
                        </p>
                        <p className="truncate text-xs text-muted">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={isOwner ? "brand" : "neutral"}>
                        {isOwner ? "Dueño" : "Empleado"}
                      </Badge>
                      {isOwner || isCurrentUser ? null : (
                        <form action={removeMemberAction}>
                          <input type="hidden" name="id" value={member.id} />
                          <ConfirmSubmit
                            variant="ghost"
                            size="sm"
                            message={`¿Quitar a ${member.name} del negocio?`}
                          >
                            Quitar
                          </ConfirmSubmit>
                        </form>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-ink">Crear un trabajador</h3>
              <p className="mb-4 mt-1 text-xs text-muted">
                Le creas la cuenta con un correo y una contraseña inicial, y ya puede entrar. Ve
                inventario, clientes y ventas, pero no costos, reportes de dinero ni ajustes.
              </p>
              <EmployeeForm />
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-sm font-semibold text-ink">O invítalo con un enlace</h3>
              <p className="mb-4 mt-1 text-xs text-muted">
                Esa persona elige su propia contraseña. No se envía ningún correo.
              </p>
              <InviteForm desktop={desktop} />
            </div>

            {pendingInvitations.length > 0 ? (
              <div className="mt-6 border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-ink">Invitaciones pendientes</h3>
                <ul className="mt-2 divide-y divide-border">
                  {pendingInvitations.map((invitation) => (
                    <li
                      key={invitation.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{invitation.email}</p>
                        <p className="text-xs text-muted">
                          Vence el {formatDate(invitation.expiresAt, context.business.timezone)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={invitation.role === "owner" ? "brand" : "neutral"}>
                          {invitation.role === "owner" ? "Dueño" : "Empleado"}
                        </Badge>
                        <form action={revokeInvitationAction}>
                          <input type="hidden" name="id" value={invitation.id} />
                          <ConfirmSubmit
                            variant="ghost"
                            size="sm"
                            message={`¿Revocar la invitación de ${invitation.email}?`}
                          >
                            Revocar
                          </ConfirmSubmit>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
