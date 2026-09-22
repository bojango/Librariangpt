import { test, expect } from '@playwright/test';

test('cold launch renders the authentication shell without overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Reading Room');
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible();
  await expect(page.locator('#auth-form').getByRole('button', { name: 'Sign in' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('auth mode changes without navigation or duplicate forms', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-auth-mode="signup"]').click();
  await expect(page.locator('[data-auth-mode="signup"]')).toHaveClass(/active/);
  await expect(page.locator('#auth-form')).toHaveCount(1);
});

test('authenticated fixture supports route, filter and detail lifecycles', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'The Unfinished Harauld Hughes' })).toBeVisible();
  await page.locator('[data-route="library"]').first().click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.locator('[data-filter="Read"]').click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.book-card').click();
  await expect(page.locator('.detail-header[data-library-detail="ready"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quotes & passages 1' })).toBeVisible();
  await expect(page.locator('.rating-public')).toBeVisible();
  await expect(page.locator('related-books')).toHaveCount(1);
  await page.locator('[data-back]').press('Enter');
  await expect(page.getByRole('heading', { name: 'Read' })).toBeVisible();
});

test('currently-reading carousel and wishlist render directly', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-current-card]')).toHaveCount(2);
  await expect(page.locator('[data-carousel-dot]')).toHaveCount(2);
  await expect(page.locator('[data-current-card] .book-librarian-note, [data-current-card] .librarian-note')).toHaveCount(0);
  await page.locator('[data-route="wishlist"]').first().click();
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(2);
});

test('current-reading carousel keeps one height and settles each changed index once', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-current-card]')].every(card => card.style.height));
  await page.evaluate(() => { window.fixtureCarouselEvents.length = 0; window.carouselGeometry = []; });
  const sample = async () => page.evaluate(() => {
    const track = document.querySelector('.current-reading-track-v36');
    const rect = track.getBoundingClientRect();
    window.carouselGeometry.push({ top: rect.top, height: rect.height });
  });
  const scrollToCard = async index => {
    await page.locator('.current-reading-track-v36').evaluate((track, target) => {
      const card = track.querySelectorAll('[data-current-card]')[target];
      track.scrollTo({ left: card.offsetLeft, behavior: 'auto' });
    }, index);
    await expect(page.locator(`[data-carousel-dot="${index}"]`)).toHaveAttribute('aria-current', 'true');
    await sample();
  };

  await sample();
  await scrollToCard(1);
  await scrollToCard(0);
  await page.locator('[data-carousel-dot="1"]').click();
  await expect(page.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');
  await page.waitForFunction(() => window.fixtureCarouselEvents.at(-1)?.toIndex === 1);
  await sample();

  const result = await page.evaluate(() => ({
    geometry: window.carouselGeometry,
    events: window.fixtureCarouselEvents,
    cardHeights: [...document.querySelectorAll('[data-current-card]')].map(card => card.getBoundingClientRect().height)
  }));
  expect(new Set(result.geometry.map(item => item.top)).size).toBe(1);
  expect(new Set(result.geometry.map(item => item.height)).size).toBe(1);
  expect(new Set(result.cardHeights).size).toBe(1);
  expect(result.events.map(event => event.toIndex)).toEqual([1, 0, 1]);
});

