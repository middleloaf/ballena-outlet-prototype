// Admin authentication: email + password, signed session cookie.
//
// Accounts live in the D1 `admins` table, managed with
// `npm run admin:account -- person@example.com` (or `--remove`). Deleting an
// account (or rotating the SESSION_SECRET secret) revokes its sessions at
// once, because every request re-checks the email against `admins`.
//
// PBKDF2 at 20k iterations keeps a login under the free plan's CPU budget;
// failed logins are rate limited per email and per IP in D1.

const COOKIE = "bo_admin";
const SESSION_DAYS = 30;
const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64url = (buf) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));

async function storedHash(env, email) {
  const row = await env.DB.prepare("SELECT password_hash FROM admins WHERE email = ?").bind(email.toLowerCase()).first();
  return row?.password_hash ?? null;
}

export async function hashPassword(password, iterations = 20000, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(bits)}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored) {
  const [scheme, iter, salt] = String(stored).split("$");
  if (scheme !== "pbkdf2-sha256" || !salt) return false;
  const candidate = await hashPassword(password, Number(iter), unb64(salt));
  return timingSafeEqual(candidate, stored);
}

async function hmac(env, data) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET is not configured.");
  const key = await crypto.subtle.importKey("raw", enc.encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Returns the admin's email for a valid session, else null. */
export async function adminFromSession(request, env) {
  const raw = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get("cookie") || "")?.[1];
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  try {
    if (!timingSafeEqual(await hmac(env, body), sig)) return null;
    const { email, exp } = JSON.parse(new TextDecoder().decode(unb64url(body)));
    if (typeof exp !== "number" || exp < Date.now()) return null;
    return (await storedHash(env, String(email))) ? email : null;
  } catch {
    return null;
  }
}

function cookie(value, maxAge, secure) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

async function tooManyFailures(env, keys) {
  const since = Date.now() - WINDOW_MS;
  const rows = await env.DB.prepare(`SELECT count, window_start FROM login_failures WHERE key IN (${keys.map(() => "?").join(",")})`)
    .bind(...keys)
    .all();
  return rows.results.some((r) => r.window_start > since && r.count >= MAX_FAILURES);
}

async function recordFailure(env, keys) {
  const t = Date.now();
  await env.DB.batch(
    keys.map((k) =>
      env.DB.prepare(
        "INSERT INTO login_failures (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET " +
          "count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END, window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END",
      ).bind(k, t, t - WINDOW_MS, t - WINDOW_MS, t),
    ),
  );
}

const reply = (body, status, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

export async function login(request, env) {
  let email, password;
  try {
    ({ email, password } = await request.json());
  } catch {
    return reply({ error: "invalid", message: "Expected JSON { email, password }." }, 400);
  }
  email = String(email || "").trim().toLowerCase();
  password = String(password || "");
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const keys = [`email:${email}`, `ip:${ip}`];

  if (await tooManyFailures(env, keys)) {
    return reply({ error: "rate_limited", message: "Demasiados intentos. Esperá 15 minutos." }, 429);
  }
  const stored = await storedHash(env, email);
  // Hash even for unknown emails so response time doesn't reveal which accounts exist.
  const ok = stored ? await verifyPassword(password, stored) : (await hashPassword(password), false);
  if (!ok) {
    await recordFailure(env, keys);
    return reply({ error: "invalid_credentials", message: "Correo o contraseña incorrectos." }, 401);
  }
  const body = b64url(enc.encode(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 864e5 })));
  const secure = new URL(request.url).protocol === "https:";
  return reply({ email }, 200, { "set-cookie": cookie(`${body}.${await hmac(env, body)}`, SESSION_DAYS * 86400, secure) });
}

export function logout(request) {
  const secure = new URL(request.url).protocol === "https:";
  return reply({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });
}
