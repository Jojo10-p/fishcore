"use client";

// Marque blanche côté navigateur : l'application installée et l'onglet portent
// le nom et le logo de l'entreprise connectée.

const BRAND_KEY = "fishcore-brand";

export interface Brand {
  companyId: string;
  name: string;
  logoUrl: string | null;
}

export function readBrand(): Brand | null {
  try {
    const raw = localStorage.getItem(BRAND_KEY);
    return raw ? (JSON.parse(raw) as Brand) : null;
  } catch {
    return null;
  }
}

/**
 * Édition GJH : le nom et le logo sont fixes (manifeste et icônes statiques du
 * site), on garde seulement la dernière entreprise connectée en mémoire.
 */
export function applyBrand(brand: Brand | null) {
  if (typeof document === "undefined") return;
  try {
    if (brand) localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
    else localStorage.removeItem(BRAND_KEY);
  } catch {
    /* ignore */
  }
}

// ── Préparation du logo (dans le navigateur, sans service externe) ─────────

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible : choisissez un fichier PNG, JPG ou WebP"));
    };
    img.src = url;
  });
}

/** Dessine le logo centré dans un carré (fond blanc), `fill` = part du carré occupée. */
function square(img: HTMLImageElement, size: number, fill: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Navigateur incompatible");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  const box = size * fill;
  const ratio = Math.min(box / img.naturalWidth, box / img.naturalHeight);
  const w = img.naturalWidth * ratio;
  const h = img.naturalHeight * ratio;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return canvas.toDataURL("image/png");
}

export async function prepareLogo(file: File): Promise<{ logo512: string; logo192: string; maskable512: string }> {
  if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(file.type)) throw new Error("Format accepté : PNG, JPG, WebP ou SVG");
  if (file.size > 5 * 1024 * 1024) throw new Error("Image trop lourde (5 Mo maximum)");
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error("Image vide");
  return {
    logo512: square(img, 512, 0.92),
    logo192: square(img, 192, 0.92),
    // Android découpe l'icône en cercle : le logo doit rester dans les 80 % centraux
    maskable512: square(img, 512, 0.7),
  };
}
