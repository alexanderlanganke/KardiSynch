
import { parseBostonScientificPdf } from './src/main/parsers/boston-scientific-parser';

const rawText = `LATITUDE™ Programming System   Bericht erstel. 02 Nov 2025  QUICK NOTES ® Bericht  Meyer, Helmut   Letzte Abfrage in der Praxis  Geburtsdatum   25 Sep 1952   18 Jun 2025  Aggregat   CHARISMA EL ICD D321/ 245447   Dat. Implant.  Tachy-Modus   Überw.+Therapie   4 Mär 2025  © 2025  Boston Scientific Corporation  oder seine Zweigorganisationen. Alle Rechte vorbehalten.  3868 Software-Version: 2.03 D321 Firmware Version: H_v1.00.00(1,01)  Seite   1 von 2  Signatur Klinik(er):  Meine Warnungen  02 Nov 2025 08:16   Überprüfen Atrial Elektrode  Ereignisse seit letztem Reset (18 Jun 2025)  02 Nov 2025 08:40   RYTHMIQ bei 57 min¯¹ 01 Nov 2025 23:39   VF bei 282 min¯¹,   ATPx1, 41J Liste aller Ereignisse seit letztem Reset siehe letzte Seite.  Batterie   OK  Ungefähre Zeit bis zur Explantation:   12 Jahre Ladezeit   10,5 s Letzte Kondensator Reformierung   01 Nov 2025 23:40   Ein Jahr verbleibend Explantieren  Elektrodendaten   Implantation   Vorh. Sitzung   Letzte  4 Mär 2025  Atrial  Intrins.Ampl.   K.A   mV   1,8   mV   4,0   mV  Stimulation-Impedanz   K.A   Ω   620   Ω   719   Ω  Stim.-Reizschwelle   K.A V @ K.A   ms   0,6 V @ 0,4 ms   0,7 V @ 0,4 ms  Ventrikulär  Intrins.Ampl.   K.A   mV   11,4   mV   15,6 mV@59   min¯¹  Stimulation-Impedanz   K.A   Ω   522   Ω   485   Ω  Stim.-Reizschwelle   K.A V @ K.A   ms   2,5 V @ 0,4 ms   2,3 V @ 0,4 ms  Schockvektor  Schock-Impedanz   K.A   Ω   83   Ω   84   Ω  Brady-Zähler seit letztem Reset (18 Jun 2025) Zähler  Atrial   75 % stimuliert  Ventrikulär   10 % stimuliert  Atriale Arrhythmie  % AT/AF   0  Einstellungen Ventrikuläre Tachy-Einstellungen  VF   250   min¯¹   ATP   41J, 41J, 41Jx6  VT   190   min¯¹   Burst   Ramp   41J, 41J, 41Jx4  VT-1   155   min¯¹   Nur Überwachung  Atriale Tachy-Einstellungen  ATR Mode Switch 170 min¯¹ DDIR  Brady-Einstellungen  Modus   DDDR RYTHMIQ™   Aus Untere Grenzfrequenz   60 min¯¹ Max. Trackingfrequenz   140 min¯¹ Maximale Sensorfrequenz   130 min¯¹ AV-Verzög. Stim.   150 - 180 ms AV-Verzög. Detekt.   125 - 150 ms A-Refraktärzeit (PVARP)   240 - 280 ms V-Refraktärzeit (VRP)   210 - 250 ms Stimulationsenergie Atrial   Auto 2,0 V @ 0,4ms Ventrikulär   Auto 5,0 V @ 0,4ms Empfindlichkeit Atrial   AGC 0,25 mV Ventrikulär   AGC 0,6 mV Elektrodenkonfiguration (Stimulation/Detektion) Atrial   Bipolar Ventrikulär   Bipolar  Alle Ereignisse seit letztem Reset (18 Jun 2025)  02 Nov 2025 08:40   RYTHMIQ bei 57 min¯¹ 02 Nov 2025 08:37   RYTHMIQ bei 60 min¯¹ 02 Nov 2025 08:36   RYTHMIQ bei 56 min¯¹ 02 Nov 2025 08:34   RYTHMIQ bei 62 min¯¹ 02 Nov 2025 08:32   RYTHMIQ bei 60 min¯¹ 02 Nov 2025 08:03   RYTHMIQ bei 56 min¯¹ 02 Nov 2025 08:01   RYTHMIQ bei 56 min¯¹`;

console.log("Testing Boston Scientific Parser with Latitude format...");
const report = parseBostonScientificPdf(rawText);

console.log("\n--- Parsed Report ---");
console.log(JSON.stringify(report, null, 2));

if (report.patient.last_name === 'Meyer' && report.patient.first_name === 'Helmut') {
    console.log("SUCCESS: Name extracted.");
} else {
    console.error(`FAIL: Name extraction failed. Got: ${report.patient.last_name}, ${report.patient.first_name}`);
}

if (report.patient.dob === '1952-09-25') {
    console.log("SUCCESS: DOB extracted.");
} else {
    console.error(`FAIL: DOB extraction failed. Got: ${report.patient.dob}`);
}

if (report.interrogation_date === '2025-11-02') {
    console.log("SUCCESS: Date extracted.");
} else {
    console.error(`FAIL: Date extraction failed. Got: ${report.interrogation_date}`);
}
