"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionState } from "@/lib/action-state";

/**
 * Como useActionState, pero envía el formulario sin el reinicio automático de
 * React 19. Úsalo en formularios con estado propio (selects controlados,
 * filas de una venta): el reinicio devolvería el DOM a sus valores iniciales
 * mientras el estado conserva otros, y se enviarían datos equivocados.
 */
export function useFormAction(
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>,
  initial: ActionState,
) {
  const [state, dispatch, isPending] = useActionState(action, initial);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return [state, onSubmit, isPending] as const;
}
