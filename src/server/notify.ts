import "server-only";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendTemplatedEmail } from "./mail";

export async function notifyUser(userId: string, n: { title: string; body: string; link?: string; email?: { templateKey: string; vars: Record<string, string> } }) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return;
  if (user.notifyInApp) {
    await db.notification.create({ data: { userId, channel: "IN_APP", title: n.title, body: n.body, link: n.link } });
  }
  if (n.email && user.notifyByEmail) {
    await sendTemplatedEmail({ to: user.email, templateKey: n.email.templateKey, vars: { firstName: user.firstName, ...n.email.vars }, userId });
  }
}

/** Notifie l'équipe : notification interne aux membres habilités + email d'alerte. */
export async function notifyStaff(permission: string, n: { title: string; body: string; link?: string; email?: { templateKey: string; vars: Record<string, string> } }) {
  const staff = await db.user.findMany({
    where: { type: "STAFF", status: "ACTIVE", deletedAt: null, role: { permissions: { some: { key: permission } } } },
    select: { id: true, notifyInApp: true },
  });
  if (staff.length) {
    await db.notification.createMany({
      data: staff.filter((s) => s.notifyInApp).map((s) => ({ userId: s.id, channel: "IN_APP" as const, title: n.title, body: n.body, link: n.link })),
    });
  }
  const to = env().ADMIN_NOTIFY_EMAIL;
  if (n.email && to) await sendTemplatedEmail({ to, templateKey: n.email.templateKey, vars: n.email.vars });
}
