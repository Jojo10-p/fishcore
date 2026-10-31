/**
 * Seed de base (production & dev) : rôles, permissions, super-admin, modèles d'emails, FAQ de processus.
 * Aucune offre commerciale n'est créée : taux et montants doivent être saisis par un administrateur.
 *
 * SEED_DEMO=true ajoute des données de DÉMONSTRATION clairement marquées (isDemo / préfixe [DÉMO]),
 * à n'utiliser qu'en développement.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { PERMISSIONS, DEFAULT_ROLES } from "../src/lib/permissions";

const schema = process.env.DATABASE_SCHEMA || undefined;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, schema ? { schema } : undefined) });

const EMAIL_TEMPLATES = [
  {
    key: "welcome",
    name: "Bienvenue — création de compte",
    subject: "Bienvenue sur {{orgName}}",
    body: "Bonjour {{firstName}},\n\nVotre espace client a bien été créé. Vous pouvez y suivre vos demandes et transmettre vos justificatifs en toute sécurité.\n\n{{appUrl}}/espace\n\nL'équipe {{orgName}}",
    variables: ["firstName", "orgName", "appUrl"],
  },
  {
    key: "application_received",
    name: "Confirmation de dépôt de demande",
    subject: "Demande {{reference}} bien reçue",
    body: "Bonjour {{firstName}},\n\nNous avons bien reçu votre demande de financement {{reference}} ({{productName}}, {{amount}} sur {{duration}} mois).\n\nUn analyste va l'étudier ; vous serez informé(e) de chaque étape dans votre espace client :\n{{appUrl}}/espace/demandes/{{applicationId}}\n\nRappel : la simulation fournie est indicative et ne constitue pas une offre de crédit.\n\nL'équipe {{orgName}}",
    variables: ["firstName", "reference", "productName", "amount", "duration", "applicationId"],
  },
  {
    key: "application_admin_alert",
    name: "Alerte interne — nouvelle demande",
    subject: "[Nouvelle demande] {{reference}} — {{customerName}}",
    body: "Nouvelle demande déposée.\n\nRéférence : {{reference}}\nClient : {{customerName}}\nOffre : {{productName}}\nMontant : {{amount}} sur {{duration}} mois\n\n{{appUrl}}/admin/demandes/{{applicationId}}",
    variables: ["reference", "customerName", "productName", "amount", "duration", "applicationId"],
  },
  {
    key: "status_changed",
    name: "Changement de statut",
    subject: "Votre demande {{reference}} : {{status}}",
    body: "Bonjour {{firstName}},\n\nLe statut de votre demande {{reference}} est désormais : {{status}}.\n\n{{comment}}\n\nDétails : {{appUrl}}/espace/demandes/{{applicationId}}\n\nL'équipe {{orgName}}",
    variables: ["firstName", "reference", "status", "comment", "applicationId"],
  },
  {
    key: "documents_requested",
    name: "Demande de pièces complémentaires",
    subject: "Pièce complémentaire demandée — {{reference}}",
    body: "Bonjour {{firstName}},\n\nPour poursuivre l'étude de votre demande {{reference}}, nous avons besoin du document suivant : {{label}}.\n\n{{message}}\n\nVous pouvez le transmettre de façon sécurisée depuis votre espace :\n{{appUrl}}/espace/demandes/{{applicationId}}\n\nL'équipe {{orgName}}",
    variables: ["firstName", "reference", "label", "message", "applicationId"],
  },
  {
    key: "ticket_reply",
    name: "Réponse de l'assistance",
    subject: "Réponse à votre demande d'assistance {{reference}}",
    body: "Bonjour {{firstName}},\n\nNotre équipe a répondu à votre demande « {{subject}} ».\n\nConsultez la réponse : {{appUrl}}/espace/assistance/{{ticketId}}\n\nL'équipe {{orgName}}",
    variables: ["firstName", "reference", "subject", "ticketId"],
  },
  {
    key: "password_reset",
    name: "Réinitialisation du mot de passe",
    subject: "Réinitialisation de votre mot de passe",
    body: "Bonjour {{firstName}},\n\nPour définir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n{{resetUrl}}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nL'équipe {{orgName}}",
    variables: ["firstName", "resetUrl"],
  },
  {
    key: "contact_admin_alert",
    name: "Alerte interne — message de contact",
    subject: "[Contact] {{subject}}",
    body: "Nouveau message de {{name}} ({{email}}).\n\n{{message}}\n\n{{appUrl}}/admin/messages",
    variables: ["name", "email", "subject", "message"],
  },
];

const FAQ = [
  { category: "Demande", question: "Combien de temps faut-il pour déposer une demande ?", answer: "Comptez environ 15 minutes si vous avez vos justificatifs à portée de main. Le formulaire est découpé en cinq étapes et vous pouvez revenir en arrière à tout moment." },
  { category: "Demande", question: "Quels documents dois-je fournir ?", answer: "La liste dépend de l'offre choisie ; elle est affichée sur chaque offre. En général : une pièce d'identité, un justificatif de revenus et un justificatif de domicile. Formats acceptés : PDF, JPG, PNG ou WEBP, 8 Mo maximum par fichier." },
  { category: "Simulation", question: "La simulation m'engage-t-elle ?", answer: "Non. La simulation est indicative et ne constitue pas une offre de crédit. Les conditions définitives dépendent de l'étude de votre dossier." },
  { category: "Simulation", question: "Comment la mensualité est-elle calculée ?", answer: "Nous utilisons la méthode d'amortissement à mensualités constantes, à partir du taux publié de l'offre. Les frais de dossier et l'assurance sont ajoutés lorsqu'ils s'appliquent, afin d'afficher le coût total." },
  { category: "Suivi", question: "Comment suivre l'avancement de mon dossier ?", answer: "Depuis votre espace client : chaque changement de statut est daté, et les éventuels commentaires de l'analyste ou demandes de pièces complémentaires y apparaissent." },
  { category: "Sécurité", question: "Mes documents sont-ils protégés ?", answer: "Oui. Les justificatifs sont stockés dans un espace privé, non accessible publiquement, et consultables uniquement par vous et par les membres habilités de l'équipe. Chaque consultation est journalisée." },
  { category: "Sécurité", question: "Me demanderez-vous un paiement pour débloquer un financement ?", answer: "Jamais. Aucun versement n'est demandé pour étudier une demande ou débloquer des fonds. Si quelqu'un vous sollicite en notre nom pour un paiement, contactez-nous immédiatement." },
];

async function main() {
  console.log("→ Permissions et rôles");
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { label: meta.label, group: meta.group }, create: { key, label: meta.label, group: meta.group } });
  }
  for (const r of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { key: r.key },
      update: { name: r.name, description: r.description },
      create: { key: r.key, name: r.name, description: r.description, isSystem: true, permissions: { connect: r.permissions.map((key) => ({ key })) } },
    });
  }
  // Le super-admin reçoit toujours toutes les permissions (y compris les nouvelles).
  await db.role.update({ where: { key: "super_admin" }, data: { permissions: { set: Object.keys(PERMISSIONS).map((key) => ({ key })) } } });

  console.log("→ Super-administrateur");
  const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
  const password = process.env.SEED_ADMIN_PASSWORD ?? "";
  if (!email || password.length < 12) throw new Error("SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD (12 caractères min.) sont requis.");
  const superRole = await db.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  const existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    await db.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12), firstName: "Super", lastName: "Admin", type: "STAFF", roleId: superRole.id } });
    console.log(`  créé : ${email}`);
  } else console.log(`  existe déjà : ${email}`);

  console.log("→ Modèles d'emails");
  for (const t of EMAIL_TEMPLATES) {
    await db.emailTemplate.upsert({ where: { key_locale: { key: t.key, locale: "fr" } }, update: {}, create: { ...t, locale: "fr" } });
  }

  console.log("→ FAQ de processus");
  if ((await db.faq.count()) === 0) {
    await db.faq.createMany({ data: FAQ.map((f, i) => ({ ...f, locale: "fr", sortOrder: i })) });
  }

  if (process.env.SEED_DEMO === "true") await seedDemo();
  console.log("✓ Seed terminé");
}

async function seedDemo() {
  if (process.env.NODE_ENV === "production") throw new Error("Données de démonstration interdites en production.");
  console.log("→ Données de DÉMONSTRATION (dev uniquement)");
  const demoProducts = [
    { slug: "demo-credit-personnel", name: "[DÉMO] Crédit personnel", category: "PERSONAL" as const, tagline: "Pour vos projets du quotidien", minAmount: 1000, maxAmount: 50000, minDurationMonths: 6, maxDurationMonths: 84, annualRate: 5.9, feesFixed: 0, feesPercent: 1, insuranceRate: 0.3, docs: ["identity", "income", "address"] },
    { slug: "demo-credit-pro", name: "[DÉMO] Crédit professionnel", category: "PROFESSIONAL" as const, tagline: "Trésorerie et équipement", minAmount: 5000, maxAmount: 250000, minDurationMonths: 12, maxDurationMonths: 120, annualRate: 6.4, feesFixed: 150, feesPercent: 0.5, insuranceRate: 0, docs: ["identity", "business", "bank"] },
    { slug: "demo-financement-projet", name: "[DÉMO] Financement de projet", category: "PROJECT" as const, tagline: "Lancer ou développer une activité", minAmount: 10000, maxAmount: 500000, minDurationMonths: 24, maxDurationMonths: 180, annualRate: 7.1, feesFixed: 300, feesPercent: 0, insuranceRate: 0.25, docs: ["identity", "project", "income"] },
  ];
  const DOC_LABELS: Record<string, string> = { identity: "Pièce d'identité", income: "Justificatif de revenus", address: "Justificatif de domicile", bank: "Relevés bancaires (3 mois)", business: "Extrait d'immatriculation", project: "Présentation du projet" };
  for (const [i, p] of demoProducts.entries()) {
    const { docs, ...data } = p;
    await db.loanProduct.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...data,
        description: "Offre fictive créée par le seed de démonstration. Remplacez-la par vos offres réelles depuis le back-office.",
        eligibility: ["Être majeur", "Disposer de revenus réguliers", "Données de démonstration"],
        requiredDocuments: docs.map((key) => ({ key, label: DOC_LABELS[key], required: true })),
        isActive: true,
        sortOrder: i,
      },
    });
  }
  const products = await db.loanProduct.findMany({ where: { slug: { startsWith: "demo-" } } });
  const statuses = ["NEW", "UNDER_REVIEW", "MISSING_DOCUMENTS", "ON_HOLD", "APPROVED", "REJECTED", "CLOSED"] as const;
  const names = [["Awa", "Koffi"], ["Lucas", "Martin"], ["Inès", "Benali"], ["Moussa", "Diallo"], ["Sophie", "Laurent"], ["Kevin", "Mensah"], ["Clara", "Dubois"], ["Yanis", "Haddad"]];
  const pass = await bcrypt.hash("Demo-Client-2026", 12);
  for (const [i, [first, last]] of names.entries()) {
    const email = `demo.${first.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}@example.com`;
    if (await db.user.findUnique({ where: { email } })) continue;
    const user = await db.user.create({ data: { email, passwordHash: pass, firstName: first, lastName: last, type: "CUSTOMER" } });
    const customer = await db.customer.create({
      data: { userId: user.id, firstName: first, lastName: last, email, phone: "+00 000 000 000", country: "Démo", city: "Démo", address: "Adresse fictive", profession: "Démo", employmentStatus: "Salarié(e)", monthlyIncome: 2500 + i * 300, monthlyCharges: 600, isDemo: true },
    });
    const product = products[i % products.length];
    const status = statuses[i % statuses.length];
    const amount = Number(product.minAmount) * (2 + i);
    const createdAt = new Date(Date.now() - (i * 9 + 2) * 24 * 3600 * 1000);
    await db.loanApplication.create({
      data: {
        reference: `DEMO-${String(1000 + i)}`,
        customerId: customer.id,
        productId: product.id,
        amount,
        durationMonths: Math.min(product.maxDurationMonths, 36),
        purpose: "Projet de démonstration",
        description: "Demande fictive générée pour le développement.",
        status,
        termsSnapshot: { annualRate: Number(product.annualRate), productName: product.name },
        applicantSnapshot: { firstName: first, lastName: last, email },
        consentTermsAt: createdAt,
        consentDataAt: createdAt,
        isDemo: true,
        createdAt,
        statusHistory: { create: [{ toStatus: "NEW", createdAt }, ...(status !== "NEW" ? [{ fromStatus: "NEW" as const, toStatus: status, publicComment: "Mise à jour de démonstration." }] : [])] },
      },
    });
  }
  console.log("  Clients démo : demo.<prenom>@example.com / Demo-Client-2026");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
