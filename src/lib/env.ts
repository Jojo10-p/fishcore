import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET doit faire au moins 32 caractères"),
  STORAGE_DIR: z.string().default("./storage/private"),
  MAIL_PROVIDER: z.enum(["console", "resend", "smtp"]).default("console"),
  MAIL_FROM: z.string().default("Aurane Finance <no-reply@example.com>"),
  ADMIN_NOTIFY_EMAIL: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
});

let cached: z.infer<typeof schema> | null = null;
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