test('Reading Room mobile chrome and homepage refinements use the intended geometry', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    const today = new Date();
    const longStart = new Date(today);
    longStart.setDate(today.getDate() - 56);
    window.fixtureRefresh({
      books: window.fixtureState.books.map(book => book.id === 'current-2'
        ? { ...book, title: 'Prey', authors: 'Michael Crichton', started_at: today.toISOString().slice(0, 10), current_page: 0, total_pages: 364, progress_percent: 0 }
        : book.id === 'current-1'
          ? { ...book, title: 'The Unfinished Harauld Hughes', authors: 'Richard Ayoade', started_at: longStart.toISOString().slice(0, 10), current_page: 82, total_pages: 182, progress_percent: 45 }
          : book),
      chapters: []
    });
  });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(50);

  const initial = await page.evaluate(() => {
    const style = selector => getComputedStyle(document.querySelector(selector));
    const refresh = document.querySelector('[data-refresh] svg');
    return {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      refreshPaths: [...refresh.querySelectorAll('path')].map(path => path.getAttribute('d')),
      refreshFill: refresh.getAttribute('fill'),
      refreshStroke: refresh.getAttribute('stroke'),
      headerButtonBorder: style('.topbar .icon-btn').borderTopColor,
      headerButtonBackground: style('.topbar .icon-btn').backgroundColor,
      activeFill: style('.nav-btn.active .nav-icon-solid').fill,
      activeSolidDisplay: style('.nav-btn.active .nav-icon-solid').display,
      inactiveSolidDisplay: style('.nav-btn:not(.active) .nav-icon-solid').display,
      cardBackground: style('.current-reading-card-v36').backgroundColor,
      cardBorder: style('.current-reading-card-v36').borderTopColor,
      comparisonBackground: style('.upnext-card').backgroundColor,
      comparisonBorder: style('.upnext-card').borderTopColor,
      progressFill: style('.current-reading-card-v36 .progress-fill').backgroundColor,
      eyebrow: style('.current-reading-label').color
    };
  });
  expect(initial.scrollWidth).toBe(initial.clientWidth);
  expect(initial.refreshPaths).toEqual(['M20 11a8 8 0 1 0-2.34 5.66', 'M20 4v7h-7']);
  expect(initial.refreshFill).toBe('none');
  expect(initial.refreshStroke).toBe('currentColor');
  expect(initial.headerButtonBorder).toBe('rgba(0, 0, 0, 0)');
  expect(initial.headerButtonBackground).toBe('rgba(0, 0, 0, 0)');
  expect(initial.activeFill).toBe('rgb(23, 22, 19)');
  expect(initial.activeSolidDisplay).not.toBe('none');
  expect(initial.inactiveSolidDisplay).toBe('none');
  expect(initial.cardBackground).toBe(initial.comparisonBackground);
  expect(initial.cardBorder).toBe(initial.comparisonBorder);
  expect(initial.progressFill).toBe('rgb(137, 100, 63)');
  expect(initial.eyebrow).toBe('rgb(96, 92, 83)');
  await expect(page.locator('.current-reading-age svg').first()).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.upnext-score')).toHaveText('9.2/10');
  await expect(page.locator('#ai-recommended-section')).not.toContainText('AI picks from beyond your library');
  await expect(page.locator('#ai-recommended-section .recommended-badge')).toHaveText('8.8');
  await expect(page.locator('#ai-recommended-section .recommended-card-score')).toHaveCount(0);

  const alignment = await page.evaluate(() => {
    const measure = card => {
      const cover = card.querySelector('.cover').getBoundingClientRect();
      const label = card.querySelector('.current-reading-label').getBoundingClientRect();
      const top = card.querySelector('.current-reading-top').getBoundingClientRect();
      const bottom = card.querySelector('.current-reading-bottom').getBoundingClientRect();
      const progress = card.querySelector('.progress-block').getBoundingClientRect();
      const actions = card.querySelector('.hero-actions').getBoundingClientRect();
      return {
        title: card.querySelector('h1').textContent,
        topDelta: label.top - cover.top,
        bottomDelta: actions.bottom - cover.bottom,
        flexibleGap: bottom.top - top.bottom,
        progressToActions: actions.top - progress.bottom,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      };
    };
    return {
      short: measure(document.querySelector('[data-current-card="current-2"]')),
      long: measure(document.querySelector('[data-current-card="current-1"]'))
    };
  });
  expect(alignment.short.title).toBe('Prey');
  expect(alignment.long.title).toBe('The Unfinished Harauld Hughes');
  expect(alignment.short.topDelta).toBeCloseTo(0, 5);
  expect(alignment.long.topDelta).toBeCloseTo(0, 5);
  expect(alignment.short.bottomDelta).toBeCloseTo(0, 5);
  expect(alignment.long.bottomDelta).toBeCloseTo(0, 5);
  expect(alignment.short.flexibleGap).toBeGreaterThan(alignment.long.flexibleGap);
  expect(alignment.long.flexibleGap).toBeGreaterThanOrEqual(0);
  expect(alignment.short.progressToActions).toBe(8);
  expect(alignment.long.progressToActions).toBe(8);
  expect(alignment.short.overflow).toBe(false);
  expect(alignment.long.overflow).toBe(false);

  const horizontalRows = await page.evaluate(async () => {
    const rows = [...document.querySelectorAll('.upnext-row, .recommended-row')];
    rows.forEach(row => {
      const card = row.firstElementChild;
      for (let index = 0; index < 3; index += 1) row.append(card.cloneNode(true));
    });
    await new Promise(resolve => requestAnimationFrame(resolve));
    return rows.map(row => {
      row.scrollLeft = row.scrollWidth;
      const style = getComputedStyle(row);
      const scrollbar = getComputedStyle(row, '::-webkit-scrollbar');
      return {
        className: row.className,
        overflowX: style.overflowX,
        scrollbarWidth: style.scrollbarWidth,
        webkitScrollbarDisplay: scrollbar.display,
        scrollLeft: row.scrollLeft,
        maxScroll: row.scrollWidth - row.clientWidth
      };
    });
  });
  for (const row of horizontalRows) {
    expect(row.overflowX).toBe('auto');
    expect(row.scrollbarWidth).toBe('none');
    expect(row.webkitScrollbarDisplay).toBe('none');
    expect(row.maxScroll).toBeGreaterThan(0);
    expect(row.scrollLeft).toBeGreaterThan(0);
  }

  const scrolled = await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 800);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const nav = document.querySelector('.bottom-nav');
    nav.classList.add('compact');
    const header = document.querySelector('.topbar').getBoundingClientRect();
    const icon = nav.querySelector('.nav-btn.active .nav-icon').getBoundingClientRect();
    const indicator = nav.querySelector('.nav-active-indicator').getBoundingClientRect();
    return { headerTop: header.top, navHeight: nav.getBoundingClientRect().height, indicatorGap: indicator.top - icon.bottom };
  });
  expect(scrolled.headerTop).toBe(0);
  expect(scrolled.navHeight).toBe(48);
  expect(scrolled.indicatorGap).toBe(3);

  const sidebar = await page.evaluate(() => {
    const wrapper = document.createElement('div');
    wrapper.className = 'sidebar-backdrop';
    wrapper.innerHTML = '<aside class="sidebar-panel">Menu</aside>';
    document.body.append(wrapper);
    const panel = wrapper.querySelector('.sidebar-panel');
    const rect = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    return { left: rect.left, borderLeft: style.borderLeftWidth, borderRight: style.borderRightWidth, shadow: style.boxShadow };
  });
  expect(sidebar.left).toBe(0);
  expect(sidebar.borderLeft).toBe('0px');
  expect(sidebar.borderRight).toBe('1px');
  expect(sidebar.shadow).toContain('30px 0px 80px');
});

