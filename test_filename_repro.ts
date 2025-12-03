
import { extractStructuredData } from './src/main/utils/pdf-utils';

const filename = "Prosuntsov,_Mikhail-RSQ608449S-SmartSyncPKG-27_Nov_2025_14_17_29_584.pkg";
const text = "Some dummy text content";

console.log(`Testing filename: ${filename}`);
const report = extractStructuredData(text, filename);

console.log("Extracted Report:", JSON.stringify(report, null, 2));

if (report.patient.last_name === "Prosuntsov" && report.patient.first_name === "Mikhail") {
    console.log("SUCCESS: Name parsed correctly");
} else {
    console.log("FAILURE: Name NOT parsed correctly");
}

if (report.interrogation_date.startsWith("2025-11-27")) {
    console.log("SUCCESS: Date parsed correctly");
} else {
    console.log("FAILURE: Date NOT parsed correctly");
}
