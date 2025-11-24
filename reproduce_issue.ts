
import { parseBostonScientificPdf } from './src/main/parsers/boston-scientific-parser';

const rawText = `Diagnostik  Stim.   A/L V/BiV/CR T   [%]   0   /   92   /   3   /   94  A triale   Arrh ythmielast   [%]   97.3  Episoden  Neue   Episoden   VF/VT/andere   ----   /   ----   /   5  Batteriespannung   [V]   3.18  Batterie-R estkapazit├ñt   [%]   100  Ladezustand   BOS  Progr amm   Nr .   6  Home   Monitoring   EIN  MR T -Progr amm   A US  Patient  Name   Sepulv eda   Santana,   Andy  Letzte   Nachsorge   30.10.2025  Implantation   30.10.2025  T ach ykardiedetektion   Aktiv  Implantatstatus  Modus/`;

console.log("Testing Boston Scientific Parser with captured log text...");
const report = parseBostonScientificPdf(rawText);

console.log("\n--- Parsed Report ---");
console.log(JSON.stringify(report, null, 2));

if (!report.patient.last_name || !report.interrogation_date) {
    console.error("\nFAIL: Failed to extract critical information (Name or Date).");
} else {
    console.log("\nSUCCESS: Extracted critical information.");
}