test('Home and Library navigate to the routed recommendations page', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#ai-recommended-section [data-route="recommendations"]').click();
  await expect(page).toHaveURL(/#\/recommendations$/);
  await expect(page.locator('.recommendation-editorial-card')).toHaveCount(1);

  await page.locator('[data-route="library"]').first().click();
  await page.locator('.filters [data-route="recommendations"]').click();
  await expect(page).toHaveURL(/#\/recommendations$/);
  expect(await page.evaluate(() => window.fixtureState.filters.library)).toBe('All');
});

test('mobile current-reading cards stay compact without context and grow without overlap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const layout = await page.evaluate(() => {
    const box = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    };
    const compact = document.querySelector('[data-current-card="current-2"]');
    const contextual = document.querySelector('[data-current-card="current-1"]');
    const compactActions = compact.querySelector('.hero-actions').getBoundingClientRect();
    const compactProgress = compact.querySelector('.progress-block').getBoundingClientRect();
    const compactBounds = compact.getBoundingClientRect();
    const compactCover = compact.querySelector('.cover').getBoundingClientRect();
    return {
      compact: box('[data-current-card="current-2"]'),
      contextual: box('[data-current-card="current-1"]'),
      compactActionsBottom: compactActions.bottom,
      compactButtonGap: compactActions.top - compactProgress.bottom,
      compactBottom: compactBounds.bottom,
      compactCoverHeight: compactCover.height,
      progressHeight: compact.querySelector('.progress-track').getBoundingClientRect().height,
      dots: box('.current-reading-dots-v36')
    };
  });
  expect(layout.compact.height).toBeLessThanOrEqual(350);
  expect(layout.contextual.height).toBeLessThan(380);
  expect(layout.compactActionsBottom).toBeLessThanOrEqual(layout.compactBottom);
  expect(layout.compactButtonGap).toBeGreaterThanOrEqual(6);
  expect(layout.compactCoverHeight).toBeGreaterThan(180);
  expect(layout.progressHeight).toBe(10);
  expect(layout.dots.top).toBeGreaterThanOrEqual(layout.compact.bottom);
});

