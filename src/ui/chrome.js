import { uiCopyHtml } from './copy.js';

export function navigation(active) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 12 3.75l8.5 6.75v9.25h-6v-6h-5v6h-6z"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.25h4.5v15.5H4zM8.5 5.75H13v14H8.5zM14.25 4.75l4.1-1.1 3.75 14.9-4.1 1.1z"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 9.25c0 5.25-8.5 10-8.5 10s-8.5-4.75-8.5-10a4.75 4.75 0 0 1 8.5-2.9 4.75 4.75 0 0 1 8.5 2.9Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.6 3.3-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></svg>'
  };
  const items = [['home',uiCopyHtml('nav.home')],['library',uiCopyHtml('nav.library')],['wishlist',uiCopyHtml('nav.wishlist')],['profile',uiCopyHtml('nav.profile')]];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, label]) => `<button class="nav-btn ${active === key ? 'active' : ''}" data-route="${key}"${active === key ? ' aria-current="page"' : ''}><span class="nav-icon">${icons[key]}</span><span class="nav-label">${label}</span></button>`).join('')}<i class="nav-active-indicator" aria-hidden="true"></i></nav>`;
}

export function chrome(content, active) {
  const refreshIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  return `<div class="layout"><header class="topbar"><button class="wordmark" data-route="home" aria-label="Go to Reading Room home"><div class="brand-mark"><img src="./assets/reading-room-mark.svg" alt=""></div><span class="reading-room-wordmark">Reading Room</span></button><div class="top-actions"><button class="icon-btn" data-refresh aria-label="Refresh library">${refreshIcon}</button><button class="icon-btn" data-menu aria-label="Open menu"><span class="menu-bars"><i></i><i></i><i></i></span></button></div></header><main>${content}</main>${navigation(active)}</div>`;
}
