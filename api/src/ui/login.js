// Login form: exchange the API token for a session cookie, then reload the
// page the user asked for. The token is sent once and never stored here.
(function () {
  const form = document.getElementById('login-form');
  const input = document.getElementById('login-token');
  const button = document.getElementById('login-submit');
  const errorEl = document.getElementById('login-error');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const token = input.value.trim();
    if (!token) return;
    errorEl.textContent = '';
    button.disabled = true;
    try {
      const res = await fetch('/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        input.value = '';
        window.location.reload();
        return;
      }
      const body = await res.json().catch(() => ({}));
      errorEl.textContent = body.error || ('Sign-in failed (' + res.status + ')');
    } catch (err) {
      errorEl.textContent = 'Sign-in failed: ' + err.message;
    } finally {
      button.disabled = false;
    }
  });
})();
