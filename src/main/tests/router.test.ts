// src/main/tests/router.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { routeFiles } from '../router';
import * as parser from '../parser';
import * as pdfMerger from '../pdf-merger';

vi.mock('fs');
vi.mock('../parser');
vi.mock('../pdf-merger');

describe('routeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process a directory with a BNK file and matching PDFs', async () => {
    const directoryPath = '/test-dir';
    const files = ['test.bnk', 'test1.pdf', 'test2.pdf'];
    const bnkData = {
      patient: { first_name: 'John', last_name: 'Doe' },
      // ... other report data
    };
    const pdfText1 = 'John Doe';
    const pdfText2 = 'John Doe';
    const mergedPdf = new Uint8Array([1, 2, 3]);

    (fs.readdirSync as vi.Mock).mockReturnValue(files);
    (parser.parseFile as vi.Mock).mockResolvedValue(bnkData);
    (pdfMerger.extractTextFromPdf as vi.Mock)
      .mockResolvedValueOnce(pdfText1)
      .mockResolvedValueOnce(pdfText2);
    (pdfMerger.verifyPdfMatch as vi.Mock).mockReturnValue(true);
    (pdfMerger.mergePdfs as vi.Mock).mockResolvedValue(mergedPdf);

    await routeFiles(directoryPath);

    expect(parser.parseFile).toHaveBeenCalledWith(path.join(directoryPath, 'test.bnk'));
    expect(pdfMerger.extractTextFromPdf).toHaveBeenCalledWith(path.join(directoryPath, 'test1.pdf'));
    expect(pdfMerger.extractTextFromPdf).toHaveBeenCalledWith(path.join(directoryPath, 'test2.pdf'));
    expect(pdfMerger.verifyPdfMatch).toHaveBeenCalledTimes(2);
    expect(pdfMerger.mergePdfs).toHaveBeenCalledWith([
      path.join(directoryPath, 'test1.pdf'),
      path.join(directoryPath, 'test2.pdf'),
    ]);
    expect(fs.writeFileSync).toHaveBeenCalledWith(path.join(directoryPath, 'merged.pdf'), mergedPdf);
  });
});
