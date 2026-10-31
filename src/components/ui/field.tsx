import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-xl border border-night/12 bg-white px-3.5 text-[15px] text-ink placeholder:text-ink-faint transition focus:border-teal focus:outline-none focus:ring-4 focus:ring-teal/15 disabled:bg-mist/60 aria-[invalid=true]:border-[#C93B3B] aria-[invalid=true]:ring-[#C93B3B]/10";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(base, "h-11", className)} {...p} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea ref={ref} className={cn(base, "min-h-[110px] py-3 leading-relaxed", className)} {...p} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, children, ...p }, ref) => (
  <select
    ref={ref}
    className={cn(base, "h-11 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%234A5873%22 stroke-width=%222%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:14px] bg-[right_14px_center] bg-no-repeat pr-10", className)}
    {...p}
  >
    {children}
  </select>
));
Select.displayName = "Select";

export function Label({ className, ...p }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-sm font-medium text-ink", className)} {...p} />;
}

export function Field({ label, htmlFor, error, hint, required, children, className }: { label: string; htmlFor: string; error?: string | string[]; hint?: string; required?: boolean; children: React.ReactNode; className?: string }) {
  const msg = Array.isArray(error) ? error[0] : error;
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-champagne-700" aria-hidden>*</span>}
      </Label>
      {children}
      {msg ? (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-[13px] text-[#C93B3B]">{msg}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-ink-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="checkbox" className={cn("h-[18px] w-[18px] shrink-0 cursor-pointer rounded border-night/25 accent-teal", className)} {...p} />;
}
