import { AlertCircle, CheckCircle2 } from "lucide-react";

export type ActionState = { ok?: boolean; message?: string; errors?: Record<string, string[] | undefined> } | undefined;

export function FormStatus({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  const ok = state.ok;
  return (
    <div role={ok ? "status" : "alert"} className={`flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm ${ok ? "bg-teal-50 text-teal-700" : "bg-[#FCEBEB] text-[#9E2B2B]"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>{state.message}</span>
    </div>
  );
}
