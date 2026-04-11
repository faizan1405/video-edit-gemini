import fs from "node:fs/promises";

export async function ensureDir(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function writeJson(filePath, value) {
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
