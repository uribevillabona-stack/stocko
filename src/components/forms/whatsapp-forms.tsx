"use client";

import { Send } from "lucide-react";
import { useActionState, useState } from "react";
import {
  sendBalanceReminderAction,
  sendSaleReceiptAction,
  testWhatsappConnectionAction,
  updateCatalogAction,
  updateWhatsappSettingsAction,
} from "@/actions/whatsapp";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { CopyField } from "@/components/ui/copy-field";
import { Field, inputStyles, selectStyles } from "@/components/ui/field";
import { fieldValue, firstFieldError, initialActionState, type ActionState } from "@/lib/action-state";
import { useFormAction } from "@/lib/use-form-action";

export type WhatsappSettingsView = {
  mode: "basic" | "cloud";
  phoneNumberId: string | null;
  wabaId: string | null;
  hasAccessToken: boolean;
  hasAppSecret: boolean;
  verifyToken: string | null;
  messagesEnabled: boolean;
  messageCap: number;
  usedThisMonth: number;
};

export function WhatsappSettingsForm({
  settings,
  webhookUrl,
}: {
  settings: WhatsappSettingsView;
  webhookUrl: string;
}) {
  // Sin reinicio automático: el modo es estado propio y decide qué campos se ven.
  const [state, onSubmit, isPending] = useFormAction(updateWhatsappSettingsAction, initialActionState);
  const [mode, setMode] = useState(settings.mode);
  const [testState, testAction] = useActionState(
    async (): Promise<ActionState> => testWhatsappConnectionAction(),
    initialActionState,
  );

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {state.error ? <Alert>{state.error}</Alert> : null}
        {state.success ? <Alert tone="success">{state.success}</Alert> : null}

        <Field label="Modo" htmlFor="wa-mode">
          <select
            id="wa-mode"
            name="mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as "basic" | "cloud")}
            className={selectStyles}
          >
            <option value="basic">Básico: enlaces wa.me (recomendado, gratis)</option>
            <option value="cloud">Cloud API de Meta (opcional, envío automático)</option>
          </select>
        </Field>

        {mode === "basic" ? (
          <p className="text-sm leading-6 text-muted">
            Stocko arma el mensaje (recibos, recordatorios) y abre WhatsApp con el texto listo. Tú lo
            envías desde tu teléfono. No necesitas configurar nada más.
          </p>
        ) : (
          <>
            <p className="text-sm leading-6 text-muted">
              Envía recibos y recordatorios automáticamente, solo como mensajes de servicio: el cliente
              debe haberte escrito en las últimas 24 horas. Necesitas una app en Meta for Developers con
              WhatsApp. No se usan plantillas de marketing.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ID del número de teléfono" htmlFor="wa-phone-id" error={firstFieldError(state, "phoneNumberId")}>
                <input
                  id="wa-phone-id"
                  name="phoneNumberId"
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={fieldValue(state, "phoneNumberId", settings.phoneNumberId ?? "")}
                  className={inputStyles}
                />
              </Field>
              <Field label="ID de la cuenta (WABA)" htmlFor="wa-waba" hint="Opcional." error={firstFieldError(state, "wabaId")}>
                <input
                  id="wa-waba"
                  name="wabaId"
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={fieldValue(state, "wabaId", settings.wabaId ?? "")}
                  className={inputStyles}
                />
              </Field>
              <Field
                label="Token de acceso"
                htmlFor="wa-token"
                hint={settings.hasAccessToken ? "Guardado y cifrado. Déjalo vacío para conservarlo." : "Token permanente de un usuario del sistema."}
              >
                <input id="wa-token" name="accessToken" type="password" autoComplete="off" className={inputStyles} />
              </Field>
              <Field
                label="App secret"
                htmlFor="wa-secret"
                hint={settings.hasAppSecret ? "Guardado y cifrado. Déjalo vacío para conservarlo." : "Se usa para verificar el webhook."}
              >
                <input id="wa-secret" name="appSecret" type="password" autoComplete="off" className={inputStyles} />
              </Field>
              <Field
                label="Tope de mensajes al mes"
                htmlFor="wa-cap"
                hint={`Usados este mes: ${settings.usedThisMonth}.`}
                error={firstFieldError(state, "messageCap")}
              >
                <input
                  id="wa-cap"
                  name="messageCap"
                  inputMode="numeric"
                  defaultValue={fieldValue(state, "messageCap", String(settings.messageCap))}
                  className={inputStyles}
                />
              </Field>
            </div>

            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3">
              <input
                type="checkbox"
                name="messagesEnabled"
                defaultChecked={state.values ? state.values.messagesEnabled === "on" : settings.messagesEnabled}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">Permitir envíos automáticos</span>
                <span className="mt-0.5 block text-xs leading-5 text-muted">
                  Si está apagado, la Cloud API solo recibe mensajes y Stocko sigue usando enlaces.
                </span>
              </span>
            </label>

            {settings.hasAccessToken || settings.hasAppSecret ? (
              <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
                <input type="checkbox" name="clearSecrets" className="size-4 shrink-0 accent-[var(--color-accent)]" />
                Borrar el token y el app secret guardados
              </label>
            ) : null}
          </>
        )}

        {mode === "basic" ? (
          <>
            <input type="hidden" name="phoneNumberId" value={settings.phoneNumberId ?? ""} />
            <input type="hidden" name="wabaId" value={settings.wabaId ?? ""} />
            <input type="hidden" name="messageCap" value={settings.messageCap} />
          </>
        ) : null}

        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…" pending={isPending}>
            Guardar WhatsApp
          </SubmitButton>
        </div>
      </form>

      {settings.mode === "cloud" ? (
        <div className="space-y-3 border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-ink">Webhook en Meta</h3>
          <p className="text-xs leading-5 text-muted">
            En tu app de Meta → WhatsApp → Configuración, usa esta URL y este token de verificación, y
            suscríbete al campo <code className="font-mono">messages</code>.
          </p>
          <CopyField value={webhookUrl} label="URL del webhook" />
          {settings.verifyToken ? <CopyField value={settings.verifyToken} label="Token de verificación" /> : null}
          <form action={testAction} className="flex flex-wrap items-center gap-3">
            <SubmitButton variant="secondary" size="sm" pendingLabel="Probando…">
              Probar conexión
            </SubmitButton>
            {testState.error ? <span className="text-xs text-danger">{testState.error}</span> : null}
            {testState.success ? <span className="text-xs text-success">{testState.success}</span> : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function CatalogForm({
  slug,
  enabled,
  suggestion,
  appUrl,
  hasWhatsapp,
}: {
  slug: string | null;
  enabled: boolean;
  suggestion: string;
  appUrl: string;
  hasWhatsapp: boolean;
}) {
  const [state, formAction] = useActionState(updateCatalogAction, initialActionState);
  const publicUrl = slug ? new URL(`/catalogo/${slug}`, appUrl).toString() : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? <Alert>{state.error}</Alert> : null}
      {state.success ? <Alert tone="success">{state.success}</Alert> : null}
      {!hasWhatsapp ? (
        <Alert tone="warn">Agrega el WhatsApp del negocio arriba para que los clientes puedan pedirte desde el catálogo.</Alert>
      ) : null}

      <Field
        label="Dirección del catálogo"
        htmlFor="catalog-slug"
        hint="Letras minúsculas, números y guiones."
        error={firstFieldError(state, "slug")}
      >
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-muted">/catalogo/</span>
          <input
            id="catalog-slug"
            name="slug"
            autoComplete="off"
            defaultValue={fieldValue(state, "slug", slug ?? suggestion)}
            className={inputStyles}
          />
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3">
        <input
          type="checkbox"
          name="catalogEnabled"
          defaultChecked={state.values ? state.values.catalogEnabled === "on" : enabled}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        <span>
          <span className="block text-sm font-medium text-ink">Publicar catálogo</span>
          <span className="mt-0.5 block text-xs leading-5 text-muted">
            Cualquiera con el enlace ve tus productos activos, precios y si hay disponible. Nunca se
            muestran costos ni cantidades exactas.
          </span>
        </span>
      </label>

      {enabled && publicUrl ? <CopyField value={publicUrl} label="Enlace público del catálogo" /> : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar catálogo</SubmitButton>
      </div>
    </form>
  );
}

export function CloudSendButton({
  kind,
  id,
  windowOpen,
}: {
  kind: "receipt" | "reminder";
  id: string;
  windowOpen: boolean;
}) {
  const [state, formAction] = useActionState(
    kind === "receipt" ? sendSaleReceiptAction : sendBalanceReminderAction,
    initialActionState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name={kind === "receipt" ? "saleId" : "customerId"} value={id} />
      <SubmitButton variant="secondary" pendingLabel="Enviando…" disabled={!windowOpen}>
        <Send className="size-4" strokeWidth={1.75} />
        {kind === "receipt" ? "Enviar automático" : "Recordar automático"}
      </SubmitButton>
      {!windowOpen ? (
        <span className="text-xs text-muted">Disponible si el cliente te escribió en las últimas 24 h.</span>
      ) : null}
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
      {state.success ? <span className="text-xs text-success">{state.success}</span> : null}
    </form>
  );
}
