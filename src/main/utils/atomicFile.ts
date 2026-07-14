import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * Atomic file-write helpers.
 *
 * A plain writeFile that is interrupted (crash, power loss) leaves a truncated
 * file behind — for patient.xml / visit.xml that means silently losing the
 * on-disk source of truth, and for settings.json it means the config resets to
 * {} on next read. Writing to a temp file in the SAME directory and renaming it
 * over the target is atomic on POSIX and effectively atomic on NTFS.
 *
 * The temp name starts with "." so directory scanners that skip dotfiles
 * (e.g. the import watcher) never pick up a half-written file.
 */
const tempName = (filePath: string): string =>
  path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );

export const writeFileAtomic = async (filePath: string, data: string | Buffer): Promise<void> => {
  const tmp = tempName(filePath);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, filePath);
  } catch (error) {
    await fs.unlink(tmp).catch(() => {});
    throw error;
  }
};

export const writeFileAtomicSync = (filePath: string, data: string | Buffer): void => {
  const tmp = tempName(filePath);
  try {
    fsSync.writeFileSync(tmp, data);
    fsSync.renameSync(tmp, filePath);
  } catch (error) {
    try { fsSync.unlinkSync(tmp); } catch { /* noop */ }
    throw error;
  }
};
