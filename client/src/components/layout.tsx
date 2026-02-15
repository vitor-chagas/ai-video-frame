import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { LogOut, User } from "lucide-react";

export function Layout({ children, className }: { children: React.ReactNode; className?: string }) {
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(38,20%,97%)] text-[hsl(24,10%,10%)] selection:bg-[hsl(24,10%,10%)] selection:text-[hsl(38,20%,97%)] relative overflow-hidden">
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
      
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-[hsl(38,30%,90%)] blur-[100px] z-0 pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-[hsl(38,30%,93%)] blur-[100px] z-0 pointer-events-none"></div>

      <header className="px-6 py-6 flex items-center justify-between max-w-7xl mx-auto w-full relative z-10">
        <Link href="/" className="text-2xl font-serif font-bold tracking-tight hover:opacity-80 transition-opacity">
            AutoFrame.
        </Link>
        <nav className="flex items-center gap-4">
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-2">
                {user.profileImageUrl ? (
                  <img src={user.profileImageUrl} alt="" className="h-7 w-7 rounded-full" />
                ) : (
                  <User className="h-4 w-4 text-muted-foreground" />
                )}
                <span className="text-sm text-muted-foreground">
                  {user.firstName || user.email || "User"}
                </span>
              </div>
              <a 
                href="/api/logout"
                className="text-sm font-medium flex items-center gap-1 hover:underline underline-offset-4"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
                Log out
              </a>
            </>
          ) : (
            <a
              href="/api/login"
              className="text-sm font-medium bg-[hsl(24,10%,10%)] text-[hsl(38,20%,97%)] px-5 py-2 rounded-full hover:bg-[hsl(24,10%,20%)] transition-colors"
              data-testid="button-login"
            >
              Sign In
            </a>
          )}
        </nav>
      </header>
      <main className={cn("flex-1 flex flex-col relative z-10", className)}>
        {children}
      </main>
      <footer className="py-8 text-center text-sm text-muted-foreground relative z-10">
        <p>&copy; 2026 AutoFrame. All rights reserved.</p>
      </footer>
    </div>
  );
}
