import { AuthForm } from "@/components/forms/auth-form";
import { resetPassword } from "@/server/actions/auth";

export const metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default async function AdminReset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center bg-night px-4">
      <div className="w-full max-w-md rounded-[24px] bg-white p-8">
        <h1 className="mb-6 text-2xl font-extrabold">Nouveau mot de passe</h1>
        <AuthForm action={resetPassword} submitLabel="Enregistrer" hidden={{ token }} fields={[{ name: "password", label: "Nouveau mot de passe", type: "password", autoComplete: "new-password", hint: "10 caractères min., majuscule, minuscule et chiffre" }, { name: "passwordConfirm", label: "Confirmation", type: "password", autoComplete: "new-password" }]} />
      </div>
    </div>
  );
}
