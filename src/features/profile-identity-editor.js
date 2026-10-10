import { escapeHtml } from '../utils/text.js';

export function editProfileIdentity(button, profile, metadata, save) {
  if (!button) return;
  const host = button.closest('.profile-identity-main') || button.parentElement;
  if (host.querySelector('form')) return;
  const form = document.createElement('form');
  form.className = 'profile-inline-form';
  const displayName = profile?.display_name || metadata?.full_name || metadata?.name || 'Reader';
  const handle = profile?.handle || host.querySelector('[data-identity-edit]')?.textContent || displayName;
  form.innerHTML = `<label>Username<input name="handle" maxlength="80" required value="${escapeHtml(handle)}" autocomplete="nickname"></label><label>Display name<input name="displayName" maxlength="80" required value="${escapeHtml(displayName)}" autocomplete="name"></label><label>Library name<input name="libraryName" maxlength="120" value="${escapeHtml(profile?.library_name || '')}" autocomplete="off"></label><div><button type="submit">Save</button><button type="button" data-identity-cancel>Cancel</button></div><p role="alert" class="identity-error"></p>`;
  const original = [...host.children].map(element => [element, element.hidden]);
  original.forEach(([element]) => { element.hidden = true; }); host.append(form);
  const cancel = () => { form.remove(); original.forEach(([element,hidden]) => { element.hidden = hidden; }); button.focus(); };
  form.querySelector('[data-identity-cancel]').addEventListener('click', cancel);
  form.addEventListener('keydown', event => { if (event.key === 'Escape' && !form.querySelector('[type="submit"]').disabled) { event.preventDefault(); cancel(); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const controls = [...form.querySelectorAll('input,button')];
    const values = { handle: form.elements.handle.value, displayName: form.elements.displayName.value, libraryName: form.elements.libraryName.value, shortBio: profile?.short_bio || '' };
    controls.forEach(control => { control.disabled = true; });
    try { await save(values); }
    catch (error) { form.querySelector('[role="alert"]').textContent = error.message || 'Could not save identity.'; controls.forEach(control => { control.disabled = false; }); }
  });
  const input = button.matches('[data-library-name-edit]') ? form.elements.libraryName : form.elements.handle;
  input.focus(); input.select();
}
