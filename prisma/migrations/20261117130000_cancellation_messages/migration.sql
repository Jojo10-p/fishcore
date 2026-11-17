-- Échanges (texte, notes vocales) sur les demandes d'annulation
CREATE TABLE "cancellation_messages" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancellationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" TEXT,
    "audio" BYTEA,
    "audioMime" TEXT,
    "audioSeconds" INTEGER,
    CONSTRAINT "cancellation_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cancellation_messages_cancellationId_createdAt_idx" ON "cancellation_messages"("cancellationId", "createdAt");
ALTER TABLE "cancellation_messages" ADD CONSTRAINT "cancellation_messages_cancellationId_fkey" FOREIGN KEY ("cancellationId") REFERENCES "cancellations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cancellation_messages" ENABLE ROW LEVEL SECURITY;
