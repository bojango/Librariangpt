import { esc } from '../ui/format.js';

export function authView(mode = 'signin') {
  const signup = mode === 'signup';
  return `<section class="auth-shell"><div class="auth-card"><div class="brand-mark"><img src="./assets/reading-room-mark.svg" alt=""></div><h1>Your library.</h1><p>A private reading terminal for progress, shelves and the occasional proof that you have, in fact, finished a book.</p><div class="auth-tabs"><button data-auth-mode="signin" class="${signup ? '' : 'active'}">Sign in</button><button data-auth-mode="signup" class="${signup ? 'active' : ''}">Create account</button></div><form id="auth-form" class="form-stack"><div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="email" required></div><div class="field"><label for="password">Password</label><input class="input" id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></div><button class="btn btn-primary btn-full" type="submit">${signup ? 'Create account' : 'Sign in'}</button></form><p class="auth-note">Library data is protected by Supabase authentication and database Row Level Security.</p></div></section>`;
}

export function claimView() {
  return `<section class="auth-shell"><div class="auth-card"><div class="brand-mark"><img src="./assets/reading-room-mark.svg" alt=""></div><h1>Claim your library.</h1><p>The migrated catalogue is waiting for its owner. Enter the one-time claim code created during migration.</p><form id="claim-form" class="form-stack"><div class="field"><label for="claim-code">One-time claim code</label><input class="input" id="claim-code" type="password" autocomplete="off" required></div><button class="btn btn-primary btn-full" type="submit">Claim library</button><button class="btn btn-quiet btn-full" data-signout type="button">Sign out</button></form></div></section>`;
}

export function errorView(message) {
  return `<div class="error-card"><h2>Could not load library</h2><p>${esc(message)}</p><button class="btn" data-signout>Sign out</button></div>`;
}
