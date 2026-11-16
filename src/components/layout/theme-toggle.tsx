"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { setTheme } = useTheme();

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "light" : "dark");
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="size-9 px-0"
      onClick={toggleTheme}
      aria-label="Cambiar entre modo claro y oscuro"
      title="Cambiar tema"
    >
      <Sun className="hidden size-4 dark:block" strokeWidth={1.75} />
      <Moon className="size-4 dark:hidden" strokeWidth={1.75} />
    </Button>
  );
}
