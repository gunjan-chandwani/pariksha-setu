const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const encodeText = (value) => b64url(new TextEncoder().encode(value));
const decodeText = (value) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
};

async function signature(body, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
}

async function makeToken(user, env) {
  const body = encodeText(JSON.stringify({ ...user, exp: Date.now() + 12 * 60 * 60 * 1000 }));
  return body + "." + await signature(body, env.SESSION_SECRET);
}

async function readUser(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = token.split(".");
  if (parts.length !== 2 || !env.SESSION_SECRET) return null;
  const expected = await signature(parts[0], env.SESSION_SECRET);
  if (expected !== parts[1]) return null;
  try {
    const user = JSON.parse(decodeText(parts[0]));
    return user.exp > Date.now() ? user : null;
  } catch {
    return null;
  }
}

function configured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SESSION_SECRET);
}

async function supabaseRequest(env, path, init = {}) {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  return fetch(base + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      if (!configured(env)) { const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SESSION_SECRET"].filter((key) => !env[key] || !String(env[key]).trim()); return json({ ok: false, database: "not-configured", missing, hint: "Add the missing names under this Worker’s Production runtime variables/secrets, then redeploy." }, 503); }
      try {
        const response = await supabaseRequest(env, "portal_state?select=id&id=eq.main");
        if (!response.ok) return json({ ok: false, database: "error", detail: (await response.text()).slice(0, 500) }, 503);
        return json({ ok: true, database: "connected" });
      } catch (error) {
        return json({ ok: false, database: "error", detail: String(error) }, 503);
      }
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
      const email = String(body.email || "").toLowerCase().trim();
      const password = String(body.password || "");
      const requestedRole = String(body.role || "");
      if (!email || !password || !["Faculty", "OBE", "COE", "Moderator"].includes(requestedRole)) {
        return json({ error: "Enter your institutional email, password, and assigned portal role." }, 400);
      }
      if (!configured(env)) return json({ error: "Authentication service is not configured. Contact the portal administrator." }, 503);

      // Authenticate the actual account with Supabase Auth; never accept demo passwords.
      const authResponse = await fetch(env.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!authResponse.ok) return json({ error: "Sign-in failed. Check your email and password, or contact the portal administrator." }, 401);
      let auth;
      try { auth = await authResponse.json(); } catch { return json({ error: "Authentication service returned an invalid response." }, 502); }
      const authUserId = auth?.user?.id;
      if (!authUserId) return json({ error: "Your account could not be verified." }, 401);

      const roleResponse = await supabaseRequest(env, "portal_user_roles?select=role,active&user_id=eq." + encodeURIComponent(authUserId) + "&active=eq.true");
      if (!roleResponse.ok) return json({ error: "Could not verify your portal permissions. Contact the portal administrator." }, 503);
      let roleRows;
      try { roleRows = await roleResponse.json(); } catch { return json({ error: "Could not verify your portal permissions." }, 503); }
      const assignedRole = roleRows?.[0]?.role;
      if (!assignedRole || assignedRole !== requestedRole) {
        return json({ error: "This account is not assigned to the selected role. Contact the portal administrator." }, 403);
      }
      const user = { id: authUserId, email: String(auth.user.email || email), role: assignedRole };
      return json({ token: await makeToken(user, env), user });
    }

    if (url.pathname === "/api/state" && (request.method === "GET" || request.method === "PUT")) {
      const user = await readUser(request, env);
      if (!user) return json({ error: "Sign in required. Please sign in again." }, 401);
      if (!configured(env)) return json({ error: "Supabase is not configured. Set Worker secrets." }, 503);

      if (request.method === "GET") {
        const response = await supabaseRequest(env, "portal_state?select=data,updated_at&id=eq.main");
        const responseText = await response.text();
        if (!response.ok) return json({ error: responseText.slice(0, 500) }, 500);
        let rows;
        try { rows = JSON.parse(responseText); } catch { return json({ error: "Unexpected database response" }, 500); }
        return json({ data: rows[0]?.data || null, updated_at: rows[0]?.updated_at || null });
      }

      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
      const data = body?.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Expected a JSON object in data." }, 400);
      if (JSON.stringify(data).length > 12000000) return json({ error: "Portal data exceeds the allowed size." }, 413);
      const row = { id: "main", data, updated_at: new Date().toISOString(), updated_by: user.email };
      const response = await supabaseRequest(env, "portal_state?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(row)
      });
      if (!response.ok) return json({ error: (await response.text()).slice(0, 500) }, 500);
      return json({ ok: true, updated_at: row.updated_at });
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found" }, 404);
    return env.ASSETS.fetch(request);
  }
};
