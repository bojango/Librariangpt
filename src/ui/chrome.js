export function navigation(active) {
  const items = [['home','⌂','Home'],['library','▦','Library'],['wishlist','♡','Wishlist'],['stats','◴','Stats']];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, icon, label]) => `<button class="nav-btn ${active === key ? 'active' : ''}" data-route="${key}"><span>${icon}</span><span>${label}</span></button>`).join('')}</nav>`;
}

export function chrome(content, active) {
  return `<div class="layout"><header class="topbar"><button class="wordmark" data-route="home" aria-label="Go to Reading Room home"><div class="brand-mark"><img src="./assets/reading-room-mark.svg" alt=""></div><span class="reading-room-wordmark">Reading Room</span></button><div class="top-actions"><button class="icon-btn" data-refresh aria-label="Refresh">↻</button><button class="icon-btn" data-menu aria-label="Menu"><span class="menu-bars"><i></i><i></i><i></i></span></button></div></header><main>${content}</main>${navigation(active)}</div>`;
}
