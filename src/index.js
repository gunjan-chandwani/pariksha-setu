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
      if (!configured(env)) return json({ ok: false, database: "not-configured", hint: "Set Worker secrets SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SESSION_SECRET." }, 503);
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
      const role = String(body.role || "");
      const users = {
        "faculty@mru.edu.in": "Faculty",
        "coe@mru.edu.in": "COE",
        "moderator@mru.edu.in": "Moderator"
      };
      if (!users[email] || users[email] !== role || password !== (env.DEMO_PASSWORD || "demo123")) {
        return json({ error: "Invalid demo credentials or role" }, 401);
      }
      if (!env.SESSION_SECRET) return json({ error: "Server session secret is not configured" }, 503);
      const user = { email, role };
      return json({ token: await makeToken(user, env), user });
    }

    if (url.pathname === "/api/state" && (request.method === "GET" || request.method === "PUT")) {
      const user = await readUser(request, env);
      if (!user) return json({ error: "Sign in required. Please sign in again." }, 401);
      if (!configured(env)) return json({ error: "Supabase is not configured. Set Worker secrets." }, 503);

      if (request.method === "GET") {
        const response = await supabaseRequest(env, "portal_state?select=data,updated_at&id=eq.main");
        const text = await response.text();
        if (!response.ok) return json({ error: text.slice(0, 500) }, 500);
        let rows;
        try { rows = JSON.parse(text); } catch { return json({ error: "Unexpected database response" }, 500); }
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
