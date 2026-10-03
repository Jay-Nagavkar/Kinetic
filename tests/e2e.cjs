// End-to-end smoke test in real Chromium using the simulated pose source (no camera needed).
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8000';
const shot = (p, n) => p.screenshot({ path: `/tmp/shots/${n}.png` });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push('pageerror: ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(BASE); await page.waitForSelector('#name');
  await shot(page, '01-onboard');
  await page.fill('#name', 'Shruti'); await page.fill('#group', 'Hostel A (Boys)'); await page.check('#age'); await page.click('#next');
  await page.waitForSelector('#c1'); await shot(page, '02-consent'); await page.click('#next');
  await page.waitForSelector('.yn'); for (const g of await page.$$('.yn')) await (await g.$('button[data-v="0"]')).click();
  await shot(page, '03-parq'); await page.click('#finish');
  await page.waitForSelector('#fc'); console.log('registered, home ok'); await shot(page, '04-home-empty');

  // Squat test, simulated
  await page.click('.tabs button[data-r="fitcheck"]'); await page.click('.test[data-k="squat"][data-m="test"]'); await page.click('#sim');
  await page.waitForSelector('#cnt'); await page.waitForTimeout(9000); await shot(page, '05-run-squat');
  await page.waitForSelector('#save', { timeout: 60000 });
  const res = await page.textContent('.card'); console.log('squat result card:', res.replace(/\s+/g, ' ').trim()); await shot(page, '06-result');
  await page.click('#save'); await page.waitForSelector('#fc');

  // Integrity gate: person leaves frame
  await page.click('.tabs button[data-r="fitcheck"]'); await page.click('.test[data-k="squat"][data-m="test"]'); await page.check('#bad'); await page.click('#sim');
  await page.waitForSelector('#save', { timeout: 60000 }); console.log('gate result:', (await page.textContent('.card')).replace(/\s+/g, ' ').trim()); await shot(page, '07-gate');
  console.log('save disabled for invalid:', await page.isDisabled('#save'));
  await page.click('#retry'); await page.click('#back');

  // Balance test (sim) quickly
  await page.click('.test[data-k="balance"][data-m="test"]'); await page.click('#sim'); await page.waitForSelector('#save', { timeout: 60000 });
  console.log('balance:', (await page.textContent('.card')).replace(/\s+/g, ' ').trim()); await page.click('#save'); await page.waitForSelector('#fc');
  await shot(page, '08-home-baseline');

  // Offline queue + sync
  await page.click('.tabs button[data-r="privacy"]'); await page.check('#air'); await page.click('.tabs button[data-r="home"]'); await page.click('#log'); await page.fill('#mins', '45'); await page.click('#save'); await page.waitForSelector('#fc');
  console.log('chip offline:', (await page.textContent('#netChip')).trim()); await shot(page, '09-offline');
  await page.click('.tabs button[data-r="privacy"]'); await page.uncheck('#air'); await page.waitForTimeout(1500);
  console.log('chip after reconnect:', (await page.textContent('#netChip')).trim());
  const me = await page.evaluate(async () => { const tok = await new Promise((r) => { const q = indexedDB.open('khelsetu'); q.onsuccess = () => { const g = q.result.transaction('kv').objectStore('kv').get('token'); g.onsuccess = () => r(g.result); }; }); return (await fetch('/api/me', { headers: { Authorization: 'Bearer ' + tok } })).json(); });
  console.log('server view of me:', JSON.stringify(me));

  // Hindi
  await page.selectOption('#lang', 'hi'); await page.click('.tabs button[data-r="home"]'); await shot(page, '10-home-hi'); await page.click('.tabs button[data-r="privacy"]'); await page.selectOption('#lang', 'en');

  // Squad
  await page.click('.tabs button[data-r="squad"]'); await page.fill('#sn', 'Floor 3 Warriors'); await page.click('#mk'); await page.waitForSelector('.codebox'); await shot(page, '11-squad');

  // Real-camera path without model file should fail gracefully
  await page.click('.tabs button[data-r="fitcheck"]'); await page.click('.test[data-k="pushup"][data-m="test"]'); await page.click('#go'); await page.waitForTimeout(1500);
  console.log('camera path message:', (await page.textContent('#hint')).trim()); await shot(page, '12-model-missing');

  // Admin
  const admin = await ctx.newPage(); await admin.goto(BASE + '/admin.html'); await admin.click('#seed'); await admin.waitForSelector('table'); await admin.screenshot({ path: '/tmp/shots/13-admin.png', fullPage: true });
  console.log('admin rows:', (await admin.$$eval('tbody tr', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ')))).join(' | '));
  console.log('ERRORS:', errors.length ? errors : 'none'); await browser.close();
})().catch((e) => { console.error('E2E FAIL', e); process.exit(1); });
