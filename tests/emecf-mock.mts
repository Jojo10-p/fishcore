/**
 * Faux serveur e-MCF (DGI) pour les tests : mêmes routes et mêmes réponses que
 * l'API réelle (statut, facture, confirmation, annulation), avec des pannes
 * déclenchables (réseau, refus, total faux, erreur à la confirmation).
 */
import http from "node:http";
import crypto from "node:crypto";

export interface MockInvoice {
  uid: string;
  body: Record<string, any>;
  total: number;
  state: "pending" | "confirmed" | "cancelled";
  date: string;
  code?: string;
}

export interface EmecfMock {
  url: string;
  token: string;
  ifu: string;
  nim: string;
  invoices: MockInvoice[];
  posts: number;
  /** Pannes à déclencher sur les prochains appels. */
  fail: {
    post?: "network" | "reject" | "server";
    confirm?: "network" | "unknown-uid";
    totalOffset?: number;
    down?: boolean;
  };
  addStrayPending(): string;
  close(): Promise<void>;
}

const RATES: Record<string, number> = { A: 0, B: 18, C: 0, D: 18, E: 0, F: 0 };
const pad = (n: number) => String(n).padStart(2, "0");
const frDateTime = (d = new Date()) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export async function startEmecfMock(opts: { token?: string; ifu?: string; port?: number } = {}): Promise<EmecfMock> {
  const mock: EmecfMock = {
    url: "",
    token: opts.token ?? "jeton-dgi-de-test-0123456789abcdefghijklmnop",
    ifu: opts.ifu ?? "0201710155848",
    nim: "ED01000123",
    invoices: [],
    posts: 0,
    fail: {},
    addStrayPending() {
      const uid = crypto.randomUUID();
      mock.invoices.push({ uid, body: {}, total: 0, state: "pending", date: frDateTime() });
      return uid;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
  let counter = 0;

  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (mock.fail.down) {
        req.socket.destroy();
        return;
      }
      if (req.headers.authorization !== `Bearer ${mock.token}`) return send(401, { message: "Unauthorized" });
      const path = (req.url ?? "/").replace(/^\/api\/invoice/, "") || "/";

      if (req.method === "GET" && path === "/") {
        const pending = mock.invoices.filter((i) => i.state === "pending");
        return send(200, {
          status: true,
          version: "1.0",
          ifu: mock.ifu,
          nim: mock.nim,
          tokenValid: "2027-12-31T23:59:59",
          serverDateTime: new Date().toISOString(),
          pendingRequestsCount: pending.length,
          pendingRequestsList: pending.map((i) => ({ date: i.date, uid: i.uid })),
        });
      }

      if (req.method === "POST" && path === "/") {
        mock.posts++;
        const f = mock.fail.post;
        mock.fail.post = undefined;
        if (f === "network") return req.socket.destroy();
        if (f === "server") return send(500, { message: "boom" });
        const body = JSON.parse(raw || "{}");
        if (f === "reject") return send(200, { uid: null, errorCode: "3", errorDesc: "Le groupe de taxe de l'article 1 est invalide" });
        if (body.ifu !== mock.ifu) return send(200, { uid: null, errorCode: "1", errorDesc: "IFU vendeur invalide" });
        if ((body.type === "FA" || body.type === "EA") && !/^[A-Z0-9]{24}$/.test(body.reference ?? "")) {
          return send(200, { uid: null, errorCode: "4", errorDesc: "Référence de l'avoir invalide" });
        }
        if (mock.invoices.filter((i) => i.state === "pending").length >= 10) return send(200, { uid: null, errorCode: "20", errorDesc: "Trop de factures en attente" });
        const per: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
        for (const it of body.items ?? []) {
          if (!(it.taxGroup in RATES)) return send(200, { uid: null, errorCode: "3", errorDesc: "Groupe de taxe invalide" });
          per[it.taxGroup] += Math.round(it.price * it.quantity);
        }
        const hab = Math.round(per.B / 1.18);
        const had = Math.round(per.D / 1.18);
        const aib = body.aib === "A" ? Math.round((hab + had) * 0.01) : body.aib === "B" ? Math.round((hab + had) * 0.05) : 0;
        const total = Object.values(per).reduce((s, v) => s + v, 0) + aib + (mock.fail.totalOffset ?? 0);
        mock.fail.totalOffset = undefined;
        const uid = crypto.randomUUID();
        mock.invoices.push({ uid, body, total, state: "pending", date: frDateTime() });
        return send(200, {
          uid,
          ta: 0, tb: 18, tc: 0, td: 18,
          taa: per.A, tab: per.B, tac: per.C, tad: per.D, tae: per.E, taf: per.F,
          hab, had, vab: per.B - hab, vad: per.D - had, aib, ts: 0, total,
        });
      }

      const m = /^\/([0-9a-f-]{36})\/(confirm|cancel)$/.exec(path);
      if (req.method === "PUT" && m) {
        const inv = mock.invoices.find((i) => i.uid === m[1]);
        if (m[2] === "confirm" && mock.fail.confirm) {
          const f = mock.fail.confirm;
          mock.fail.confirm = undefined;
          if (f === "network") return req.socket.destroy();
          return send(200, { errorCode: "11", errorDesc: "Transaction introuvable ou expirée" });
        }
        if (!inv || inv.state !== "pending") return send(200, { errorCode: "11", errorDesc: "Transaction introuvable ou déjà finalisée" });
        if (m[2] === "cancel") {
          inv.state = "cancelled";
          return send(200, { dateTime: frDateTime(), qrCode: "", codeMECeFDGI: "", counters: `${counter}/${counter} ${inv.body.type ?? "FV"}`, nim: mock.nim });
        }
        counter++;
        inv.state = "confirmed";
        const letters = crypto.randomBytes(20).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24).padEnd(24, "X");
        inv.code = letters.match(/.{4}/g)!.join("-").slice(0, 29);
        const d = new Date();
        return send(200, {
          dateTime: frDateTime(d),
          qrCode: `F;${mock.nim};${letters};${mock.ifu};${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
          codeMECeFDGI: inv.code,
          counters: `${counter}/${counter} ${inv.body.type}`,
          nim: mock.nim,
        });
      }
      send(404, { message: "Not found" });
    });
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  mock.url = `http://127.0.0.1:${port}/api/invoice`;
  return mock;
}
