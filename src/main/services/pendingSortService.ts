import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Pending manual-sort queue (issue #136).
 *
 * Imported files that can't be auto-matched used to block the watcher while a
 * modal was force-opened in the renderer. That stalls the whole app when many
 * files need sorting (e.g. a Boston Scientific batch). Instead, each unmatched
 * item is staged into its own temp dir and recorded here as a pending task. The
 * renderer surfaces the queue in the notification area and the user resolves
 * tasks on demand — sort, dismiss, or move the whole task to the unmatched dir.
 *
 * Data safety: a task's files are MOVED into its own dir on enqueue and never
 * deleted except on an explicit, user-confirmed dismiss. Tasks survive app
 * restarts (persisted to tasks.json) and are reconciled on init so a task whose
 * files have vanished is dropped rather than left dangling.
 */

export interface PendingSortTask {
  id: string;
  createdAt: string;
  dir: string;          // absolute per-task directory holding the staged file(s)
  files: string[];      // basenames within `dir`
  previewData: any;     // metadata for the sorting dialog (patient/device/date preview)
  isIntraop: boolean;   // preserves intraoperative origin through the queue
  sessionId?: string;   // originating import session, for history correlation
}

let rootDir = '';
let stateFile = '';
let tasks: PendingSortTask[] = [];
let initialized = false;

/** Move a file, falling back to copy+unlink across devices (EXDEV). */
const moveFile = async (src: string, dest: string): Promise<void> => {
  try {
    await fs.rename(src, dest);
  } catch (err: any) {
    if (err.code === 'EXDEV') {
      await fs.copyFile(src, dest);
      // The staged copy is complete at this point — a failed source unlink
      // must not fail the enqueue, or the staged file would be stranded in an
      // untracked task dir. Warn and leave the leftover source behind.
      try {
        await fs.unlink(src);
      } catch (unlinkErr: any) {
        console.warn(`[PendingSort] Staged ${src} but could not remove the source (leftover may be re-detected):`, unlinkErr.message);
      }
    } else {
      throw err;
    }
  }
};

const persist = async (): Promise<void> => {
  if (!stateFile) return;
  try {
    await fs.writeFile(stateFile, JSON.stringify(tasks, null, 2), 'utf-8');
  } catch (e) {
    console.error('[PendingSort] Failed to persist tasks:', e);
  }
};

/**
 * Initialize the queue against a root directory. Loads persisted tasks and
 * reconciles them against disk (drops tasks whose dir is gone/empty).
 */
export const initPendingSort = async (pendingRootDir: string): Promise<void> => {
  rootDir = pendingRootDir;
  stateFile = path.join(rootDir, 'tasks.json');
  await fs.mkdir(rootDir, { recursive: true });

  let loaded: PendingSortTask[] = [];
  try {
    const raw = await fs.readFile(stateFile, 'utf-8');
    loaded = JSON.parse(raw);
    if (!Array.isArray(loaded)) loaded = [];
  } catch (e: any) {
    if (e.code !== 'ENOENT') console.error('[PendingSort] Failed to read tasks.json:', e);
    loaded = [];
  }

  // Reconcile against disk: keep only tasks whose dir still holds files.
  const reconciled: PendingSortTask[] = [];
  for (const t of loaded) {
    try {
      const present = await fs.readdir(t.dir);
      const files = present.filter(f => t.files.includes(f));
      if (files.length > 0) {
        reconciled.push({ ...t, files });
      } else {
        console.warn(`[PendingSort] Dropping task ${t.id} — no files left in ${t.dir}`);
        await fs.rm(t.dir, { recursive: true, force: true }).catch(() => {});
      }
    } catch {
      console.warn(`[PendingSort] Dropping task ${t.id} — dir missing: ${t.dir}`);
    }
  }
  tasks = reconciled;
  initialized = true;
  await persist();
  console.log(`[PendingSort] Initialized with ${tasks.length} pending task(s) in ${rootDir}`);
};

export const isPendingSortReady = (): boolean => initialized;

/**
 * Renderer-facing task list. Includes absolute `filePaths` so the renderer can
 * preview a staged file without reconstructing OS-specific paths itself.
 */
export const listPendingSortTasks = (): (PendingSortTask & { filePaths: string[] })[] =>
  tasks.map(t => ({ ...t, filePaths: t.files.map(f => path.join(t.dir, f)) }));

export const getPendingSortTask = (id: string): PendingSortTask | undefined =>
  tasks.find(t => t.id === id);

/**
 * Stage one or more files (typically a single file, or a report + its sidecars)
 * into a new per-task dir and record the task. Returns the created task.
 */
export const enqueuePendingSort = async (
  sourcePaths: string[],
  opts: { previewData: any; isIntraop?: boolean; sessionId?: string }
): Promise<PendingSortTask> => {
  if (!initialized) throw new Error('PendingSort not initialized');
  const id = uuidv4();
  const dir = path.join(rootDir, id);
  await fs.mkdir(dir, { recursive: true });

  const files: string[] = [];
  try {
    for (const src of sourcePaths) {
      // Recover a clean, human-readable original name. Staged files are named
      // `[INTRAOP__]<uuid>_<original>` by the watcher, so strip the INTRAOP__
      // prefix and the leading UUID — otherwise the 36-char id dominates the name
      // shown in the sorting queue and overflows the notification panel.
      const baseName = path.basename(src)
        .replace(/^INTRAOP__/, '')
        .replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}_/, '');
      let dest = path.join(dir, baseName);
      // Guard against collisions within the same task.
      if (files.includes(baseName)) {
        dest = path.join(dir, `${uuidv4().slice(0, 8)}_${baseName}`);
      }
      await moveFile(src, dest);
      files.push(path.basename(dest));
    }
  } catch (err) {
    // Durability: never leave already-staged files untracked. If some files
    // made it into the task dir before the failure, record them as a task so
    // init/reconcile and the UI can still see them; otherwise clean up the
    // empty dir. The error still propagates so the caller can handle the
    // file(s) that were NOT staged.
    if (files.length > 0) {
      const partial: PendingSortTask = {
        id,
        createdAt: new Date().toISOString(),
        dir,
        files,
        previewData: opts.previewData ?? {},
        isIntraop: !!opts.isIntraop,
        sessionId: opts.sessionId,
      };
      tasks.unshift(partial);
      await persist();
      console.error(`[PendingSort] Enqueue of task ${id} failed after staging ${files.length} file(s); recorded partial task.`, err);
    } else {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }

  const task: PendingSortTask = {
    id,
    createdAt: new Date().toISOString(),
    dir,
    files,
    previewData: opts.previewData ?? {},
    isIntraop: !!opts.isIntraop,
    sessionId: opts.sessionId,
  };
  tasks.unshift(task);
  await persist();
  console.log(`[PendingSort] Enqueued task ${id} with ${files.length} file(s).`);
  return task;
};

