"use strict";
// The data migration's reader thread (utils/migration/readerPool.js): unpacks and parses uploaded
// lists off the server's main thread, so a school's 50 MB export never holds up anyone's page.
const os = require("os");
const zlib = require("zlib");
const crypto = require("crypto");
const { parentPort } = require("worker_threads");
const reader = require("./reader");

// On Linux a thread's priority is its own: this one gives way to the threads serving pages.
if (process.platform === "linux") { try { os.setPriority(0, 10); } catch (_e) { /* not allowed: runs at normal priority */ } }

parentPort.on("message", async ({ id, op, content, compressed, name }) => {
  try {
    const buf = Buffer.from(content.buffer, content.byteOffset, content.byteLength);
    if (op === "expand") {
      const raw = compressed ? zlib.gunzipSync(buf) : buf;
      const lists = await reader.expand(name, raw);
      const out = lists.map((list) => {
        if (list.document) return { name: list.name, path: list.path, document: true, note: list.note || null, content: list.content };
        if (list.error) return { name: list.name, error: list.error, skipped: Boolean(list.skipped) };
        const bytes = Buffer.from(list.text, "utf8");
        const gz = zlib.gzipSync(bytes, { level: 6 });
        return {
          name: list.name, header: list.header, rowCount: list.rowCount, cut: list.cut, sample: list.sample,
          size: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), gz,
        };
      });
      // Copied, not transferred: a small Buffer can share its memory with others.
      parentPort.postMessage({ id, type: "done", value: out });
      return;
    }
    if (op === "rows") {
      for (const chunk of reader.rowChunks(buf, compressed)) parentPort.postMessage({ id, type: "chunk", value: chunk });
      parentPort.postMessage({ id, type: "done" });
      return;
    }
    throw new Error(`Unknown reader task: ${op}`);
  } catch (error) {
    parentPort.postMessage({ id, type: "error", message: error.message });
  }
});
