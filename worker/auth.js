// Admin authentication.
//
// Browsers reach /admin and /api/admin/* through a Cloudflare Access
// application (email one-time code). Access sits in front of the Worker, but
// the Worker still verifies the Access JWT itself and checks the email against
// ADMIN_EMAILS, so a misconfigured or removed Access policy fails closed.

import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks;
let jwksTeam;

function allowed(env, email) {
  const list = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(email) && list.includes(email.toLowerCase());
}

/** Returns the admin's email, or null when the request is not an authorized admin. */
export async function adminFromAccess(request, env) {
  const host = new URL(request.url).hostname;
  // Local development only: wrangler dev on localhost with DEV_ADMIN_EMAIL in .dev.vars.
  if (env.DEV_ADMIN_EMAIL && (host === "localhost" || host === "127.0.0.1")) {
    return allowed(env, env.DEV_ADMIN_EMAIL) ? env.DEV_ADMIN_EMAIL : null;
  }
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token =
    request.headers.get("cf-access-jwt-assertion") ||
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1];
  if (!token) return null;

  const team = env.ACCESS_TEAM_DOMAIN.replace(/\/+$/, "");
  if (!jwks || jwksTeam !== team) {
    jwks = createRemoteJWKSet(new URL(`${team}/cdn-cgi/access/certs`));
    jwksTeam = team;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: team, audience: env.ACCESS_AUD });
    const email = typeof payload.email === "string" ? payload.email : null;
    return allowed(env, email) ? email : null;
  } catch {
    return null;
  }
}
