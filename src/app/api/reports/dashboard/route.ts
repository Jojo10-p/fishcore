import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/reports/dashboard — Données agrégées pour le tableau de bord
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const centerId = searchParams.get("centerId");
    const dateStr = searchParams.get("date") ?? new Date().toISOString().split("T")[0];

    if (!companyId) {
      return NextResponse.json({ success: false, error: "companyId requis" }, { status: 400 });
    }

    const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const saleWhere = {
      companyId,
      ...(centerId ? { centerId } : {}),
      status: { not: "CANCELLED" as const },
      createdAt: { gte: startOfDay, lte: endOfDay },
    };

    // Requêtes parallèles
    const [salesStats, salesCount, lowStockCount, openSessions, recentSales] =
      await Promise.all([
        // Total et CA du jour
        prisma.sale.aggregate({
          where: saleWhere,
          _sum: { totalAmount: true },
          _count: { id: true },
        }),

        // Ventes par heure (pour le graphique)
        prisma.sale.groupBy({
          by: ["createdAt"],
          where: saleWhere,
          _sum: { totalAmount: true },
          _count: { id: true },
        }),

        // Produits en stock faible
        prisma.stock.count({
          where: {
            center: { companyId },
            ...(centerId ? { centerId } : {}),
            product: { isActive: true },
          },
        }),

        // Sessions de caisse ouvertes
        prisma.cashSession.count({
          where: {
            closedAt: null,
            ...(centerId
              ? { cashRegister: { centerId } }
              : { cashRegister: { center: { companyId } } }),
          },
        }),

        // 10 dernières ventes
        prisma.sale.findMany({
          where: {
            companyId,
            ...(centerId ? { centerId } : {}),
          },
          include: {
            cashier: { select: { firstName: true, lastName: true } },
            lines: { include: { product: { select: { name: true } } } },
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

    // CA par heure pour le graphique en barres (24 buckets)
    const hourlyRevenue = Array.from({ length: 24 }, (_, hour) => {
      const hourSales = recentSales.filter((s) => {
        const saleHour = new Date(s.createdAt).getHours();
        return (
          saleHour === hour &&
          new Date(s.createdAt) >= startOfDay &&
          new Date(s.createdAt) <= endOfDay
        );
      });
      return {
        hour: `${String(hour).padStart(2, "0")}h`,
        revenue: hourSales.reduce((s, sale) => s + Number(sale.totalAmount), 0),
        count: hourSales.length,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        today: {
          salesCount: salesStats._count.id,
          revenue: Number(salesStats._sum.totalAmount ?? 0),
        },
        lowStockCount,
        openSessions,
        recentSales,
        hourlyRevenue,
      },
    });
  } catch (error) {
    console.error("[REPORTS] Erreur dashboard:", error);
    return NextResponse.json({ success: false, error: "Erreur serveur" }, { status: 500 });
  }
}
