import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";
import { OperatorNotice } from "@/components/legal/operator-notice";

export const metadata: Metadata = { title: "Política de privacidad" };

export default function PrivacyPage() {
  return (
    <>
      <OperatorNotice />
      <LegalDocument file="privacidad.md" />
    </>
  );
}
