import { uiCopyHtml } from './copy.js';

export function navigation(active) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M3.5 10.5 12 3.75l8.5 6.75v9.25h-6v-6h-5v6h-6z"/><path class="nav-icon-solid" d="M12 2.5 2.5 10v11h8v-6h3v6h8V10z"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M4 4.25h4.5v15.5H4zM8.5 5.75H13v14H8.5zM14.25 4.75l4.1-1.1 3.75 14.9-4.1 1.1z"/><path class="nav-icon-solid" d="M3.25 3.5h5.5v17h-5.5zm5.5 1.5h5v15.5h-5zm5.1-.9 5.15-1.3 4.1 16.35-5.15 1.3z"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M20.5 9.25c0 5.25-8.5 10-8.5 10s-8.5-4.75-8.5-10a4.75 4.75 0 0 1 8.5-2.9 4.75 4.75 0 0 1 8.5 2.9Z"/><path class="nav-icon-solid" d="M21.5 9.15C21.5 15 12 20.5 12 20.5S2.5 15 2.5 9.15A5.65 5.65 0 0 1 12 5a5.65 5.65 0 0 1 9.5 4.15Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="nav-icon-outline"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.6 3.3-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></g><g class="nav-icon-solid"><circle cx="12" cy="7.5" r="4"/><path d="M3.5 21c.75-4.65 3.6-7 8.5-7s7.75 2.35 8.5 7z"/></g></svg>'
  };
  const items = [['home',uiCopyHtml('nav.home')],['library',uiCopyHtml('nav.library')],['wishlist',uiCopyHtml('nav.wishlist')],['profile',uiCopyHtml('nav.profile')]];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, label]) => `<button class="nav-btn ${active === key ? 'active' : ''}" data-route="${key}"${active === key ? ' aria-current="page"' : ''}><span class="nav-icon">${icons[key]}</span><span class="nav-label">${label}</span></button>`).join('')}<i class="nav-active-indicator" aria-hidden="true"></i></nav>`;
}

export function chrome(content, active) {
  const refreshIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66"/><path d="M20 4v7h-7"/></svg>';
  return `<div class="layout"><header class="topbar"><button class="wordmark" data-route="home" aria-label="Go to Reading Room home"><div class="brand-mark"><img src="./assets/reading-room-logo.png?v=83" alt=""></div><span class="reading-room-wordmark">Reading Room</span></button><div class="top-actions"><button class="icon-btn" data-refresh aria-label="Refresh library">${refreshIcon}</button><button class="icon-btn" data-menu aria-label="Open menu"><span class="menu-bars"><i></i><i></i><i></i></span></button></div></header><main>${content}</main>${navigation(active)}</div>`;
}
