export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  inviteUrl?: string;
  /** Lo que la persona escribió, para no perderlo cuando la acción falla. */
  values?: Record<string, string>;
};

export const initialActionState: ActionState = {};

export function firstFieldError(
  state: ActionState,
  field: string,
): string | undefined {
  return state.fieldErrors?.[field]?.[0];
}

/** Valor por defecto de un campo: lo último enviado si falló, si no `fallback`. */
export function fieldValue(state: ActionState, field: string, fallback = ""): string {
  return state.values?.[field] ?? fallback;
}

/** Lo enviado, para volver a mostrarlo. Nunca incluye contraseñas (viajan de vuelta a la página). */
export function formValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION") && !/password/i.test(key)) values[key] = value;
  }
  return values;
}
