const API = '/api';

function getPlayerToken() { return localStorage.getItem('ehl_player_token') || ''; }
function setPlayerToken(t) { localStorage.setItem('ehl_player_token', t); }
function clearPlayerToken() { localStorage.removeItem('ehl_player_token'); localStorage.removeItem('ehl_player_user'); }

function showTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((b, i) => b.classList.toggle('active', (i === 0) === (tab === 'login')));
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
}

function selectPlatform(p) {
  document.getElementById('reg-platform').value = p;
  document.getElementById('btn-xbox').classList.toggle('selected', p === 'xbox');
  document.getElementById('btn-psn').classList.toggle('selected', p === 'psn');
}

// ── Discord OAuth helpers ──────────────────────────────────────────────────

function startDiscordLogin() {
  window.location.href = `${API}/discord/connect?mode=login`;
}

function startDiscordOAuth() {
  // Save current form state so we can restore it after the OAuth redirect
  sessionStorage.setItem('reg_form', JSON.stringify({
    username: document.getElementById('reg-username').value,
    email:    document.getElementById('reg-email').value,
    platform: document.getElementById('reg-platform').value,
    position: document.getElementById('reg-position').value,
  }));
  window.location.href = `${API}/discord/connect`;
}

function applyDiscordLink(username, discordId) {
  document.getElementById('reg-discord').value    = username;
  document.getElementById('reg-discord-id').value = discordId;
  document.getElementById('discord-display-name').textContent = username;
  document.getElementById('discord-unlinked').style.display = 'none';
  document.getElementById('discord-linked').style.display   = '';
}

function resetDiscordLink() {
  document.getElementById('reg-discord').value    = '';
  document.getElementById('reg-discord-id').value = '';
  document.getElementById('discord-unlinked').style.display = '';
  document.getElementById('discord-linked').style.display   = 'none';
}

// ── On page load: check for OAuth callback params ─────────────────────────

(async () => {
  const token = getPlayerToken();
  if (token) {
    const res = await fetch(`${API}/players/me`, { headers: { 'X-Player-Token': token } }).catch(() => null);
    if (res && res.ok) { window.location.href = 'dashboard.html'; return; }
    clearPlayerToken();
  }

  const params = new URLSearchParams(window.location.search);

  // Discord login callback – exchange the signed login token for a session
  const discordLogin = params.get('discord_login');
  if (discordLogin) {
    const err = document.getElementById('login-error');
    try {
      const res = await fetch(`${API}/players/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_login_token: discordLogin }),
      });
      const data = await res.json();
      if (!res.ok) {
        err.textContent = data.error || 'Login failed';
        err.style.display = '';
        // If no account found, switch to register tab
        if (res.status === 404) {
          err.textContent = 'No account found for this Discord account. Please register below.';
          showTab('register');
        }
      } else {
        setPlayerToken(data.token);
        localStorage.setItem('ehl_player_user', JSON.stringify({ id: data.id, username: data.username, platform: data.platform }));
        window.location.href = 'dashboard.html';
        return;
      }
    } catch {
      err.textContent = 'Network error. Please try again.';
      err.style.display = '';
    }
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Restore form values saved before OAuth redirect
  const saved = sessionStorage.getItem('reg_form');
  if (saved) {
    try {
      const f = JSON.parse(saved);
      if (f.username) document.getElementById('reg-username').value = f.username;
      if (f.email)    document.getElementById('reg-email').value    = f.email;
      if (f.platform) { document.getElementById('reg-platform').value = f.platform; selectPlatform(f.platform); }
      if (f.position) document.getElementById('reg-position').value = f.position;
    } catch { /* ignore */ }
    sessionStorage.removeItem('reg_form');
  }

  // Discord OAuth returned successfully (for registration)
  const discordToken = params.get('discord_token');
  if (discordToken) {
    showTab('register');
    const pendRes = await fetch(`${API}/discord/pending?token=${encodeURIComponent(discordToken)}`).catch(() => null);
    if (pendRes && pendRes.ok) {
      const { discord_id, discord } = await pendRes.json();
      applyDiscordLink(discord, discord_id);
    }
    // If discord_new flag set, show helpful message
    if (params.get('discord_new') === '1') {
      const err = document.getElementById('register-error');
      err.textContent = '';
      const ok = document.getElementById('register-success');
      ok.textContent = 'No existing account found. Fill out the form below to create your EHL profile.';
      ok.style.display = '';
    }
    // Clean URL without reloading
    window.history.replaceState({}, '', window.location.pathname);
  }

  // Discord OAuth error
  const discordError = params.get('discord_error');
  if (discordError) {
    const loginErr = document.getElementById('login-error');
    loginErr.textContent = `Discord connection failed: ${discordError}. Please try again.`;
    loginErr.style.display = '';
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('register-error');
  const ok  = document.getElementById('register-success');
  err.style.display = 'none'; ok.style.display = 'none';
  const username   = document.getElementById('reg-username').value.trim();
  const platform   = document.getElementById('reg-platform').value;
  const email      = document.getElementById('reg-email').value.trim();
  const position   = document.getElementById('reg-position').value;
  const discord    = document.getElementById('reg-discord').value.trim();
  const discord_id = document.getElementById('reg-discord-id').value.trim() || null;
  if (!position) { err.textContent = 'Please select your position'; err.style.display = ''; return; }
  if (!discord) { err.textContent = 'Please connect your Discord account before registering'; err.style.display = ''; return; }
  try {
    const res = await fetch(`${API}/players/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, platform, position, discord, discord_id, email: email || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Registration failed'; err.style.display = ''; return; }
    setPlayerToken(data.token);
    localStorage.setItem('ehl_player_user', JSON.stringify({ id: data.id, username: data.username, platform: data.platform }));
    ok.textContent = `Welcome, ${data.username}! Redirecting…`;
    ok.style.display = '';
    setTimeout(() => window.location.href = 'dashboard.html', 800);
  } catch { err.textContent = 'Network error. Is the server running?'; err.style.display = ''; }
});