test('mobile reading layout balances the cover, fits all progress labels, and keeps Awards three-up', async ({ page }) => {
  for (const width of [390, 402, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
    const home = await page.locator('[data-current-card="current-2"]').evaluate(card => {
      const cover = card.querySelector('.cover').getBoundingClientRect();
      const copy = card.querySelector('.hero-copy').getBoundingClientRect();
      const style = getComputedStyle(card);
      return { cover: { top: cover.top, bottom: cover.bottom, right: cover.right }, copy: { top: copy.top, bottom: copy.bottom, left: copy.left }, paddingTop: parseFloat(style.paddingTop), paddingBottom: parseFloat(style.paddingBottom), overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    expect(home.copy.left - home.cover.right).toBeGreaterThanOrEqual(18);
    expect(home.paddingTop).toBe(27);
    expect(home.paddingBottom).toBe(27);
    expect(home.overflow).toBe(false);

    await page.goto('/tests/e2e/fixture.html#/book/current-1', { waitUntil: 'domcontentloaded' });
    const detail = await page.locator('.detail-copy-v4').evaluate(root => {
      const shelf = root.querySelector('.awards-shelf');
      const tiles = [...shelf.querySelectorAll('.award-tile')].map(tile => { const r = tile.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; });
      const buttons = [...root.querySelectorAll('.progress-actions .btn')].map(button => ({ text: button.textContent.trim(), fits: button.scrollWidth <= button.clientWidth }));
      return { awardCount: tiles.length, shelf: { clientWidth: shelf.clientWidth, scrollWidth: shelf.scrollWidth }, firstThree: tiles.slice(0, 3), buttons, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
    });
    expect(detail.awardCount).toBe(4);
    expect(detail.shelf.scrollWidth).toBeGreaterThan(detail.shelf.clientWidth);
    expect(detail.firstThree.at(-1).right - detail.firstThree[0].left).toBeLessThanOrEqual(detail.shelf.clientWidth + 1);
    expect(detail.buttons).toHaveLength(5);
    expect(detail.buttons.every(button => button.fits)).toBe(true);
    expect(detail.overflow).toBe(false);
  }
});

test('latest Librarian note appears only on the current book detail between ratings and Synopsis', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/current-1');
  const note = page.locator('.book-librarian-note');
  await expect(note).toContainText('You have moved quickly through this section.');
  const order = await page.locator('.detail-copy-v4').evaluate(root => ({
    rating: [...root.children].indexOf(root.querySelector('.rating-primary-row')),
    note: [...root.children].indexOf(root.querySelector('.book-librarian-note')),
    synopsis: [...root.children].indexOf(root.querySelector('.book-synopsis')),
    clipped: root.querySelector('.book-librarian-note p').scrollHeight > root.querySelector('.book-librarian-note p').clientHeight
  }));
  expect(order.rating).toBeLessThan(order.note);
  expect(order.note).toBeLessThan(order.synopsis);
  expect(order.clipped).toBe(false);

  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await expect(page.locator('.book-librarian-note')).toHaveCount(0);
});

test('header mark is visible and carousel memory follows ordered membership', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const mark = page.locator('.topbar .wordmark .brand-mark img');
  await expect(mark).toBeVisible();
  expect((await mark.boundingBox()).width).toBeGreaterThan(30);
  await expect(page.locator('[data-current-card]').first()).toHaveAttribute('data-current-card', 'current-2');

  await page.locator('[data-carousel-dot="1"]').click();
  await expect(page.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');
  await page.evaluate(() => window.fixtureRefresh({ upNext: [...window.fixtureState.upNext, { queue_id: 'queue-2', id: 'extra-1', title: 'Reserve', position: 2, source: 'AI' }] }));
  await expect(page.locator('[data-carousel-dot="1"]')).toHaveAttribute('aria-current', 'true');

  await page.evaluate(() => window.fixtureRefresh({ books: [...window.fixtureState.books, {
    id: 'current-new', title: 'Newest Current Read', authors: 'New Reader', overall_status: 'Currently Reading', ownership_status: 'Owned', started_at: '2026-09-13'
  }] }));
  await expect(page.locator('[data-current-card]').first()).toHaveAttribute('data-current-card', 'current-new');
  await expect(page.locator('[data-carousel-dot="0"]')).toHaveAttribute('aria-current', 'true');
});

test('Home limits Up Next to five while its manager exposes all reserves', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.fixtureRefresh({ upNext: Array.from({ length: 8 }, (_, index) => ({
    queue_id: `queue-${index + 1}`, id: `extra-${index}`, title: `Queued ${index + 1}`, position: index + 1, source: 'AI'
  })) }));
  await expect(page.locator('.upnext-row [data-upnext-id]')).toHaveCount(5);
  await expect(page.locator('.upnext-row [data-upnext-id="queue-6"]')).toHaveCount(0);
  await page.locator('[data-manage-upnext]').click();
  await expect(page.locator('#queue-manager-list [data-queue-id]')).toHaveCount(8);
});

test('long current title has its final class in initial markup and never mutates later', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const title = page.locator('[data-current-card="current-1"] h1');
  await expect(title).toHaveClass('current-title-compact-v37');
  await expect(title).toHaveAttribute('data-title-variant', 'compact');
  await expect(title).toHaveAttribute('style', /--current-title-size:clamp\(31px,5\.2vw,58px\)/);
  const initial = await title.getAttribute('class');
  const mutations = await title.evaluate(element => new Promise(resolve => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.filter(record => record.attributeName === 'class').length; });
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    requestAnimationFrame(() => requestAnimationFrame(() => { observer.disconnect(); resolve(count); }));
  }));
  expect(mutations).toBe(0);
  await expect(title).toHaveClass(initial);
  const beforeResume = await title.evaluate(element => ({ className: element.className, style: element.getAttribute('style') }));
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
  });
  expect(await title.evaluate(element => ({ className: element.className, style: element.getAttribute('style') }))).toEqual(beforeResume);
});

