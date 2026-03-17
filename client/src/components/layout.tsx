import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, User } from "lucide-react";
import { LoginDialog } from "./login-dialog";
import { LanguageSwitcher } from "./language-switcher";
import { useTranslation } from "react-i18next";

export function Layout({ children, className }: { children: React.ReactNode; className?: string }) {
  const { user, isAuthenticated, logout } = useAuth();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(38,20%,97%)] text-[hsl(24,10%,10%)] selection:bg-[hsl(24,10%,10%)] selection:text-[hsl(38,20%,97%)] relative">
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>

      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[hsl(38,30%,90%)] blur-[100px] z-0 pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[hsl(38,30%,93%)] blur-[100px] z-0 pointer-events-none"></div>

      <header className="sticky top-0 z-50 w-full bg-[hsl(38,20%,97%)]/80 backdrop-blur-md border-b border-[hsl(38,10%,90%)] transition-all duration-300 ease-in-out">
        <div className="max-w-7xl mx-auto px-4 h-24 flex items-center justify-between">
          <Link href="/" className="hover:opacity-80 transition-opacity flex items-center">
              <img src="/logo.png" alt="AI Video Frame" className="h-14 w-auto" />
          </Link>
          <nav className="flex items-center gap-4">
          <LanguageSwitcher />
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-2">
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-base text-muted-foreground">
                  {user.firstName || user.email || "User"}
                </span>
              </div>
              <a
                href="/api/logout"
                className="text-base font-medium flex items-center gap-1 hover:underline underline-offset-4"
                data-testid="button-logout"
              >
                <LogOut className="h-5 w-5" />
                {t("common.logOut")}
              </a>
            </>
          ) : (
            <LoginDialog>
              <button
                className="text-base font-medium bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] px-6 py-2.5 rounded-full hover:bg-[hsl(24,10%,20%)] transition-colors"
                data-testid="button-login"
              >
                {t("common.signIn")}
              </button>
            </LoginDialog>
          )}
          </nav>
        </div>
      </header>
      <main className={cn("flex-1 flex flex-col relative z-10", className)}>
        {children}
      </main>
      <footer className="py-8 text-center text-sm text-muted-foreground relative z-10">
        <p>{t("layout.footer")}</p>
      </footer>
    </div>
  );
}
