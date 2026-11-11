/*!
 * Special Owner — QR core (UMD: browser global `SOQR`, Node `require`).
 *
 * One file shared by the resident app (generates), the edge controllers (verify,
 * also offline) and any server-side helper, so the two sides can never drift apart.
 *
 * Token families
 *   SO1D.<b64url>   Resident dynamic token. Changes every 30 s.
 *                   header(11) = ver(1) | credId(6) | step(4, big-endian)
 *                   body  (20) = AES-256-GCM( code(4) | flags(1) | 000 ) + 96-bit tag
 *                   Per credential secret S (256 bit) → everything is derived with HMAC-SHA256:
 *                     totpKey = HMAC(S, "SO1/totp" | credId)                (RFC 6238 key)
 *                     encKey  = HMAC(S, "SO1/enc"  | credId | step)         (AES-256 key, new every step)
 *                     iv      = HMAC(S, "SO1/iv"   | credId | step)[0..12)
 *                   code = HOTP-SHA256(totpKey, step, 8 digits)  → must equal the decrypted code.
 *                   The header is authenticated as GCM additional data.
 *   SO1P.<b64url>   Guest / courier / maintenance / master pass: passId(12) | secret(16).
 *                   Only SHA-256(secret) is stored server side; window, uses and scope live in the pass record.
 *
 * Key sealing (so Firestore never holds a usable secret): the phone encrypts S to the site's
 * ECDH P-256 public key (ECIES-style: ephemeral ECDH → HKDF-SHA256 → AES-256-GCM). Only the
 * edge controllers hold the matching private key.
 */