test('detail and modal layouts do not overflow a mobile viewport', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await expect(page.locator('.detail-header')).toBeVisible();
  await page.evaluate(() => { document.querySelector('#modal-root').innerHTML = '<div class="modal-backdrop"><div class="modal book-admin-modal"><h2>Settings</h2><textarea>Long content</textarea></div></div>'; });
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, modal: document.querySelector('.modal').getBoundingClientRect() }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.modal.width).toBeLessThanOrEqual(sizes.viewport);
});

test('book detail shows Goodreads only and uses a neutral unavailable state', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/extra-0');
  const rating = page.locator('.rating-public');
  await expect(rating).toContainText('4.23/5');
  await expect(rating).toContainText('9,876 ratings');
  await expect(rating).toHaveAttribute('href', 'https://www.goodreads.com/book/show/123');
  await expect(page.getByText('Open Library')).toHaveCount(0);

  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await expect(page.locator('.rating-public')).toContainText('GoodreadsRating unavailable');
  await expect(page.getByText('Open Library')).toHaveCount(0);
});

test('service worker shell references resolve', async ({ request }) => {
  const source = await (await request.get('/sw.js')).text();
  const assets = [...source.matchAll(/^\s*'\.\/([^']+)'/gm)].map(match => `/${match[1]}`);
  for (const asset of assets) expect((await request.get(asset)).ok(), asset).toBe(true);
});

