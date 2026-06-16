/* Login / Registration Page */

function showError(msg) {
  const el = document.getElementById('loginError');
  const ok = document.getElementById('loginSuccess');
  ok.style.display = 'none';
  el.textContent = msg;
  el.style.display = 'block';
}

function showSuccess(msg) {
  const el = document.getElementById('loginSuccess');
  const err = document.getElementById('loginError');
  err.style.display = 'none';
  el.textContent = msg;
  el.style.display = 'block';
}

function clearMessages() {
  document.getElementById('loginError').style.display = 'none';
  document.getElementById('loginSuccess').style.display = 'none';
}

// ── Tab / mode switching ────────────────────────────────────────────────────
function switchAuthTab(which) {
  clearMessages();
  document.getElementById('tabBoard').classList.toggle('active', which === 'board');
  document.getElementById('tabVolunteer').classList.toggle('active', which === 'volunteer');
  document.getElementById('boardPath').style.display = which === 'board' ? 'block' : 'none';
  document.getElementById('volunteerPath').style.display = which === 'volunteer' ? 'block' : 'none';
}

function switchVolunteerMode(mode) {
  clearMessages();
  document.getElementById('loginForm').style.display    = mode === 'returning' ? 'flex' : 'none';
  document.getElementById('registerForm').style.display = mode === 'new' ? 'flex' : 'none';
  document.getElementById('forgotForm').style.display    = 'none';
  document.getElementById('registerSuccess').style.display = 'none';
}

function resetVolunteerForms() {
  document.getElementById('registerSuccess').style.display = 'none';
  document.querySelector('input[name="volMode"][value="returning"]').checked = true;
  switchVolunteerMode('returning');
}

function openForgotPassword() {
  clearMessages();
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('forgotForm').style.display = 'flex';
}
function closeForgotPassword() {
  clearMessages();
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'flex';
}

function togglePw(inputId, btn) {
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? 'Show' : 'Hide';
}

// ── Volunteer login ──────────────────────────────────────────────────────────
async function handleVolunteerLogin(e) {
  e.preventDefault();
  clearMessages();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/auth/volunteer/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value.trim(),
        password: document.getElementById('loginPassword').value
      })
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not log in.'); return; }
    location.href = data.redirect || '/volunteer';
  } catch (err) {
    showError('Network error — please try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Volunteer registration ──────────────────────────────────────────────────
async function handleVolunteerRegister(e) {
  e.preventDefault();
  clearMessages();
  const btn = e.target.querySelector('button[type="submit"]');
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;

  if (password !== confirmPassword) { showError('Passwords do not match.'); return; }
  if (password.length < 8) { showError('Password must be at least 8 characters.'); return; }

  btn.disabled = true;
  try {
    const res = await fetch('/auth/volunteer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: document.getElementById('regFirstName').value.trim(),
        lastName:  document.getElementById('regLastName').value.trim(),
        email:     document.getElementById('regEmail').value.trim(),
        phone:     document.getElementById('regPhone').value.trim(),
        password, confirmPassword,
        church: document.getElementById('regChurch').value.trim(),
        agree:  document.getElementById('regAgree').checked
      })
    });
    const data = await res.json();
    if (!res.ok) { showError(data.error || 'Could not complete registration.'); return; }

    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('registerSuccessMsg').textContent = data.message;
    document.getElementById('registerSuccess').style.display = 'block';
  } catch (err) {
    showError('Network error — please try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Forgot password ──────────────────────────────────────────────────────────
async function handleForgotPassword(e) {
  e.preventDefault();
  clearMessages();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/auth/volunteer/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: document.getElementById('forgotEmail').value.trim() })
    });
    const data = await res.json();
    closeForgotPassword();
    showSuccess(data.message || "If that email is registered, you'll receive reset instructions shortly.");
  } catch (err) {
    showError('Network error — please try again.');
  } finally {
    btn.disabled = false;
  }
}

// ── Error codes from redirects + deep-linking into a specific tab ──────────
(function () {
  const p = new URLSearchParams(location.search);
  const msgs = {
    access_denied:  'Access denied. Use your @gorock.org Google account.',
    login_required: 'Please sign in to access ROCK Hub.'
  };
  const msg = msgs[p.get('error')];
  if (msg) showError(msg);

  if (p.get('tab') === 'volunteer') switchAuthTab('volunteer');
  if (p.get('mode') === 'new') {
    switchAuthTab('volunteer');
    document.querySelector('input[name="volMode"][value="new"]').checked = true;
    switchVolunteerMode('new');
  }
})();
