import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  hashToken,
  randomToken,
  verifyTokenHash,
} from "@/lib/crypto";

describe("secretos de WhatsApp", () => {
  it("cifra y descifra sin exponer el valor plano", () => {
    const payload = encryptSecret("token-super-secreto");
    expect(payload).not.toContain("token-super-secreto");
    expect(payload.startsWith("v1.")).toBe(true);
    expect(decryptSecret(payload)).toBe("token-super-secreto");
  });

  it("usa un IV distinto en cada cifrado", () => {
    expect(encryptSecret("mismo")).not.toBe(encryptSecret("mismo"));
  });

  it("falla si el contenido fue alterado", () => {
    const parts = encryptSecret("integro").split(".");
    const data = parts[3];

    if (!data) throw new Error("El cifrado no tiene contenido");

    parts[3] = `${data.startsWith("A") ? "B" : "A"}${data.slice(1)}`;

    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});

describe("tokens de invitación", () => {
  it("genera tokens largos y aleatorios", () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(40);
  });

  it("verifica el hash en tiempo constante", () => {
    const token = randomToken();
    expect(verifyTokenHash(token, hashToken(token))).toBe(true);
    expect(verifyTokenHash(token, hashToken("otro"))).toBe(false);
  });
});