test('service worker and document reference one coherent shell generation', async ({ request }) => {
  const html = await (await request.get('/index.html')).text();
  const worker = await (await request.get('/sw.js')).text();
  const generation = html.match(/name="reading-room-generation" content="(\d+)"/)?.[1];
  expect(generation).toBeTruthy();
  const assetGenerations = [...html.matchAll(/[?&]v=(\d+)/g)].map(match => match[1]);
  expect(new Set(assetGenerations)).toEqual(new Set([generation]));
  expect(worker).toContain(`const GENERATION = '${generation}'`);
  for (const value of [...worker.matchAll(/[?&]v=(\d+)/g)].map(match => match[1])) expect(value).toBe(generation);
});

test('rapid route changes only leave the final route rendered', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.evaluate(() => {
    location.hash = '#/library';
    location.hash = '#/wishlist';
    location.hash = '#/stats';
  });
  await expect(page.locator('.profile-card')).toBeVisible();
  await expect(page.locator('.profile-page-title h1')).toHaveCount(1);
});

test('rapid Home to Library to Home navigation renders Home completely', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.locator('[data-route="library"]').first().click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.locator('[data-route="home"]').first().click();
  await expect(page.locator('[data-carousel]')).toBeVisible();
  await expect(page.locator('#up-next-section')).toBeVisible();
  await expect(page.locator('#ai-recommended-section')).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
});

test('a failed cover keeps its reserved geometry and fallback', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  const cover = page.locator('[data-current-card="current-2"] .cover');
  await expect(cover).toBeVisible();
  await expect(cover).toHaveClass(/cover-failed/);
  await expect(cover.locator('.cover-fallback')).toBeVisible();
  await expect(cover.locator('.cover-image')).toBeHidden();
  const box = await cover.boundingBox();
  expect(box.height).toBeGreaterThan(100);
  expect(Math.abs((box.width / box.height) - (2 / 3))).toBeLessThan(0.03);
});

test('same-route refresh preserves exact Home scroll and skips unchanged paints', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  const before = await page.evaluate(() => ({ y: window.scrollY, paints: window.fixturePaints, hash: location.hash }));
  await page.locator('[data-current-card="current-1"] .cover-image').evaluate(image => { image.dataset.instanceMarker = 'preserve-me'; });

  await page.evaluate(() => window.fixtureRefresh({}));
  expect(await page.evaluate(() => window.fixturePaints)).toBe(before.paints);

  await page.evaluate(() => window.fixtureRefresh({ upNext: [{ queue_id: 'queue-1', id: 'wish-1', title: 'Wish Book', authors: 'Future Author', position: 1, source: 'Manual', locked: true, reason: 'Updated in the background.' }] }));
  const after = await page.evaluate(() => ({ y: window.scrollY, paints: window.fixturePaints, hash: location.hash }));
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(after.paints).toBe(before.paints + 1);
  expect(after.hash).toBe(before.hash);
  await expect(page.locator('[data-current-card="current-1"] .cover-image')).toHaveAttribute('data-instance-marker', 'preserve-me');
  await expect(page.locator('[data-current-card="current-1"] .cover-image')).toHaveCSS('opacity', '1');
});

