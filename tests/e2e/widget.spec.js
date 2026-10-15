import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const widget = '/widgets/currently-reading/index.html';
const setup = '/widgets/currently-reading/setup.html';
const user = { id:'11111111-1111-4111-8111-111111111111', aud:'authenticated', role:'authenticated', email:'reader@example.test' };
const book = {
  id:'22222222-2222-4222-8222-222222222222', title:'The Test Book', authors:'Example Author',
  overall_status:'Currently Reading', started_at:'2026-10-08T13:58:05.907434+00:00',
  current_page:42, total_pages:210, progress_percent:20,
  cover_url:'https://covers.openlibrary.org/b/id/285979-L.jpg?default=false'
};
const session = (expired = false) => ({
  access_token:`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+(expired?-120:3600)})).toString('base64url')}.test-signature`,
  refresh_token:'test-refresh-token', expires_at:Math.floor(Date.now()/1000)+(expired?-120:3600), token_type:'bearer', user
});
async function signIn(context, expired = false) {
  await context.addCookies([{ name:'rr-widget-session-v1', value:encodeURIComponent(JSON.stringify(session(expired))), domain:'127.0.0.1', path:'/widgets/currently-reading/', sameSite:'Strict' }]);
}
async function mock(page, { rows = [book], authStatus = 200, restStatus = 200, refreshStatus = 200 } = {}) {
  const requests = [];
  await page.route('https://fbbpovieqfsjunmqtxvf.supabase.co/**', async route => {
    const request = route.request();
    requests.push(request);
    const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ status:authStatus, json:authStatus === 200 ? user : { msg:'Session expired' } });
    if (path === '/auth/v1/token') return route.fulfill({ status:refreshStatus, json:refreshStatus === 200 ? { ...session(), expires_in:3600 } : { error:'invalid_grant', error_description:'Refresh token revoked' } });
    if (path === '/auth/v1/logout') return route.fulfill({ status:204 });
    if (path === '/rest/v1/v_library') return route.fulfill({ status:restStatus, json:restStatus === 200 ? rows : { message:'Unavailable' } });
    return route.abort();
  });
  await page.route('https://covers.openlibrary.org/**', route => route.fulfill({ contentType:'image/png', body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64') }));
  return requests;
}
async function ready(page) {
  await page.waitForFunction(() => window.__wweb2WaitMillisecondsToWidgetIsReady?.(1000) === 0);
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  for (const selector of ['.copy h1','.author','.progress-track','footer']) {
    const rect = await page.locator(selector).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize().height);
  }
}

test('widget independently renders canonical values at medium dimensions and links to the book', async ({ page, context }) => {
  const paths = [];
  page.on('request', request => paths.push(request.url()));
  const requests = await mock(page);
  await signIn(context);
  for (const [width,height] of [[329,155],[338,158],[360,170],[364,170],[402,186]]) {
    await page.setViewportSize({ width,height });
    await page.goto(widget);
    await ready(page);
    await expect(page.locator('#widget')).toHaveAttribute('data-state','book');
    await expect(page.getByRole('heading')).toHaveText('The Test Book');
    await expect(page.locator('.author')).toHaveText(book.authors);
    await expect(page.locator('.progress-meta')).toHaveText('42 / 210 pages20%');
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow','20');
    await expect(page.locator('.card')).toHaveAttribute('href',new RegExp(`/#/book/${book.id}$`));
    await expect(page.locator('.cover img')).toBeVisible();
    await noOverflow(page);
  }
  const query = new URL(requests.find(r => r.url().includes('/rest/')).url());
  expect(query.searchParams.get('limit')).toBe('1');
  expect(query.searchParams.get('order')).toBe('started_at.desc.nullslast,title.asc');
  expect(requests.every(r => !r.url().includes('test-refresh-token') && !r.url().includes('test-signature'))).toBe(true);
  expect(paths.some(path => /dist\/app.js|src\/styles\/app.css/.test(path))).toBe(false);
  expect(paths.some(path => path.includes('285979-M.jpg'))).toBe(true);
  await page.setViewportSize({width:338,height:158});
  await mkdir('output/playwright',{recursive:true});
  await page.screenshot({path:`output/playwright/widget-${test.info().project.name}.png`});
});

test('no current book and no session are useful states without anonymous library reads', async ({ page, context }) => {
  await page.setViewportSize({ width:338,height:158 });
  const requests = await mock(page, {rows:[]});
  await page.goto(widget);
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','auth');
  expect(requests).toHaveLength(0);
  await signIn(context);
  await page.reload();
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','empty');
  await expect(page.getByRole('heading')).toHaveText('Nothing currently open.');
});

test('long titles, no covers and canonical progress extremes fit', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width:329,height:155 });
  for (const [progress,total,label] of [[0,210,'0'],[100,210,'100'],[140,210,'100'],[-10,210,'0'],[null,null,null]]) {
    await page.unrouteAll({behavior:'wait'});
    await mock(page, { rows:[{ ...book,title:'A Very Long UnbrokenTitle'.repeat(12)+'<script>alert(1)</script>', authors:'An author with a very long name '.repeat(6),cover_url:null,progress_percent:progress,total_pages:total }] });
    await page.goto(widget);
    await ready(page);
    await expect(page.locator('.cover-fallback')).toBeVisible();
    await expect(page.locator('.cover img')).toHaveCount(0);
    if (label) await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow',label);
    else await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuetext','Total pages unknown');
    expect(await page.locator('#widget script').count()).toBe(0);
    await noOverflow(page);
  }
});