(function (root, factory) {
  var c = (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) ? globalThis.crypto : null;
  if (!c && typeof require === "function") c = require("node:crypto").webcrypto;
  var api = factory(c);
  if (typeof module === "object" && module.exports) module.exports = api; else root.SOQR = api;
})(typeof self !== "undefined" ? self : this, function (crypto) {
  "use strict";
  var subtle = crypto.subtle;
  var te = new TextEncoder();

  var VERSION = 1;
  var STEP_SECONDS = 30;
  var DEFAULT_WINDOW = 1;           // accept ±1 step (±30 s) of clock difference
  var DIGITS = 8;
  var PREFIX_DYN = "SO1D.", PREFIX_PASS = "SO1P.";

  // ---------- byte helpers ----------
  function randomBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
  function concat() {
    var len = 0, i; for (i = 0; i < arguments.length; i++) len += arguments[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < arguments.length; i++) { out.set(arguments[i], o); o += arguments[i].length; }
    return out;
  }
  function u32be(n) { return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255); }
  function u64be(n) { var hi = Math.floor(n / 4294967296), lo = n >>> 0; return concat(u32be(hi >>> 0), u32be(lo)); }
  function readU32(b, o) { return ((b[o] * 16777216) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]) >>> 0; }
  function b64u(bytes) {
    var s = ""; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64u(str) {
    if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str)) throw new Error("bad base64url");
    var s = str.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(bytes) { var s = ""; for (var i = 0; i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); return s; }
  function equalBytes(a, b) {            // constant-time for equal lengths
    if (a.length !== b.length) return false;
    var d = 0; for (var i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function str(s) { return te.encode(s); }

  // ---------- primitives ----------
  async function sha256(bytes) { return new Uint8Array(await subtle.digest("SHA-256", bytes)); }

  async function hmacRaw(keyBytes, data, hash) {
    var k = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: hash || "SHA-256" }, false, ["sign"]);
    return new Uint8Array(await subtle.sign("HMAC", k, data));
  }

  // RFC 4226 / 6238 dynamic truncation. `hash` = SHA-1 | SHA-256 | SHA-512.
  async function hotp(keyBytes, counter, digits, hash) {
    var mac = await hmacRaw(keyBytes, u64be(counter), hash || "SHA-256");
    var off = mac[mac.length - 1] & 15;
    var bin = ((mac[off] & 0x7f) * 16777216) + (mac[off + 1] << 16) + (mac[off + 2] << 8) + mac[off + 3];
    var mod = Math.pow(10, digits || DIGITS);
    return bin % mod;
  }
  async function totp(keyBytes, unixSeconds, opts) {
    opts = opts || {};
    var step = opts.step || STEP_SECONDS;
    return hotp(keyBytes, Math.floor(unixSeconds / step), opts.digits || DIGITS, opts.hash || "SHA-256");
  }

  // A key handle hides whether the secret is raw bytes (edge) or a non-extractable CryptoKey (phone).
  async function keyHandle(secret) {
    var k = secret instanceof Uint8Array
      ? await subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      : secret;
    return { mac: async function (data) { return new Uint8Array(await subtle.sign("HMAC", k, data)); }, key: k };
  }

  async function deriveStep(kh, credId, step) {
    var sb = u32be(step);
    var totpKey = await kh.mac(concat(str("SO1/totp"), credId));
    var encKeyBytes = await kh.mac(concat(str("SO1/enc"), credId, sb));
    var iv = (await kh.mac(concat(str("SO1/iv"), credId, sb))).slice(0, 12);
    var encKey = await subtle.importKey("raw", encKeyBytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    return { totpKey: totpKey, encKey: encKey, iv: iv };
  }

  // ---------- resident dynamic token ----------
  function stepOf(nowMs) { return Math.floor(nowMs / 1000 / STEP_SECONDS); }
  function secondsLeft(nowMs) { return STEP_SECONDS - ((nowMs / 1000) % STEP_SECONDS); }

  async function makeDynamicToken(kh, credId, nowMs, flags) {
    var step = stepOf(nowMs);
    var m = await deriveStep(kh, credId, step);
    var code = await hotp(m.totpKey, step, DIGITS, "SHA-256");
    var header = concat(Uint8Array.of(VERSION), credId, u32be(step));
    var pt = concat(u32be(code), Uint8Array.of(flags || 0), new Uint8Array(3));
    var ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: m.iv, additionalData: header, tagLength: 96 }, m.encKey, pt));
    return PREFIX_DYN + b64u(concat(header, ct));
  }

  function parseDynamic(token) {
    if (typeof token !== "string" || token.indexOf(PREFIX_DYN) !== 0) return { error: "format" };
    var raw; try { raw = fromB64u(token.slice(PREFIX_DYN.length)); } catch (e) { return { error: "format" }; }
    if (raw.length !== 31) return { error: "format" };
    if (raw[0] !== VERSION) return { error: "version" };
    return { credId: raw.slice(1, 7), credIdText: b64u(raw.slice(1, 7)), step: readU32(raw, 7), header: raw.slice(0, 11), body: raw.slice(11) };
  }

  // lookup(credIdText) → keyHandle | null. Returns { ok, credIdText, step, flags } or { ok:false, reason }.
  async function verifyDynamicToken(token, lookup, nowMs, opts) {
    var win = opts && opts.window != null ? opts.window : DEFAULT_WINDOW;
    var p = parseDynamic(token);
    if (p.error) return { ok: false, reason: p.error };
    var kh = await lookup(p.credIdText);
    if (!kh) return { ok: false, reason: "unknown-credential", credIdText: p.credIdText };
    var nowStep = stepOf(nowMs);
    if (Math.abs(p.step - nowStep) > win) return { ok: false, reason: "step-window", credIdText: p.credIdText, step: p.step };
    var m = await deriveStep(kh, p.credId, p.step), pt;
    try {
      pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: m.iv, additionalData: p.header, tagLength: 96 }, m.encKey, p.body));
    } catch (e) { return { ok: false, reason: "auth-failed", credIdText: p.credIdText }; }
    var code = readU32(pt, 0);
    var expect = await hotp(m.totpKey, p.step, DIGITS, "SHA-256");
    if (code !== expect) return { ok: false, reason: "totp-mismatch", credIdText: p.credIdText };
    return { ok: true, credIdText: p.credIdText, step: p.step, flags: pt[4], code: code };
  }

  // ---------- guest / courier / maintenance / master pass ----------
  async function newPass() {
    var id = randomBytes(12), secret = randomBytes(16);
    return {
      id: b64u(id),
      secret: b64u(secret),
      secretHash: b64u(await sha256(secret)),
      token: PREFIX_PASS + b64u(concat(id, secret))
    };
  }
  function parsePassToken(token) {
    if (typeof token !== "string" || token.indexOf(PREFIX_PASS) !== 0) return { error: "format" };
    var raw; try { raw = fromB64u(token.slice(PREFIX_PASS.length)); } catch (e) { return { error: "format" }; }
    if (raw.length !== 28) return { error: "format" };
    return { id: b64u(raw.slice(0, 12)), secretBytes: raw.slice(12) };
  }
  async function passSecretMatches(secretBytes, secretHash) {
    var h; try { h = fromB64u(secretHash); } catch (e) { return false; }
    return equalBytes(await sha256(secretBytes), h);
  }
  function passToken(id, secretB64u) { return PREFIX_PASS + b64u(concat(fromB64u(id), fromB64u(secretB64u))); }

  function classify(text) {
    if (typeof text !== "string") return "unknown";
    var t = text.trim();
    if (t.indexOf(PREFIX_DYN) === 0) return "dynamic";
    if (t.indexOf(PREFIX_PASS) === 0) return "pass";
    if (t.charAt(0) === "{" && t.indexOf("inviteId") > -1) return "legacy";
    return "unknown";
  }

  // ---------- site key sealing (ECIES-style) ----------
  async function generateSiteKeyPair() {
    var kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    var pub = await subtle.exportKey("jwk", kp.publicKey), priv = await subtle.exportKey("jwk", kp.privateKey);
    delete pub.key_ops; delete pub.ext; delete priv.key_ops; delete priv.ext;
    return { publicJwk: pub, privateJwk: priv, fingerprint: await fingerprint(pub) };
  }
  async function fingerprint(pubJwk) {
    var d = await sha256(str(pubJwk.crv + "|" + pubJwk.x + "|" + pubJwk.y));
    return hex(d.slice(0, 10)).replace(/(.{4})(?=.)/g, "$1-").toUpperCase();
  }
  async function sealKey(shared, context) {
    var hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
    return subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: str("SO1/seal"), info: str(context) }, hk,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function sealSecret(sitePubJwk, secretBytes, context) {
    var pub = await subtle.importKey("jwk", sitePubJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
    var eph = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    var shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: pub }, eph.privateKey, 256));
    var key = await sealKey(shared, context), iv = randomBytes(12);
    var ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: str(context) }, key, secretBytes));
    var epk = new Uint8Array(await subtle.exportKey("raw", eph.publicKey));
    return { v: 1, epk: b64u(epk), iv: b64u(iv), ct: b64u(ct) };
  }
  async function openSealed(sitePrivJwk, sealed, context) {
    var priv = await subtle.importKey("jwk", sitePrivJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    var epk = await subtle.importKey("raw", fromB64u(sealed.epk), { name: "ECDH", namedCurve: "P-256" }, false, []);
    var shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: epk }, priv, 256));
    var key = await sealKey(shared, context);
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: fromB64u(sealed.iv), additionalData: str(context) }, key, fromB64u(sealed.ct)));
  }
  function sealContext(credIdText, uid) { return credIdText + "|" + uid; }

  return {
    VERSION: VERSION, STEP_SECONDS: STEP_SECONDS, DEFAULT_WINDOW: DEFAULT_WINDOW, DIGITS: DIGITS,
    PREFIX_DYN: PREFIX_DYN, PREFIX_PASS: PREFIX_PASS,
    randomBytes: randomBytes, b64u: b64u, fromB64u: fromB64u, hex: hex, equalBytes: equalBytes, concat: concat,
    sha256: sha256, hotp: hotp, totp: totp, keyHandle: keyHandle,
    stepOf: stepOf, secondsLeft: secondsLeft,
    makeDynamicToken: makeDynamicToken, parseDynamic: parseDynamic, verifyDynamicToken: verifyDynamicToken,
    newPass: newPass, parsePassToken: parsePassToken, passSecretMatches: passSecretMatches, passToken: passToken,
    classify: classify,
    generateSiteKeyPair: generateSiteKeyPair, fingerprint: fingerprint, sealSecret: sealSecret, openSealed: openSealed, sealContext: sealContext
  };
});
