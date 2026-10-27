// 本机加密存储：IndexedDB + WebCrypto（AES-GCM）。
// 主密钥随机产生，用 PIN 派生的密钥包起来；改 PIN 只需重新包主密钥。

const DB_NAME = 'pb';
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITER_PIN = 200000;
const ITER_FILE = 250000;
const MAGIC = 'PBK1';

let db = null;
let masterKey = null;

function idb() {
  if (db) return Promise.resolve(db);
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta');
      r.result.createObjectStore('blob');
    };
    r.onsuccess = () => { db = r.result; res(db); };
    r.onerror = () => rej(r.error);
  });
}

function tx(store, mode, fn) {
  return idb().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

const metaGet = k => tx('meta', 'readonly', s => s.get(k));
const metaPut = (k, v) => tx('meta', 'readwrite', s => s.put(v, k));
const blobGetRaw = k => tx('blob', 'readonly', s => s.get(k));
const blobPutRaw = (k, v) => tx('blob', 'readwrite', s => s.put(v, k));
export const blobKeys = () => tx('blob', 'readonly', s => s.getAllKeys());
export const blobDelete = k => tx('blob', 'readwrite', s => s.delete(k));

async function deriveKey(pass, salt, iter, usages) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, usages);
}

const rand = n => crypto.getRandomValues(new Uint8Array(n));

export async function isSetUp() {
  return !!(await metaGet('wrap'));
}

export async function setup(pin) {
  const raw = rand(32);
  const salt = rand(16), iv = rand(12);
  const k = await deriveKey(pin, salt, ITER_PIN, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
  await metaPut('wrap', { salt, iv, data: new Uint8Array(wrapped) });
  masterKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
}

export async function unlock(pin) {
  const w = await metaGet('wrap');
  const k = await deriveKey(pin, w.salt, ITER_PIN, ['decrypt']);
  try {
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.iv }, k, w.data);
    masterKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return true;
  } catch { return false; }
}

export async function changePin(oldPin, newPin) {
  const w = await metaGet('wrap');
  const k = await deriveKey(oldPin, w.salt, ITER_PIN, ['decrypt']);
  let raw;
  try { raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: w.iv }, k, w.data); }
  catch { return false; }
  const salt = rand(16), iv = rand(12);
  const k2 = await deriveKey(newPin, salt, ITER_PIN, ['encrypt']);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k2, raw);
  await metaPut('wrap', { salt, iv, data: new Uint8Array(wrapped) });
  return true;
}

export function lock() { masterKey = null; }
export const unlocked = () => !!masterKey;

export async function putBytes(key, bytes) {
  const iv = rand(12);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, masterKey, bytes);
  await blobPutRaw(key, { iv, data: new Uint8Array(data) });
}

export async function getBytes(key) {
  const r = await blobGetRaw(key);
  if (!r) return null;
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv }, masterKey, r.data));
}

export const putJSON = (key, obj) => putBytes(key, enc.encode(JSON.stringify(obj)));
export async function getJSON(key) {
  const b = await getBytes(key);
  return b ? JSON.parse(dec.decode(b)) : null;
}

// —— 文件容器（内容包／图片包／备份），格式与 build_pack.py 相同 ——

export async function openFile(buf, pass) {
  const u = new Uint8Array(buf);
  if (dec.decode(u.slice(0, 4)) !== MAGIC) throw new Error('不是内容包文件');
  const salt = u.slice(4, 20), iv = u.slice(20, 32);
  const k = await deriveKey(pass, salt, ITER_FILE, ['decrypt']);
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, u.slice(32))); }
  catch { throw new Error('口令不对'); }
  const hlen = new DataView(plain.buffer).getUint32(0, true);
  const header = JSON.parse(dec.decode(plain.subarray(4, 4 + hlen)));
  const body = plain.subarray(4 + hlen);
  const files = (header.files || []).map(f => ({ ...f, bytes: body.subarray(f.off, f.off + f.len) }));
  return { header, files };
}

export async function makeFile(header, pass) {
  const h = enc.encode(JSON.stringify(header));
  const plain = new Uint8Array(4 + h.length);
  new DataView(plain.buffer).setUint32(0, h.length, true);
  plain.set(h, 4);
  const salt = rand(16), iv = rand(12);
  const k = await deriveKey(pass, salt, ITER_FILE, ['encrypt']);
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, plain));
  const out = new Uint8Array(32 + c.length);
  out.set(enc.encode(MAGIC), 0); out.set(salt, 4); out.set(iv, 20); out.set(c, 32);
  return out;
}

export async function wipeAll() {
  masterKey = null;
  if (db) { db.close(); db = null; }
  await new Promise(res => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => res(); });
}
