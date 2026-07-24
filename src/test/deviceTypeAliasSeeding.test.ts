import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, closeDatabase, setSettings } from '../main/database';
import { seedDeviceTypeAliases, listAliases, setLeadAlias, lookupLeadAlias } from '../main/deviceTypeAliases';

vi.mock('electron', () => ({
    app: {
        getPath: () => '/tmp/kardisynch_test_data'
    }
}));

describe('device type alias seeding (#153 follow-up)', () => {
    const testDbPath = ':memory:';
    const testDataPath = path.join(__dirname, 'test_data_alias_seed');

    beforeEach(async () => {
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
        fs.mkdirSync(testDataPath);
        await initializeDatabase(testDbPath);
        await setSettings({ dataPath: testDataPath });
    });

    afterEach(async () => {
        await closeDatabase();
        if (fs.existsSync(testDataPath)) fs.rmSync(testDataPath, { recursive: true, force: true });
    });

    it('populates device_types.xml with unverified lead-connector entries on a fresh dataPath', async () => {
        const result = await seedDeviceTypeAliases();
        expect(result.added).toBeGreaterThan(0);

        const aliases = await listAliases();
        const sprintQuattro = aliases.find(a => a.kind === 'lead' && a.manufacturer === 'Medtronic' && a.model === '6935');
        expect(sprintQuattro).toBeDefined();
        expect(sprintQuattro?.connector).toBe('DF-1');
        expect(sprintQuattro?.verified).toBe(false);
    });

    it('is idempotent — running it twice does not create duplicate entries', async () => {
        await seedDeviceTypeAliases();
        const first = await listAliases();

        const second = await seedDeviceTypeAliases();
        expect(second.added).toBe(0);

        const after = await listAliases();
        expect(after.length).toBe(first.length);
    });

    it('never overwrites a clinician-confirmed entry for the same model, even if it disagrees with the seed', async () => {
        // Clinician manually recorded something different from what the seed
        // table would suggest for this exact model.
        await setLeadAlias('Medtronic', '6935', { connector: 'IS-1' });

        await seedDeviceTypeAliases();

        const alias = await lookupLeadAlias('Medtronic', '6935');
        expect(alias?.connector).toBe('IS-1');

        const aliases = await listAliases();
        const matches = aliases.filter(a => a.kind === 'lead' && a.manufacturer === 'Medtronic' && a.model === '6935');
        expect(matches.length).toBe(1);
        expect(matches[0].verified).toBe(true);
    });

    it('produces no duplicate (kind, manufacturer, model) entries across the whole seed set', async () => {
        await seedDeviceTypeAliases();
        const aliases = await listAliases();
        const keys = aliases.map(a => `${a.kind ?? 'device'}|${a.manufacturer.toLowerCase()}|${a.model.toLowerCase()}`);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('confirming a seeded lead via setLeadAlias marks it verified and keeps its LV role', async () => {
        await seedDeviceTypeAliases();
        // Medtronic 4194 (Attain) is seeded as an IS-1 LV lead.
        let aliases = await listAliases();
        const seeded = aliases.find(a => a.kind === 'lead' && a.manufacturer === 'Medtronic' && a.model === '4194');
        expect(seeded?.verified).toBe(false);
        expect(seeded?.role).toBe('LV');

        await setLeadAlias('Medtronic', '4194', { connector: 'IS-1' });

        aliases = await listAliases();
        const confirmed = aliases.find(a => a.kind === 'lead' && a.manufacturer === 'Medtronic' && a.model === '4194');
        expect(confirmed?.verified).toBe(true);
        expect(confirmed?.role).toBe('LV');
    });
});
