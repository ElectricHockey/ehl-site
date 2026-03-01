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

// If already logged in, redirect to dashboard
(async () => {
  const token = getPlayerToken();
  if (token) {
    const res = await fetch(`${API}/players/me`, { headers: { 'X-Player-Token': token } }).catch(() => null);
    if (res && res.ok) { window.location.href = 'dashboard.html'; return; }
    clearPlayerToken();
  }
})();

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.style.display = 'none';
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const res = await fetch(`${API}/players/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Login failed'; err.style.display = ''; return; }
    setPlayerToken(data.token);
    localStorage.setItem('ehl_player_user', JSON.stringify({ id: data.id, username: data.username, platform: data.platform }));
    window.location.href = 'dashboard.html';
  } catch { err.textContent = 'Network error. Is the server running?'; err.style.display = ''; }
});

document.getElementById('register-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('register-error');
  const ok  = document.getElementById('register-success');
  err.style.display = 'none'; ok.style.display = 'none';
  const username = document.getElementById('reg-username').value.trim();
  const platform = document.getElementById('reg-platform').value;
  const email    = document.getElementById('reg-email').value.trim();
  const position = document.getElementById('reg-position').value;
  const discord  = document.getElementById('reg-discord').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  if (!position) { err.textContent = 'Please select your position'; err.style.display = ''; return; }
  if (!discord) { err.textContent = 'Discord username is required'; err.style.display = ''; return; }
  if (password !== confirm) { err.textContent = 'Passwords do not match'; err.style.display = ''; return; }
  try {
    const res = await fetch(`${API}/players/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, platform, position, password, discord, email: email || undefined }),
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
