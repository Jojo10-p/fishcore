import { SessionProvider } from "@/components/app/session-provider";
import { AppShell } from "@/components/app/app-shell";

// Espace de gestion : navigation adaptée au rôle de l'utilisateur
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
