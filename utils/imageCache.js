"use strict";

// Pictures the app shows on every page (a school's logo, a profile photo) are kept after the first
// read, in memory and in the server's temp folder, so a slow or broken connection to storage never
// shows a broken image: the next request is answered from here. Only small pictures are kept.
// Callers check who may see a picture BEFORE asking here; this only holds bytes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { BoundedMap } = require("./boundedMap");

const MAX_BYTES = 2 * 1024 * 1024;       // one picture
const MEMORY_BUDGET = 24 * 1024 * 1024;  // all pictures held in memory
const DISK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const dir = path.join(os.tmpdir(), "managira-images");

const memory = new BoundedMap(400);
let memoryBytes = 0;

const fileFor = (key) => path.join(dir, crypto.createHash("sha1").update(String(key)).digest("hex"));

function remember(key, entry) {
  const old = memory.get(key);
  if (old) memoryBytes -= old.body.length;
  memory.set(key, entry);
  memoryBytes += entry.body.length;
  if (memoryBytes > MEMORY_BUDGET) { memory.clear(); memoryBytes = 0; memory.set(key, entry); memoryBytes = entry.body.length; }
}

async function get(key) {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const file = fileFor(key);
    const stat = await fs.promises.stat(file);
    if (Date.now() - stat.mtimeMs > DISK_MAX_AGE_MS) return null;
    const raw = await fs.promises.readFile(file);
    const split = raw.indexOf(10); // first line: the content type
    if (split < 1) return null;
    const entry = { type: raw.subarray(0, split).toString("utf8"), body: raw.subarray(split + 1) };
    remember(key, entry);
    return entry;
  } catch (_) {
    return null;
  }
}

async function set(key, type, body) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_BYTES || !/^image\//.test(String(type || ""))) return false;
  remember(key, { type, body });
  try {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = fileFor(key);
    const temp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(temp, Buffer.concat([Buffer.from(`${type}\n`), body]), { mode: 0o600 });
    await fs.promises.rename(temp, file);
  } catch (_) { /* the memory copy still works */ }
  return true;
}

module.exports = { get, set, MAX_BYTES };
