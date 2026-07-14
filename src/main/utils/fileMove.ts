import fs from 'fs/promises';
import path from 'path';

/**
 * Moves a file, handling cross-device moves (EXDEV) by falling back to
 * copy + verify-size + unlink. The source is only deleted after the copy has
 * been verified, so a failed cross-device move can never lose the file.
 */
export const moveFileSafe = async (src: string, dest: string): Promise<void> => {
  try {
    await fs.rename(src, dest);
  } catch (error: any) {
    if (error.code === 'EXDEV') {
      await fs.copyFile(src, dest);
      const [srcStats, destStats] = await Promise.all([fs.stat(src), fs.stat(dest)]);
      if (destStats.size !== srcStats.size) {
        throw new Error(`Cross-device copy verification failed for ${src} (expected ${srcStats.size} bytes, got ${destStats.size})`);
      }
      await fs.unlink(src);
    } else {
      throw error;
    }
  }
};

/**
 * Returns destPath unchanged if nothing exists there, otherwise appends
 * _1, _2, ... before the extension until a free name is found. Prevents
 * silent overwrite when moving files into a shared directory.
 */
export const uniqueDestPath = async (destPath: string): Promise<string> => {
  const exists = (p: string) => fs.access(p).then(() => true).catch(() => false);
  if (!(await exists(destPath))) return destPath;

  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${base}_${i}${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  return path.join(dir, `${base}_${Date.now()}${ext}`);
};
