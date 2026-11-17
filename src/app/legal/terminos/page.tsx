import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = { title: "Términos de uso" };

export default function TermsPage() {
  return <LegalDocument file="terminos.md" />;
}
