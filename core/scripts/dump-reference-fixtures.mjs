#!/usr/bin/env node
// Regenerates the KMP port's fixture-cross-validation test data by running
// the ORIGINAL, still-canonical TypeScript parsers (from the Electron app's
// compiled build) against the real local sample exports in `test/`, and
// dumping their output as JSON.
//
// These JSON fixtures are gitignored (see .gitignore: "Same policy for the
// KMP port's fixture-validation test data") because — like the real sample
// exports they're derived from — they carry extracted patient/device
// fields and raw-text dumps that must never be committed, anonymized or
// not. Run this once locally before running the desktopTest fixture tests;
// each Kotlin *FixtureTest fails with a clear "not found on the test
// classpath" message if you haven't.
//
// Prerequisites: `npm run build:main` in the repo root (produces
// dist/main/parsers/*.js) — this script imports the compiled output
// directly rather than re-implementing TS parsing itself.
//
// Usage: node core/scripts/dump-reference-fixtures.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..'); // core/scripts -> core -> repo root
const testDir = path.join(repoRoot, 'test');
const outDir = path.join(scriptDir, '..', 'src', 'desktopTest', 'resources');
fs.mkdirSync(outDir, { recursive: true });

const { parseMedtronicPdd } = await import(path.join(repoRoot, 'dist/main/parsers/medtronic-parser.js'));
const { parseBiotronikXML } = await import(path.join(repoRoot, 'dist/main/parsers/biotronik-parser.js'));
const { parseMicroportXML } = await import(path.join(repoRoot, 'dist/main/parsers/microport-parser.js'));

async function dumpBinaryDir(subdir, outFile, parseFn) {
    const dir = path.join(testDir, subdir);
    const files = fs.readdirSync(dir).filter(f => !f.startsWith('.'));
    const results = {};
    for (const f of files) {
        try {
            results[f] = await parseFn(path.join(dir, f));
        } catch (e) {
            results[f] = { error: String(e) };
        }
    }
    fs.writeFileSync(path.join(outDir, outFile), JSON.stringify(results, null, 2));
    console.log(`${outFile}: dumped ${files.length} file(s) from ${subdir}`);
}

async function dumpXmlDir(subdir, outFile, parseFn) {
    const dir = path.join(testDir, subdir);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
    const results = {};
    for (const f of files) {
        try {
            const xml = fs.readFileSync(path.join(dir, f), 'utf-8');
            results[f] = await parseFn(xml);
        } catch (e) {
            results[f] = { error: String(e) };
        }
    }
    fs.writeFileSync(path.join(outDir, outFile), JSON.stringify(results, null, 2));
    console.log(`${outFile}: dumped ${files.length} file(s) from ${subdir}`);
}

await dumpBinaryDir('medtronic pdd files', 'medtronic-pdd-fixtures.json', parseMedtronicPdd);
await dumpXmlDir('Biotronik xml', 'biotronik-fixtures.json', parseBiotronikXML);
await dumpXmlDir('microport xml', 'microport-fixtures.json', parseMicroportXML);
