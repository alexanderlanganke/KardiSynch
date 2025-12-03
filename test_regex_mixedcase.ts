
import { extractStructuredData } from './src/main/utils/pdf-utils';

const filename = "f9b8b2dd-db25-46b3-b4bc-e12b5b317152_7e7c9122-b8fc-482b-84da-70e83b6cbfe1_Prosuntsov,_Mikhail-RSQ608449S-SmartSyncPDF-27_Nov_2025_14_18_16_112.pdf";
const text = ""; // Simulate empty text from failed PDF parse

console.log(`Testing filename: ${filename}`);
const report = extractStructuredData(text, filename);

console.log("Extracted Report:", JSON.stringify(report, null, 2));

if (report.patient.last_name === "Prosuntsov" && report.patient.first_name === "Mikhail") {
    console.log("SUCCESS: Name parsed correctly");
} else {
    console.log("FAILURE: Name NOT parsed correctly");
}
