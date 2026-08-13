import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
    initPendingSort,
    enqueuePendingSort,
    listPendingSortTasks,
    removeFilesFromTask,
} from '../services/pendingSortService';

// Companion files that arrive together (a PDF + its logfile, a multi-PDF
// Boston Scientific export, a duplicated Sorin raw-data export) must land in
// ONE pending-sort task with per-file preview/intraop data, not one task per
// file (#156, #157, #158).
describe('pendingSortService batching (#156, #157, #158)', () => {
    let root: string;
    let staging: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'kardisynch-pendingsort-'));
        staging = await fs.mkdtemp(path.join(os.tmpdir(), 'kardisynch-staging-'));
        await initPendingSort(root);
    });

    const writeStagedFile = async (name: string) => {
        const p = path.join(staging, name);
        await fs.writeFile(p, `content of ${name}`);
        return p;
    };

    it('groups multiple entries into a single task with per-file previewData/isIntraop', async () => {
        const pdfPath = await writeStagedFile('report.pdf');
        const logPath = await writeStagedFile('report.log');

        const task = await enqueuePendingSort([
            { sourcePath: pdfPath, previewData: { patientName: 'Doe John', serial: 'ABC123' }, isIntraop: false },
            { sourcePath: logPath, previewData: { patientName: 'Doe John', serial: 'ABC123' }, isIntraop: true },
        ], { sessionId: 'session-1' });

        expect(task.files.sort()).toEqual(['report.log', 'report.pdf']);
        expect(task.previewData['report.pdf'].serial).toBe('ABC123');
        expect(task.previewData['report.log'].patientName).toBe('Doe John');
        expect(task.isIntraop['report.pdf']).toBe(false);
        expect(task.isIntraop['report.log']).toBe(true);

        // Exactly one task in the queue, not two.
        expect(listPendingSortTasks().length).toBe(1);
    });

    it('dedupes colliding basenames and keeps previewData keyed to the final name', async () => {
        const a = await writeStagedFile('duplicate-name.pdf');
        const bDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kardisynch-staging2-'));
        const b = path.join(bDir, 'duplicate-name.pdf');
        await fs.writeFile(b, 'second file with the same basename');

        const task = await enqueuePendingSort([
            { sourcePath: a, previewData: { serial: 'FIRST' } },
            { sourcePath: b, previewData: { serial: 'SECOND' } },
        ], {});

        expect(task.files.length).toBe(2);
        const previews = task.files.map(f => task.previewData[f].serial).sort();
        expect(previews).toEqual(['FIRST', 'SECOND']);
    });

    it('leaves the task in the queue with only the unprocessed file(s) after a partial resolve', async () => {
        const pdfPath = await writeStagedFile('a.pdf');
        const logPath = await writeStagedFile('a.log');
        const task = await enqueuePendingSort([
            { sourcePath: pdfPath, previewData: {} },
            { sourcePath: logPath, previewData: {} },
        ], {});

        // Simulate resolving just one of the two files (e.g. the user
        // deselected the other in the sorting dialog).
        await removeFilesFromTask(task.id, ['a.pdf']);

        const remaining = listPendingSortTasks();
        expect(remaining.length).toBe(1);
        expect(remaining[0].files).toEqual(['a.log']);
        expect(remaining[0].previewData['a.log']).toBeDefined();
        expect(remaining[0].previewData['a.pdf']).toBeUndefined();
    });

    it('migrates a legacy single-file task (flat previewData / boolean isIntraop) on init', async () => {
        // Simulate a task.json persisted by a pre-#158 build: previewData was a
        // single object and isIntraop a plain boolean, both scoped to the
        // task's one file.
        const legacyDir = path.join(root, 'legacy-task-id');
        await fs.mkdir(legacyDir, { recursive: true });
        await fs.writeFile(path.join(legacyDir, 'old.pdf'), 'legacy file');
        await fs.writeFile(path.join(root, 'tasks.json'), JSON.stringify([
            {
                id: 'legacy-task-id',
                createdAt: new Date().toISOString(),
                dir: legacyDir,
                files: ['old.pdf'],
                previewData: { patientName: 'Legacy Patient', serial: 'LEGACY1' },
                isIntraop: true,
            },
        ]));

        // Re-init against the same root to trigger the reconcile/migration path.
        await initPendingSort(root);
        const tasks = listPendingSortTasks();
        expect(tasks.length).toBe(1);
        expect(tasks[0].previewData['old.pdf'].serial).toBe('LEGACY1');
        expect(tasks[0].isIntraop['old.pdf']).toBe(true);
    });
});
