"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Botón "Instalar app": solo aparece cuando el navegador lo permite. */
export function InstallButton({ compact = false }: { compact?: boolean }) {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!promptEvent) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        await promptEvent.prompt();
        await promptEvent.userChoice.catch(() => undefined);
        setPromptEvent(null);
      }}
      aria-label="Instalar Stocko"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl text-xs font-medium text-muted transition-colors hover:bg-surface hover:text-ink",
        compact ? "size-9 justify-center" : "px-2 py-1.5",
      )}
    >
      <Download className="size-4" strokeWidth={1.75} />
      {compact ? null : "Instalar app"}
    </button>
  );
}
