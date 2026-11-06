-- Présence : dernière activité de chaque session (direction : qui est en ligne)
ALTER TABLE "auth_sessions" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "auth_sessions_lastSeenAt_idx" ON "auth_sessions"("lastSeenAt");

-- Cloche de la direction
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
