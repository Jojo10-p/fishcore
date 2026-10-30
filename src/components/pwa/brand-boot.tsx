"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { applyBrand, readBrand } from "@/lib/client/brand";

/**
 * Sur un appareil déjà utilisé par une entreprise, l'onglet et l'application
 * installée gardent son nom et son logo sur toutes les pages (connexion,
 * caisse, documents), même hors connexion.
 */
export function BrandBoot() {
  const pathname = usePathname();
  useEffect(() => {
    const brand = readBrand();
    if (brand) applyBrand(brand);
  }, [pathname]);
  return null;
}
