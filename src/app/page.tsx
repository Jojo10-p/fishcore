import { redirect } from "next/navigation";

// L'accueil renvoie vers le tableau de bord (le proxy redirige vers /login si besoin)
export default function Home() {
  redirect("/dashboard");
}
