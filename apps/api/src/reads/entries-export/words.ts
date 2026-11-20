import type { CancellationReasonCode } from "@routiq/contracts";

export type ExportLanguage = "fr" | "en";

/**
 * The export's words, written on the server because the file leaves the app.
 * The same wording as the web's fr.json / en.json (finance.entries.*), so a
 * cashier reads the same status in the file as on the screen.
 */
export interface ExportWords {
  sheets: { entries: string; books: string; check: string };
  columns: {
    date: string;
    number: string;
    vehicle: string;
    trip: string;
    category: string;
    description: string;
    type: string;
    amount: string;
    currency: string;
    inTotals: string;
    status: string;
    cancellationReason: string;
    recordedBy: string;
    approvedBy: string;
    period: string;
    cancelsEntry: string;
    cancelledByEntry: string;
    countsInTotals: string;
  };
  direction: { EXPENSE: string; REVENUE: string };
  status: { SUBMITTED: string; POSTED: string; REJECTED: string; REVERSED: string };
  cancelledIn: (month: string) => string;
  cancellationOf: (entryNumber: string) => string;
  cancellation: string;
  reasons: Record<Exclude<CancellationReasonCode, "OTHER">, string>;
  yes: string;
  no: string;
  platformActor: string;
  check: {
    title: string;
    company: string;
    list: string;
    allEntries: string;
    vehicle: (code: string) => string;
    period: string;
    postingPeriod: (month: string) => string;
    economicMonth: (month: string) => string;
    allTime: string;
    branch: string;
    allBranches: string;
    filters: string;
    noFilter: string;
    statusFilter: (status: string) => string;
    directionFilter: (direction: string) => string;
    missingReceipt: string;
    ownEntries: string;
    exportedOn: string;
    currency: string;
    routiq: string;
    entriesSheet: string;
    booksSheet: string;
    matches: string;
    expenses: string;
    revenue: string;
    net: string;
    matchesRoutiq: string;
    notCounted: string;
    readOnly: string;
  };
  ledgerStatus: string;
  months: readonly string[];
  /** Excel's own date format, with the locale so month names follow the reader. */
  dateFormat: string;
  fileList: string;
  fileAllTime: string;
}

const fr: ExportWords = {
  sheets: { entries: "Écritures", books: "Grand livre", check: "Contrôle" },
  columns: {
    date: "Date",
    number: "N°",
    vehicle: "Véhicule",
    trip: "Trajet",
    category: "Catégorie",
    description: "Description",
    type: "Type",
    amount: "Montant",
    currency: "Devise",
    inTotals: "Compte dans les totaux",
    status: "Statut",
    cancellationReason: "Motif d'annulation",
    recordedBy: "Saisie par",
    approvedBy: "Approuvée par",
    period: "Période comptable",
    cancelsEntry: "Annule l'écriture",
    cancelledByEntry: "Annulée par l'écriture",
    countsInTotals: "Compte dans les totaux",
  },
  direction: { EXPENSE: "Dépense", REVENUE: "Recette" },
  status: {
    SUBMITTED: "En attente d'examen",
    POSTED: "Comptabilisée",
    REJECTED: "Rejetée",
    REVERSED: "Annulée",
  },
  cancelledIn: (month) => `Annulée en ${month}`,
  cancellationOf: (entryNumber) => `Annulation de l'écriture ${entryNumber}`,
  cancellation: "Annulation",
  reasons: {
    ENTERED_TWICE: "Saisie en double",
    DID_NOT_HAPPEN: "N'a pas eu lieu",
    WRONG_DETAILS: "Mauvais détails, à ressaisir",
  },
  yes: "oui",
  no: "non",
  platformActor: "ROUTIQ",
  check: {
    title: "Contrôle des totaux",
    company: "Entreprise",
    list: "Liste",
    allEntries: "Écritures",
    vehicle: (code) => `Véhicule ${code}`,
    period: "Période",
    postingPeriod: (month) => `Période comptable : ${month}`,
    economicMonth: (month) => `Datées de ${month}`,
    allTime: "Toutes les périodes",
    branch: "Agence",
    allBranches: "Toutes vos agences",
    filters: "Filtres",
    noFilter: "Aucun",
    statusFilter: (status) => `Statut : ${status}`,
    directionFilter: (direction) => `Type : ${direction}`,
    missingReceipt: "Justificatif manquant",
    ownEntries: "Vos écritures uniquement",
    exportedOn: "Exporté le",
    currency: "Devise",
    routiq: "ROUTIQ",
    entriesSheet: "Feuille Écritures",
    booksSheet: "Feuille Grand livre",
    matches: "Concorde",
    expenses: "Dépenses",
    revenue: "Recettes",
    net: "Résultat net",
    matchesRoutiq: "Concorde avec ROUTIQ",
    notCounted: "Les écritures en attente d'examen ou rejetées ne comptent pas dans les totaux.",
    readOnly:
      "Ce fichier sert à lire et à vérifier. Une modification ici ne revient jamais dans ROUTIQ : corrigez dans l'application.",
  },
  ledgerStatus: "Comptabilisées et annulées",
  months: [
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
  ],
  dateFormat: "[$-40C]d mmmm yyyy",
  fileList: "ecritures",
  fileAllTime: "tout",
};

