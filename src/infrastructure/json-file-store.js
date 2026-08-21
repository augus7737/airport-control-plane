import { copyFile, open, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createFileWriteQueue() {
  let tail = Promise.resolve();

  return function enqueueWrite(writeOperation) {
    const run = tail.then(writeOperation, writeOperation);
    tail = run.catch(() => {});
    return run;
  };
}

export async function atomicWriteJson(filePath, payload, options = {}) {
  const directory = path.dirname(filePath);
  const baseName = path.basename(filePath);
  const tmpPath = path.join(
    directory,
    `.${baseName}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  const backupPath = `${filePath}.bak`;
  const body = `${JSON.stringify(payload, null, 2)}\n`;

  await writeFile(tmpPath, body, "utf8");

  const handle = await open(tmpPath, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }

  if (options.createBackup !== false) {
    try {
      await copyFile(filePath, backupPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  await rename(tmpPath, filePath);

  try {
    const dirHandle = await open(directory, "r");
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Directory fsync is not supported on every platform. The file has already
    // been written and renamed; skip this best-effort durability step.
  }
}

export async function readJsonWithBackup(filePath, options = {}) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) {
      throw error;
    }

    const backupPath = `${filePath}.bak`;
    const backupPayload = JSON.parse(await readFile(backupPath, "utf8"));
    if (options.restore !== false) {
      await atomicWriteJson(filePath, backupPayload, { createBackup: false });
    }
    return backupPayload;
  }
}

export function isMissingFileError(error) {
  return Boolean(error) && typeof error === "object" && error.code === "ENOENT";
}
