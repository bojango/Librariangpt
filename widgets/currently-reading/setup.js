import { widgetClient } from './client.js';

const { client, store } = widgetClient();
const form = document.getElementById('connect-form');
const status = document.getElementById('status');
const submit = form.querySelector('button');
form.addEventListener('submit', async event => {
  event.preventDefault();
  submit.disabled = true;
  status.textContent = 'Connecting…';
  store.clearSnapshot();
  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: form.elements.email.value.trim(), password: form.elements.password.value
    });
    if (error || !data.session) throw error || new Error('Sign-in failed.');
    if (!store.getSession()) throw new Error('Cookies unavailable.');
    status.textContent = 'Connected. View the widget, then reload it in Widget Web.';
  } catch {
    store.clear();
    status.textContent = 'Could not connect. Check your email and password, network connection, and that cookies are allowed.';
  } finally {
    form.elements.password.value = '';
    submit.disabled = false;
  }
});
document.getElementById('disconnect').addEventListener('click', async () => {
  // Local scope leaves the user's PWA and other devices signed in.
  try { await client.auth.signOut({ scope: 'local' }); } catch {}
  finally { store.clear(); status.textContent = 'Widget disconnected. Reload or remove it to clear the iOS screenshot.'; }
});
