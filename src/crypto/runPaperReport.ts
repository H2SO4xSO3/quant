import { loadCryptoBotConfig } from "./config";
import { CryptoJournal } from "./journal";
import { resolvePaperJournalPath } from "./paperPaths";
import { buildPaperReport, formatPaperReport } from "./paperReport";

function parseWindowHours(value: string | undefined): number {
  const parsed = Number(value ?? 24);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

const config = loadCryptoBotConfig();
const windowHours = parseWindowHours(process.argv[2]);
const journal = new CryptoJournal(resolvePaperJournalPath());
const report = buildPaperReport(journal.read().entries, {
  initialCapitalUsdt: config.backtestInitialCapitalUsdt,
  windowHours
});

console.log(formatPaperReport(report));
