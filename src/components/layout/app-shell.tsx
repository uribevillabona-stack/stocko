import { LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { logoutAction } from "@/actions/auth";
import { Logo } from "@/components/layout/logo";
import { NavLinks } from "@/components/layout/nav";
import { Avatar } from "@/components/ui/avatar";
import { InstallButton } from "@/components/pwa/install-button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import type { MemberRole } from "@/lib/db/schema";
import type { SessionUser } from "@/server/auth/context";

export function AppShell({
  user,
  role,
  businessName,
  children,
}: {
  user: SessionUser;
  role: MemberRole;
  businessName: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[244px_minmax(0,1fr)] print:block">
      <aside className="sticky top-0 hidden h-dvh print:!hidden flex-col bg-surface px-4 py-6 lg:flex">
        <div className="px-3">
          <Logo />
        </div>

        <nav className="mt-8" aria-label="Principal">
          <NavLinks role={role} />
        </nav>

        <div className="mt-auto space-y-3">
          <Link
            href="/cuenta"
            className="flex items-center gap-3 rounded-2xl bg-hover p-3 transition-colors hover:bg-border"
          >
            <Avatar name={user.name} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
              <span className="block truncate text-xs text-muted">{businessName} · Mi cuenta</span>
            </span>
          </Link>
          <InstallButton />
          <div className="flex items-center justify-between gap-2 pl-1">
            <ThemeToggle />
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                <LogOut className="size-4" strokeWidth={1.75} />
                Salir
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-10 flex h-14 print:hidden items-center justify-between border-b border-border bg-surface/85 px-4 backdrop-blur-md lg:hidden">
          <Logo markClassName="size-6" />
          <div className="flex items-center gap-1">
            <InstallButton compact />
            <ThemeToggle />
            <Link
              href="/cuenta"
              aria-label="Mi cuenta"
              className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-ink"
            >
              <UserRound className="size-4" strokeWidth={1.75} />
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex size-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-ink"
                aria-label="Cerrar sesión"
              >
                <LogOut className="size-4" strokeWidth={1.75} />
              </button>
            </form>
          </div>
        </header>

        <main className="page-enter mx-auto w-full max-w-[1120px] flex-1 px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          {children}
        </main>

        <nav
          className="fixed inset-x-0 bottom-0 z-10 print:hidden border-t border-border bg-card/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
          aria-label="Principal"
        >
          <NavLinks role={role} variant="bottom" />
        </nav>
      </div>
    </div>
  );
}
