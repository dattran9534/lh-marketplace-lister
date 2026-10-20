/* Small Supabase client (auth, tables, private photo storage) shared by the
 * PC extension and the iPhone app. Plain fetch, no outside libraries.
 * store: { get(key) -> Promise<value>, set(key, value) -> Promise } keeps the login. */
(function (global) {
  function LHCloud({ url, key, store }) {
    url = (url || '').replace(/\/+$/, '');
    const SESSION = 'lhCloudSession';
    let session = null;

    const baseHeaders = () => ({ apikey: key, 'content-type': 'application/json' });

    async function loadSession() {
      if (!session) session = (await store.get(SESSION)) || null;
      return session;
    }
    async function saveSession(s) {
      session = s ? {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: Date.now() + (s.expires_in || 3600) * 1000,
        user: { id: s.user && s.user.id, email: s.user && s.user.email },
      } : null;
      await store.set(SESSION, session);
      return session;
    }

    async function authCall(path, body) {
      const r = await fetch(`${url}/auth/v1/${path}`, { method: 'POST', headers: baseHeaders(), body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.msg || j.error_description || j.message || j.error || `Sign in failed (${r.status})`);
      return j;
    }

    async function signIn(email, password) {
      return saveSession(await authCall('token?grant_type=password', { email, password }));
    }
    // Returns { session } when you can use it right away, or { confirm: true } when Supabase emailed a link first.
    async function signUp(email, password) {
      const j = await authCall('signup', { email, password });
      if (j.access_token) return { session: await saveSession(j) };
      return { confirm: true };
    }
    async function signOut() { await saveSession(null); }

    // Renews the login in the background. Only a real "this login is no longer
    // valid" answer signs you out; a weak signal or offline moment never does.
    let refreshing = null;
    function refresh() {
      if (refreshing) return refreshing;
      refreshing = (async () => {
        const s = session;
        let r;
        try {
          r = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: baseHeaders(), body: JSON.stringify({ refresh_token: s.refresh_token }) });
        } catch (e) {
          throw new Error("Can't reach the cloud right now. Check your connection and try again.");
        }
        const j = await r.json().catch(() => ({}));
        if (r.ok) { await saveSession(j); return; }
        if (r.status === 400 || r.status === 401 || r.status === 403) {
          // Another window may have renewed it a moment ago: use that one.
          const latest = await store.get(SESSION);
          if (latest && latest.refresh_token && latest.refresh_token !== s.refresh_token) { session = latest; return; }
          await saveSession(null);
          throw new Error('Your cloud sign in expired. Sign in again.');
        }
        throw new Error(`The cloud is busy (${r.status}). Try again in a moment.`);
      })().finally(() => { refreshing = null; });
      return refreshing;
    }

    async function token() {
      const s = await loadSession();
      if (!s) throw new Error('Not signed in to the cloud. Sign in again.');
      if (Date.now() > s.expires_at - 60000) await refresh();
      return session.access_token;
    }

    async function user() { const s = await loadSession(); return s && s.user; }

    async function rest(method, path, body, prefer) {
      const headers = { ...baseHeaders(), Authorization: `Bearer ${await token()}` };
      if (prefer) headers.Prefer = prefer;
      const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || j.hint || `Cloud error (${r.status})`);
      }
      return r.status === 204 ? null : r.json().catch(() => null);
    }

    const q = (v) => encodeURIComponent(v);
    const db = {
      select: (table, query = '') => rest('GET', `${table}?select=*${query ? '&' + query : ''}`),
      upsert: (table, rows, onConflict) => rest('POST', `${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, rows, 'resolution=merge-duplicates,return=minimal'),
      insert: (table, rows) => rest('POST', table, rows, 'return=representation'),
      update: (table, match, patch) => rest('PATCH', `${table}?${Object.entries(match).map(([k, v]) => `${k}=eq.${q(v)}`).join('&')}`, patch, 'return=minimal'),
      remove: (table, match) => rest('DELETE', `${table}?${Object.entries(match).map(([k, v]) => `${k}=eq.${q(v)}`).join('&')}`),
    };

    // Photos: private bucket "photos", paths start with your user id.
    const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');
    const photos = {
      async upload(path, blob) {
        const r = await fetch(`${url}/storage/v1/object/photos/${encPath(path)}`, {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${await token()}`, 'content-type': blob.type || 'image/jpeg', 'x-upsert': 'true' },
          body: blob,
        });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || `Photo upload failed (${r.status})`); }
        return path;
      },
      async download(path) {
        const r = await fetch(`${url}/storage/v1/object/authenticated/photos/${encPath(path)}`, { headers: { apikey: key, Authorization: `Bearer ${await token()}` } });
        if (!r.ok) throw new Error(`Photo download failed (${r.status})`);
        return r.blob();
      },
      async remove(paths) {
        if (!paths.length) return;
        await fetch(`${url}/storage/v1/object/photos`, {
          method: 'DELETE',
          headers: { ...baseHeaders(), Authorization: `Bearer ${await token()}` },
          body: JSON.stringify({ prefixes: paths }),
        });
      },
    };

    return { url, signIn, signUp, signOut, user, token, db, photos, configured: !!(url && key) };
  }

  // Cheap fingerprint to tell whether a record changed since it was last sent.
  function fingerprint(obj) {
    const s = JSON.stringify(obj);
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return `${s.length}:${h}`;
  }

  global.LHCloud = LHCloud;
  global.LHCloud.fingerprint = fingerprint;
})(typeof window !== 'undefined' ? window : globalThis);
