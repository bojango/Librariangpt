import { activateCovers } from './cover.js';

const modalRoot = document.querySelector('#modal-root');
const toastNode = document.querySelector('#toast');
let toastTimer = 0;

export function showModal(html, className = '') {
  modalRoot.innerHTML = `<div class="modal-backdrop ${className}"><div class="modal">${html}</div></div>`;
  activateCovers(modalRoot);
  modalRoot.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', closeModal));
  modalRoot.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
  return modalRoot;
}

export function closeModal() { modalRoot.innerHTML = ''; }

export function toast(message, error = false) {
  toastNode.textContent = message;
  toastNode.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastNode.className = 'toast'; }, 3400);
}