const en: ExportWords = {
  sheets: { entries: "Entries", books: "Books", check: "Check" },
  columns: {
    date: "Date",
    number: "No.",
    vehicle: "Vehicle",
    trip: "Trip",
    category: "Category",
    description: "Description",
    type: "Type",
    amount: "Amount",
    currency: "Currency",
    inTotals: "Counts in totals",
    status: "Status",
    cancellationReason: "Cancellation reason",
    recordedBy: "Recorded by",
    approvedBy: "Approved by",
    period: "Posting period",
    cancelsEntry: "Cancels entry",
    cancelledByEntry: "Cancelled by entry",
    countsInTotals: "Counts in totals",
  },
  direction: { EXPENSE: "Expense", REVENUE: "Revenue" },
  status: {
    SUBMITTED: "Awaiting review",
    POSTED: "Posted",
    REJECTED: "Rejected",
    REVERSED: "Cancelled",
  },
  cancelledIn: (month) => `Cancelled in ${month}`,
  cancellationOf: (entryNumber) => `Cancellation of entry ${entryNumber}`,
  cancellation: "Cancellation",
  reasons: {
    ENTERED_TWICE: "Entered twice",
    DID_NOT_HAPPEN: "Didn't happen",
    WRONG_DETAILS: "Wrong details, to record again",
  },
  yes: "yes",
  no: "no",
  platformActor: "ROUTIQ",
  check: {
    title: "Totals check",
    company: "Company",
    list: "List",
    allEntries: "Entries",
    vehicle: (code) => `Vehicle ${code}`,
    period: "Period",
    postingPeriod: (month) => `Posting period: ${month}`,
    economicMonth: (month) => `Dated ${month}`,
    allTime: "All periods",
    branch: "Branch",
    allBranches: "All your branches",
    filters: "Filters",
    noFilter: "None",
    statusFilter: (status) => `Status: ${status}`,
    directionFilter: (direction) => `Type: ${direction}`,
    missingReceipt: "Missing receipt",
    ownEntries: "Your own entries only",
    exportedOn: "Exported on",
    currency: "Currency",
    routiq: "ROUTIQ",
    entriesSheet: "Entries sheet",
    booksSheet: "Books sheet",
    matches: "Matches",
    expenses: "Expenses",
    revenue: "Revenue",
    net: "Net",
    matchesRoutiq: "Matches ROUTIQ",
    notCounted: "Entries awaiting review or rejected do not count in the totals.",
    readOnly:
      "This file is for reading and checking. Changes made here never go back into ROUTIQ: correct them in the app.",
  },
  ledgerStatus: "Posted and cancelled",
  months: [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ],
  dateFormat: "[$-809]d mmmm yyyy",
  fileList: "entries",
  fileAllTime: "all",
};

export const EXPORT_WORDS: Record<ExportLanguage, ExportWords> = { fr, en };

/** "septembre 2026" for `2026-09`. */
export function monthName(words: ExportWords, month: string): string {
  const [year, monthNumber] = month.split("-");
  return `${words.months[Number(monthNumber) - 1] ?? month} ${year}`;
}
