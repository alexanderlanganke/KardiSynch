
import { extractStructuredData } from './src/main/utils/pdf-utils';

const testCases = [
    {
        text: "Patientenidentifikation: NA, enaktivität", // Simulating the bad match
        expectedName: null, // Should NOT match "enaktivität, NA" or similar
        description: "False positive: Patientenidentifikation"
    },
    {
        text: "Software, Medtronic Application",
        expectedName: null,
        description: "False positive: Software, Medtronic"
    },
    {
        text: "Name des Arztes, des", // Simulating "Arztes, des"
        expectedName: null,
        description: "False positive: Name des Arztes"
    },
    {
        text: "Geburtsdatum: 15.05.1950",
        expectedDOB: "1950-05-15",
        description: "German DOB format"
    },
    {
        text: "Patient: Mustermann, Max",
        expectedName: { last: "Mustermann", first: "Max" },
        description: "Valid Name: Mustermann, Max"
    }
];

console.log("Running parsing tests...");

testCases.forEach(test => {
    console.log(`\n--- Test: ${test.description} ---`);
    const report = extractStructuredData(test.text, "dummy.pdf");

    // Check Name
    if (test.expectedName === null) {
        if (report.patient.last_name === 'Unknown' || report.patient.last_name === '') {
            console.log("SUCCESS: No invalid name extracted.");
        } else {
            console.log(`FAILURE: Extracted invalid name: '${report.patient.last_name}, ${report.patient.first_name}'`);
        }
    } else if (test.expectedName) {
        if (report.patient.last_name === test.expectedName.last && report.patient.first_name === test.expectedName.first) {
            console.log("SUCCESS: Name extracted correctly.");
        } else {
            console.log(`FAILURE: Expected '${test.expectedName.last}, ${test.expectedName.first}', got '${report.patient.last_name}, ${report.patient.first_name}'`);
        }
    }

    // Check DOB
    if (test.expectedDOB) {
        if (report.patient.dob === test.expectedDOB) {
            console.log("SUCCESS: DOB extracted correctly.");
        } else {
            console.log(`FAILURE: Expected DOB '${test.expectedDOB}', got '${report.patient.dob}'`);
        }
    }
});
