// PROPX · Government Real Estate Data Layer — caching & historical snapshots.
//
// Two concerns, one interface:
//   · cache(key)     — short-lived response cache so repeated queries do not
//                      hammer government endpoints;
//   · snapshot(key)  — append-only, timestamped copies of normalized payloads
//                      so PROPX can detect when source data CHANGES over time
//                      (a payload is snapshotted only when its content hash
//                      differs from the latest stored snapshot).
//
// MemoryStore  — default everywhere (Vercel lambdas are ephemeral; the cache
//                still de-duplicates calls within a warm instance).
// FileStore    — for the sync CLI / any long-lived host: persists under
//                data/gov/snapshots/<key>/<ISO-ts>.json plus latest.json.
// Additional backends (Vercel KV, S3, a database) implement the same four
// methods and plug in without touching providers or analytics.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const hashOf = (obj) => createHash('sha1').update(JSON.stringify(obj)).digest('hex');
const safeKey = (k) => String(k).replace(/[^a-zA-Z0-9א-ת._-]+/g, '_').slice(0, 120);

class MemoryStore {
  constructor() { this.cacheMap = new Map(); this.snaps = new Map(); }

  cacheGet(key, maxAgeMs) {
    const hit = this.cacheMap.get(key);
    if (!hit) return null;
    if (maxAgeMs && Date.now() - hit.at > maxAgeMs) return null;
    return hit.payload;
  }
  cacheSet(key, payload) { this.cacheMap.set(key, { at: Date.now(), payload }); }

  /** Returns {changed, hash, previousHash} and stores when changed. */
  snapshot(key, payload) {
    const h = hashOf(payload);
    const list = this.snaps.get(key) || [];
    const prev = list[list.length - 1];
    if (prev && prev.hash === h) return { changed: false, hash: h, previousHash: h };
    list.push({ at: new Date().toISOString(), hash: h, payload });
    this.snaps.set(key, list);
    return { changed: true, hash: h, previousHash: prev ? prev.hash : null };
  }
  history(key) { return (this.snaps.get(key) || []).map(({ at, hash }) => ({ at, hash })); }
}

class FileStore {
  constructor(rootDir) { this.root = rootDir; this.mem = new MemoryStore(); }

  cacheGet(key, maxAgeMs) { return this.mem.cacheGet(key, maxAgeMs); }
  cacheSet(key, payload) { this.mem.cacheSet(key, payload); }

  dirFor(key) { return path.join(this.root, safeKey(key)); }

  snapshot(key, payload) {
    const dir = this.dirFor(key);
    fs.mkdirSync(dir, { recursive: true });
    const h = hashOf(payload);
    const latestPath = path.join(dir, 'latest.json');
    let prevHash = null;
    if (fs.existsSync(latestPath)) {
      try { prevHash = JSON.parse(fs.readFileSync(latestPath, 'utf8')).hash; } catch { /* rebuild below */ }
    }
    if (prevHash === h) return { changed: false, hash: h, previousHash: h };
    const at = new Date().toISOString();
    const doc = { at, hash: h, payload };
    // hash suffix keeps same-millisecond snapshots from colliding on one filename
    fs.writeFileSync(path.join(dir, at.replace(/[:.]/g, '-') + '-' + h.slice(0, 8) + '.json'), JSON.stringify(doc, null, 1));
    fs.writeFileSync(latestPath, JSON.stringify(doc, null, 1));
    return { changed: true, hash: h, previousHash: prevHash };
  }

  history(key) {
    const dir = this.dirFor(key);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && f !== 'latest.json')
      .sort()
      .map((f) => {
        const { at, hash } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        return { at, hash, file: path.join(dir, f) };
      });
  }
}

module.exports = { MemoryStore, FileStore, hashOf };