test('catalogue cover priority is limited to the visible rows', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/library');
  await expect(page.locator('.library-grid .cover-image').first()).toHaveAttribute('loading', 'eager');
  await expect(page.locator('.library-grid .cover-image').first()).toHaveAttribute('fetchpriority', 'high');
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('loading', 'lazy');
  await page.locator('[data-route="wishlist"]').first().click();
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('loading', 'eager');
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('fetchpriority', 'high');
});

test('delayed cover starts from initial markup over an invariant fallback box', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/delayed-cover.svg', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#345"/></svg>' });
  });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const cover = page.locator('[data-current-card="current-1"] .cover');
  const before = await cover.boundingBox();
  await expect(cover.locator('.cover-fallback')).toBeVisible();
  await expect(cover.locator('img')).toHaveAttribute('src', '/delayed-cover.svg');
  await expect(cover.locator('img')).toHaveAttribute('loading', 'eager');
  await expect(cover.locator('img')).toHaveAttribute('fetchpriority', 'high');
  expect(await cover.locator('img').evaluate(image => getComputedStyle(image).opacity)).toBe('1');
  release();
  await expect(cover).toHaveClass(/cover-loaded/);
  const after = await cover.boundingBox();
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test('stale delayed cover cannot replace a newer URL during refresh', async ({ page }) => {
  let releaseOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/delayed-cover.svg', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="red"/></svg>' });
  });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const stateCover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="400" height="600" fill="green"/%3E%3C/svg%3E';
  await page.evaluate(url => window.fixtureSetCover(url), stateCover);
  const current = page.locator('[data-current-card="current-1"] .cover');
  await expect(current).toHaveAttribute('data-cover-url', stateCover);
  await expect(current).toHaveClass(/cover-loaded/);
  releaseOld();
  await page.waitForTimeout(100);
  await expect(current).toHaveAttribute('data-cover-url', stateCover);
  await expect(current.locator('img')).toHaveAttribute('data-cover-url', stateCover);
});

test('Home structural shelves render without a scroll event after navigation', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await page.locator('[data-route="home"]').first().click();
  await expect(page.locator('[data-carousel]')).toBeVisible();
  await expect(page.locator('#up-next-section')).toBeVisible();
  await expect(page.locator('#ai-recommended-section')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owned & unread' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe('service-worker-controlled document', () => {
  test.use({ serviceWorkers: 'allow' });

  test('reload keeps HTML, CSS and JavaScript on the same generation', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' });
    expect(await page.locator('meta[name="reading-room-generation"]').getAttribute('content')).toBe('81');
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /(?:app\.css|app\.js)/.test(name)));
    expect(resources.length).toBeGreaterThanOrEqual(2);
    expect(resources.every(url => new URL(url).searchParams.get('v') === '81')).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toContain('reading-room-shell-v81');
  });

  test('Test Mode can request aggregate service-worker diagnostic state', async ({ page }) => {
    await page.goto('/?test=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'load' });
    const state = await page.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => resolve(event.data);
      navigator.serviceWorker.controller.postMessage({ type: 'GET_DIAGNOSTIC_STATE' }, [channel.port2]);
    }));
    expect(state).toMatchObject({
      generation: '81',
      shell_cache: 'reading-room-shell-v81',
      cover_cache: 'reading-room-covers-v3',
      award_logo_cache: 'reading-room-award-logos-v1',
      award_logo_cache_hits: 0,
      award_logo_cache_misses: 0,
      award_logo_network_fetches: 0
    });
    expect(state.cover_cache_hits).toBeGreaterThanOrEqual(0);
    expect(state.cover_cache_misses).toBeGreaterThanOrEqual(0);
    expect(state.cover_network_fetches).toBeGreaterThanOrEqual(0);
  });
});