test('expired sessions refresh securely; revoked sessions and denied reads clear private snapshots', async ({ page, context }) => {
  await signIn(context,true);
  let requests = await mock(page);
  await page.goto(widget);
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','book');
  expect(requests.some(r => r.url().includes('grant_type=refresh_token'))).toBe(true);
  await page.unrouteAll({behavior:'wait'});
  await signIn(context,true);
  await mock(page,{refreshStatus:400});
  await page.reload();
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','auth');
  expect((await context.cookies()).filter(c => c.name.startsWith('rr-widget-'))).toHaveLength(0);
  for (const options of [{authStatus:401},{restStatus:403}]) {
    await page.unrouteAll({behavior:'wait'});
    await signIn(context);
    await mock(page,options);
    await page.reload();
    await ready(page);
    await expect(page.locator('#widget')).toHaveAttribute('data-state','auth');
    expect((await context.cookies()).filter(c => c.name.startsWith('rr-widget-'))).toHaveLength(0);
  }
});

test('snapshot survives a data outage only after verified auth, and live changes replace it', async ({ page, context }) => {
  await signIn(context);
  await mock(page);
  await page.goto(widget);
  await ready(page);
  await page.unrouteAll({behavior:'wait'});
  await mock(page,{restStatus:503});
  await page.reload();
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','cached');
  await expect(page.locator('.freshness')).toHaveText(/^Saved /);
  await page.unrouteAll({behavior:'wait'});
  await mock(page,{rows:[{...book,current_page:174,progress_percent:82.9}]});
  await page.reload();
  await ready(page);
  await expect(page.locator('.progress-meta')).toHaveText('174 / 210 pages83%');
  await page.unrouteAll({behavior:'wait'});
  await mock(page);
  await page.route('**/auth/v1/user',route => route.abort());
  await page.reload();
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','error');
  await expect(page.getByRole('heading')).not.toHaveText(book.title);
});

test('readiness waits for asynchronous data and cover, with bounded image failure', async ({ page, context }) => {
  await signIn(context);
  await mock(page);
  let releaseData;
  const dataGate = new Promise(resolve => { releaseData = resolve; });
  await page.route('**/rest/v1/v_library?**',async route => { await dataGate; await route.fulfill({json:[book]}); });
  let releaseCover;
  const coverGate = new Promise(resolve => { releaseCover = resolve; });
  await page.route('https://covers.openlibrary.org/**',async route => { await coverGate; await route.abort(); });
  await page.goto(widget);
  expect(await page.evaluate(() => window.__wweb2WaitMillisecondsToWidgetIsReady(1000))).toBe(250);
  releaseData();
  await expect(page.getByRole('heading')).toHaveText(book.title);
  expect(await page.evaluate(() => window.__wweb2WaitMillisecondsToWidgetIsReady(1000))).toBe(250);
  releaseCover();
  await ready(page);
  await expect(page.locator('.cover-fallback')).toBeVisible();
});

test('connection form keeps credentials out of URLs and disconnect removes cookies', async ({ page, context }) => {
  await mock(page);
  await page.goto(setup);
  await page.getByLabel('Email').fill('reader@example.test');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button',{name:'Connect widget',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Connected.');
  await expect(page.getByLabel('Password')).toHaveValue('');
  expect(page.url()).not.toContain('password');
  const cookie = (await context.cookies()).find(c => c.name === 'rr-widget-session-v1');
  expect(cookie.path).toBe('/widgets/currently-reading/');
  expect(decodeURIComponent(cookie.value)).not.toContain('reader@example');
  await page.getByRole('button',{name:'Disconnect widget'}).click();
  await expect(page.getByRole('status')).toContainText('Widget disconnected.');
  expect((await context.cookies()).filter(c => c.name.startsWith('rr-widget-'))).toHaveLength(0);
  await page.unrouteAll({behavior:'wait'});
  await mock(page,{refreshStatus:400});
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button',{name:'Connect widget',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Could not connect.');
  await expect(page.getByLabel('Password')).toHaveValue('');
});

test('stalled network and missing widget code always become ready with a useful error', async ({ page, context }) => {
  await signIn(context);
  await mock(page);
  await page.clock.install();
  await page.route('**/rest/v1/v_library?**', () => {});
  await page.goto(widget);
  expect(await page.evaluate(() => window.__wweb2WaitMillisecondsToWidgetIsReady(1000))).toBe(250);
  await page.clock.fastForward(16001);
  await ready(page);
  await expect(page.locator('#widget')).toHaveAttribute('data-state','error');
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.route('**/dist/widget.js?**',route => route.abort());
  await page.reload();
  await page.clock.fastForward(20001);
  await ready(page);
  await expect(page.getByRole('heading')).toHaveText('Unable to refresh');
});
