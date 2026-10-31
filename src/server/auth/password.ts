import "server-only";
import bcrypt from "bcryptjs";
import { z } from "zod";

export const passwordSchema = z
  .string()
  .min(10, "10 caractères minimum")
  .max(128)
  .regex(/[a-z]/, "Au moins une minuscule")
  .regex(/[A-Z]/, "Au moins une majuscule")
  .regex(/[0-9]/, "Au moins un chiffre");

export const hashPassword = (p: string) => bcrypt.hash(p, 12);
export const verifyPassword = (p: string, h: string) => bcrypt.compare(p, h);

/** Hash factice pour égaliser le temps de réponse quand l'email n'existe pas. */
export const DUMMY_HASH = "$2a$12$C6UzMDM.H6dfI/f/IKcEeO5Q7YQzGdZqTq8Q1y6xkO8Vq3ZKb6xUe";
