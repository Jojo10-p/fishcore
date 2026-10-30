"use client";

import { APP_NAME } from "@/lib/app-config";

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

function setLink(rel: string, href: string) {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.rel = rel;
    document.head.appendChild(el);
  }
  if (el.getAttribute("href") !== href) el.href = href;
}

let titleObserver: MutationObserver | null = null;

/** Remplace le nom du logiciel par celui de l'entreprise dans le titre de l'onglet. */
function brandTitle(name: string) {
  const fix = () => {
    const t = document.title;
    if (!t || t.includes(name)) return;
    document.title = t.includes(APP_NAME) ? t.replaceAll(APP_NAME, name) : `${t} · ${name}`;
  };
  fix();
  titleObserver?.disconnect();
  const titleEl = document.head.querySelector("title");
  if (titleEl) {
    titleObserver = new MutationObserver(fix);
    titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
  }
}

export function applyBrand(brand: Brand | null) {
  if (typeof document === "undefined") return;
  if (!brand) {
    titleObserver?.disconnect();
    try {
      localStorage.removeItem(BRAND_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    localStorage.setItem(BRAND_KEY, JSON.stringify(brand));
  } catch {
    /* ignore */
  }
  setLink("manifest", `/api/brand/${brand.companyId}/manifest.webmanifest`);
  const v = brand.logoUrl ? (new URL(brand.logoUrl, location.origin).searchParams.get("v") ?? "") : "";
  if (brand.logoUrl) {
    setLink("icon", `/api/brand/${brand.companyId}/icon-192.png?v=${v}`);
    setLink("apple-touch-icon", `/api/brand/${brand.companyId}/icon-192.png?v=${v}`);
  } else {
    setLink("icon", "/icons/icon.svg");
    setLink("apple-touch-icon", "/icons/icon-192.png");
  }
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", brand.name);
  document.querySelector('meta[name="application-name"]')?.setAttribute("content", brand.name);
  brandTitle(brand.name);
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
