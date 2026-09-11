export function navigation(active) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.5 12 3.75l8.5 6.75v9.25h-6v-6h-5v6h-6z"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.25h4.5v15.5H4zM8.5 5.75H13v14H8.5zM14.25 4.75l4.1-1.1 3.75 14.9-4.1 1.1z"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 9.25c0 5.25-8.5 10-8.5 10s-8.5-4.75-8.5-10a4.75 4.75 0 0 1 8.5-2.9 4.75 4.75 0 0 1 8.5 2.9Z"/></svg>',
    stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5M12 3.5V12h8.5A8.5 8.5 0 0 0 12 3.5Z"/></svg>'
  };
  const items = [['home','Home'],['library','Library'],['wishlist','Wishlist'],['stats','Stats']];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, label]) => `<button class="nav-btn ${active === key ? 'active' : ''}" data-route="${key}"${active === key ? ' aria-current="page"' : ''}><span class="nav-icon">${icons[key]}</span><span class="nav-label">${label}</span><i class="nav-indicator" aria-hidden="true"></i></button>`).join('')}</nav>`;
}

export function chrome(content, active) {
  return `<div class="layout"><header class="topbar"><button class="wordmark" data-route="home" aria-label="Go to Reading Room home"><div class="brand-mark"><img src="./assets/reading-room-mark.svg" alt=""></div><span class="reading-room-wordmark">Reading Room</span></button><div class="top-actions"><button class="icon-btn" data-refresh aria-label="Refresh">↻</button><button class="icon-btn" data-menu aria-label="Menu"><span class="menu-bars"><i></i><i></i><i></i></span></button></div></header><main>${content}</main>${navigation(active)}</div>`;
}
