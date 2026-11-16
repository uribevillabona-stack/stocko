"use client";

import { ImagePlus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { removeProductPhotoAction, uploadProductPhotoAction } from "@/actions/inventory";
import { SubmitButton } from "@/components/forms/submit-button";
import { Alert } from "@/components/ui/alert";
import { buttonStyles } from "@/components/ui/button";
import { initialActionState, type ActionState } from "@/lib/action-state";

export function ProductPhotoForm({
  productId,
  productName,
  photoUrl,
}: {
  productId: string;
  productName: string;
  photoUrl: string | null;
}) {
  const [state, uploadAction] = useActionState(uploadProductPhotoAction, initialActionState);
  const [removeState, removeAction] = useActionState(removeProductPhotoAction, initialActionState);
  // La vista previa pertenece al resultado vigente: al terminar la subida (o
  // fallar) el estado cambia y la vista previa deja de aplicarse sola.
  const [selection, setSelection] = useState<{ url: string; state: ActionState } | null>(null);
  const preview = selection && selection.state === state ? selection.url : null;
  const shown = preview ?? photoUrl;
  const message = state.error ?? removeState.error;
  const success = state.success ?? removeState.success;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface sm:w-56">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt={`Foto de ${productName}`} className="size-full object-cover" />
        ) : (
          <ImagePlus className="size-8 text-muted" strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {message ? <Alert>{message}</Alert> : null}
        {success && !message ? <Alert tone="success">{success}</Alert> : null}
        <form action={uploadAction} className="space-y-3">
          <input type="hidden" name="productId" value={productId} />
          <label className={buttonStyles({ variant: "secondary", className: "cursor-pointer" })}>
            <ImagePlus className="size-4" strokeWidth={1.75} />
            {shown ? "Cambiar foto" : "Elegir foto"}
            <input
              type="file"
              name="photo"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setSelection(file ? { url: URL.createObjectURL(file), state } : null);
              }}
            />
          </label>
          {preview ? (
            <SubmitButton pendingLabel="Subiendo…" className="ml-2">
              Guardar foto
            </SubmitButton>
          ) : null}
          <p className="text-xs text-muted">JPG, PNG o WebP de hasta 5 MB. Se reduce y se quitan los datos de ubicación.</p>
        </form>
        {photoUrl && !preview ? (
          <form action={removeAction}>
            <input type="hidden" name="productId" value={productId} />
            <SubmitButton variant="ghost" size="sm" pendingLabel="Quitando…">
              <Trash2 className="size-4" strokeWidth={1.75} />
              Quitar foto
            </SubmitButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}
