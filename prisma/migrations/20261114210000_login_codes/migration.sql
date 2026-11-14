-- Codes de connexion à usage unique (super administrateur)
CREATE TABLE "login_codes" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3),
    "ipAddress" TEXT,

    CONSTRAINT "login_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_codes_email_createdAt_idx" ON "login_codes"("email", "createdAt");

-- Table interne : accessible seulement au serveur (pas à l’API publique Supabase)
ALTER TABLE "login_codes" ENABLE ROW LEVEL SECURITY;
