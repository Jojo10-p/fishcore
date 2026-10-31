"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit } from "@/server/rate-limit";
import { requestMeta } from "@/server/request";
import { notifyStaff } from "@/server/notify";
import type { ActionState } from "@/components/ui/form-status";

const schema = z.object({
  name: z.string().trim().min(2, "Indiquez votre nom").max(120),
  email: z.string().trim().toLowerCase().email("Email invalide").max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  subject: z.string().trim().min(3, "Indiquez un sujet").max(150),
  message: z.string().trim().min(10, "Votre message est trop court").max(5000),
  website: z.string().max(0).optional(), // honeypot
});

export async function submitContact(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, message: "Vérifiez les champs signalés.", errors: parsed.error.flatten().fieldErrors };
  const { ip } = await requestMeta();
  if (!(await rateLimit(`contact:${ip}`, 5, 3600))) return { ok: false, message: "Trop de messages envoyés. Réessayez dans une heure." };
  const { website: _hp, ...data } = parsed.data;
  void _hp;
  await db.contactMessage.create({ data: { ...data, phone: data.phone || null, ip } });
  await notifyStaff("messages.manage", {
    title: "Nouveau message de contact",
    body: `${data.name} — ${data.subject}`,
    link: "/admin/messages",
    email: { templateKey: "contact_admin_alert", vars: { name: data.name, email: data.email, subject: data.subject, message: data.message } },
  });
  return { ok: true, message: "sent" };
}