/**
 * Absolute paths of a task's staged files, in stored order.
 */
export const pendingSortTaskFilePaths = (task: PendingSortTask): string[] =>
  task.files.map(f => path.join(task.dir, f));

/**
 * Remove a task from the queue. When `deleteDir` is true the staged files are
 * deleted from disk (used for dismiss). When false the caller is responsible
 * for having already moved the files out (sort / move-to-unmatched).
 */
export const removePendingSortTask = async (id: string, deleteDir: boolean): Promise<void> => {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  tasks = tasks.filter(t => t.id !== id);
  if (deleteDir) {
    await fs.rm(task.dir, { recursive: true, force: true }).catch(e =>
      console.error(`[PendingSort] Failed to delete task dir ${task.dir}:`, e));
  } else {
    // Best-effort cleanup of the now-empty task dir.
    await fs.rmdir(task.dir).catch(() => {});
  }
  await persist();
};

/**
 * Drop specific already-handled files from a task without touching the rest.
 * Used when a task's files are processed one at a time and only some of them
 * succeed (e.g. a resolve-pending-sort batch where one file's storeFile call
 * fails mid-batch): the succeeded files were already moved out of `task.dir`
 * by the caller, so this just updates the queue's bookkeeping to match.
 *
 * If dropping `processedBasenames` empties the task's file list, the task is
 * removed entirely, the same way `removePendingSortTask` does for a clean
 * resolve. Since the caller already moved every processed file out of
 * `task.dir`, the dir should be empty at that point — this only ever does a
 * non-recursive `rmdir`, never a recursive delete, so a directory that turns
 * out NOT to be empty surfaces as a logged error (a real bug: files left
 * behind untracked) instead of being silently swept away.
 */
export const removeFilesFromTask = async (taskId: string, processedBasenames: string[]): Promise<void> => {
  const task = tasks.find(t => t.id === taskId);
  if (!task) return;

  const remaining = task.files.filter(f => !processedBasenames.includes(f));
  if (remaining.length === 0) {
    tasks = tasks.filter(t => t.id !== taskId);
    await fs.rmdir(task.dir).catch(e =>
      console.error(`[PendingSort] Task ${taskId} dir ${task.dir} was not empty after all its files were processed — leaving it in place for inspection:`, e));
  } else {
    task.files = remaining;
  }
  await persist();
};
