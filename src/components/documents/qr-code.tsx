import QRCode from "qrcode";

/**
 * QR code dessiné en SVG de façon synchrone : il est présent dès le premier
 * rendu, donc à l'impression automatique du ticket.
 */
export function QrCode({ value, size = 104 }: { value: string; size?: number }) {
  let modules: { size: number; data: Uint8Array };
  try {
    modules = QRCode.create(value, { errorCorrectionLevel: "M" }).modules as unknown as { size: number; data: Uint8Array };
  } catch {
    return null;
  }
  const n = modules.size;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules.data[y * n + x]) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + 4} ${n + 4}`} shapeRendering="crispEdges" role="img" aria-label="QR code de la facture normalisée">
      <rect width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
