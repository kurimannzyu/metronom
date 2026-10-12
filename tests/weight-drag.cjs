// Requires Playwright and Chromium; CHROMIUM_EXECUTABLE_PATH may select a local browser.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const files = new Set(['index.html', 'style.css', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']);
const server = http.createServer(async (req, res) => {
  const file = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
  if (!files.has(file)) { res.writeHead(404).end(); return; }
  try {
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(await fs.readFile(path.join(root, file)));
  } catch { res.writeHead(404).end(); }
});
let browser;
async function setBpm(page, value) {
  await page.locator('#bpm').fill(String(value));
  await page.locator('#bpm').press('Enter');
}
async function checkPosition(page) {
  const geometry = await page.locator('#weight').evaluate(weight => {
    const arm = document.querySelector('#arm');
    return { actual: parseFloat(weight.style.top), expected: weight.offsetHeight / 2 +
      (Number(document.querySelector('#bpm').value) - 30) / 270 * (arm.offsetHeight - weight.offsetHeight) };
  });
  assert.ok(Math.abs(geometry.actual - geometry.expected) < 0.01);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('legacy-seeded')) {
      localStorage.setItem('blue-tempo-v1', JSON.stringify({bpm:93,meter:'3/4',division:4,accent:false,volume:55,mute:true,retained:'legacy'}));
      sessionStorage.setItem('legacy-seeded','yes');
    }
    window.scheduledClicks = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = create.call(this), start = node.start;
      node.start = function (time) { window.scheduledClicks.push(time); return start.call(this, time); };
      return node;
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#bpm').inputValue(), '93');
  assert.equal(await page.locator('#meter').innerText(), '3/4');
  assert.equal(await page.locator('#mute').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('blue-tempo-v1')).retained), 'legacy');
  assert.equal(await page.locator('.help').count(), 0);
  assert.equal(await page.locator('#status').innerText(), '');
  assert.equal(await page.locator('#status').isVisible(), false);
  await setBpm(page, 147);
  await page.locator('#settings-open').click();
  await page.locator('#volume').fill('41');
  await page.locator('#accent').uncheck();
  await page.locator('#division').selectOption('2');
  await page.reload();
  assert.equal(await page.locator('#bpm').inputValue(), '147');
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#volume').inputValue(), '41');
  assert.equal(await page.locator('#accent').isChecked(), false);
  assert.equal(await page.locator('#division').inputValue(), '2');
  await page.locator('#division').selectOption('1');
  await page.locator('#settings-close').click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => (await caches.open('blue-tempo-v9')).match('./index.html').then(Boolean));
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('#bpm').inputValue(), '147');
  assert.equal(await page.locator('#start').innerText(), 'START');
  await context.setOffline(false);
  assert.equal(await page.locator('header').count(), 0);
  // The arrow/right padding is part of the existing native button's tap target.
  const meterBox = await page.locator('#meter').boundingBox();
  assert.ok(meterBox.width >= 90 && meterBox.height >= 44);
  await page.touchscreen.tap(meterBox.x + meterBox.width - 8, meterBox.y + meterBox.height / 2);
  assert.equal(await page.locator('#meter-dialog').evaluate(d => d.open), true);
  await page.locator('[data-meter="12/8"]').click();
  assert.equal(await page.locator('#meter').innerText(), '12/8');
  await page.reload();
  assert.equal(await page.locator('#meter').innerText(), '12/8');
  await page.locator('#meter').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#meter-dialog').evaluate(d => d.open), true);
  await page.locator('[data-meter="4/4"]').click();
  assert.equal(await page.locator('#meter').innerText(), '4/4');
  // All meter numbers share font metrics, row heights and fixed geometry.
  for (const [width,height] of [[320,568],[390,844],[430,932]]) {
    await page.setViewportSize({width,height});
    await page.locator('#meter').click();
    const metrics = await page.locator('#meter-grid button').evaluateAll(buttons => buttons.map(b => {
      const style = getComputedStyle(b), r = b.getBoundingClientRect(), rows = [...b.children].map(n => n.getBoundingClientRect());
      return {font:style.fontFamily,size:style.fontSize,weight:style.fontWeight,w:r.width,h:r.height,
        top:rows[0].top-r.top,bottom:rows[1].top-r.top,rowHeight:rows[0].height,rowWidth:rows[0].width,
        scrollWidth:b.children[0].scrollWidth,clientWidth:b.children[0].clientWidth};
    }));
    assert.equal(metrics.length,12);
    for (const metric of metrics) {
      for (const key of ['font','size','weight']) assert.equal(metric[key],metrics[0][key]);
      for (const key of ['w','h','top','bottom','rowHeight']) assert.ok(Math.abs(metric[key]-metrics[0][key])<1);
      assert.ok(metric.scrollWidth<=metric.clientWidth);
    }
    const button = page.locator('[data-meter="12/8"]'), before=await button.boundingBox();
    await button.click();await page.locator('#meter').click();const after=await button.boundingBox();
    assert.deepEqual(after,before);
    await page.locator('#meter-close').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:390,height:844});
  await page.locator('#meter').click();await page.locator('[data-meter="4/4"]').click();
  // TAP edits BPM; it never estimates a tempo from repeated taps.
  await setBpm(page,120);
  await page.locator('#tap').tap();
  assert.equal(await page.locator('#bpm-entry').inputValue(),'120');
  assert.equal(await page.locator('#bpm-entry').getAttribute('inputmode'),'numeric');
  assert.equal(await page.locator('#bpm-entry').evaluate(i=>i===document.activeElement),true);
  await page.locator('#bpm-entry').fill('200');await page.locator('#bpm-cancel').click();
  assert.equal(await page.locator('#bpm').inputValue(),'120');
  for (const invalid of ['29','301','abc','']) {
    await page.locator('#tap').click();await page.locator('#bpm-entry').fill(invalid);
    await page.locator('#bpm-form button[type="submit"]').click();
    assert.equal(await page.locator('#bpm-dialog').evaluate(d=>d.open),true);
    assert.equal(await page.locator('#bpm').inputValue(),'120');
    await page.locator('#bpm-close').click();
  }
  for (const valid of ['30','300']) {
    await page.locator('#tap').click();await page.locator('#bpm-entry').fill(valid);await page.locator('#bpm-entry').press('Enter');
    assert.equal(await page.locator('#bpm').inputValue(),valid);await checkPosition(page);
  }
  await page.locator('#tap').click();await page.locator('#bpm-entry').fill('123');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bpm').inputValue(),'300');
  await setBpm(page,120);await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#start').textContent==='STOP');
  await page.locator('#tap').tap();await page.locator('#bpm-entry').fill('180');await page.locator('#bpm-form button[type="submit"]').tap();
  assert.equal(await page.locator('#start').innerText(),'STOP');assert.equal(await page.locator('#bpm').inputValue(),'180');
  await checkPosition(page);await page.waitForTimeout(900);
  const tempoClicks=await page.evaluate(()=>window.scheduledClicks.slice(-2));
  assert.ok(Math.abs(tempoClicks[1]-tempoClicks[0]-60/180)<0.001);
  await page.locator('#settings-open').tap();
  assert.equal(await page.locator('#settings-dialog').evaluate(d=>d.open),true);
  assert.equal(await page.locator('#sound-panel p').count(),0);
  await page.locator('#accent').check();assert.equal(await page.locator('#accent-state').innerText(),'ON');
  assert.equal(await page.locator('#start').innerText(),'STOP');
  await page.locator('#background-tab').tap();
  assert.equal(await page.locator('#background-tab').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('#sound-panel').isVisible(),false);
  const colors=await page.locator('#background-options button').count();assert.equal(colors,6);
  for (const color of ['current','blue','mint','pink','beige','gray']) {
    await page.locator(`[data-background="${color}"]`).tap();
    assert.equal(await page.locator(`[data-background="${color}"]`).getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')).background),color);
    const value=await page.locator(`[data-background="${color}"] .color-swatch`).evaluate(e=>getComputedStyle(e).backgroundColor);
    assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),value);
  }
  await page.locator('[data-background="mint"]').tap();
  await page.locator('#background-tab').focus();await page.keyboard.press('ArrowLeft');assert.equal(await page.locator('#sound-tab').getAttribute('aria-selected'),'true');
  await page.locator('#settings-close').tap();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  assert.equal(await page.locator('#start').innerText(),'STOP');await page.locator('#start').click();
  await page.reload();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')).background),'mint');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')).retained),'legacy');
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(234, 245, 239)');
  await page.locator('#settings-open').click();await page.locator('#background-tab').click();
  assert.equal(await page.locator('[data-background="mint"]').getAttribute('aria-pressed'),'true');
  await page.locator('#settings-close').click();
  // Native modal Escape and backdrop restore focus and scrolling.
  await page.locator('#settings-open').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#settings-dialog').evaluate(d=>d.open),false);
  assert.equal(await page.locator('#settings-open').evaluate(e=>document.activeElement===e),true);
  await page.locator('#settings-open').click();await page.touchscreen.tap(5,5);
  assert.equal(await page.locator('#settings-dialog').evaluate(d=>d.open),false);
  await page.locator('#plus').scrollIntoViewIfNeeded();
  const repeatBox=await page.locator('#plus').boundingBox(), repeatBpm=Number(await page.locator('#bpm').inputValue());
  await page.mouse.move(repeatBox.x+repeatBox.width/2,repeatBox.y+repeatBox.height/2);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
  assert.ok(Number(await page.locator('#bpm').inputValue())>=repeatBpm+3);await checkPosition(page);
  console.log('PASS: 12 aligned meters; TAP validation/cancel/live audio; modal settings and tabs; six backgrounds and legacy settings preserved; long press');
  const cdp = await context.newCDPSession(page);
  async function touchDrag(delta, running = false) {
    if (running) {
      await page.locator('#start').click();
      await page.waitForFunction(() => document.querySelector('#start').textContent === 'STOP');
    }
    let point;
    // Pick the moving handle's actual hit location, rather than a stale bounding box.
    for (let attempt = 0; attempt < 30; attempt++) {
      point = await page.locator('#weight').evaluate(w => {
        const r = w.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      if (await page.locator('#weight').evaluate(w => w.classList.contains('dragging'))) break;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    assert.equal(await page.locator('#weight').evaluate(w => w.classList.contains('dragging')), true);
    const before = Number(await page.locator('#bpm').inputValue()), scroll = await page.evaluate(() => scrollY);
    const travel = await page.evaluate(() => document.querySelector('#arm').offsetHeight - document.querySelector('#weight').offsetHeight);
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + delta * step / 6 }] });
    }
    const after = Number(await page.locator('#bpm').inputValue());
    assert.equal(after, Math.max(30, Math.min(300, Math.round(before + delta / travel * 270))));
    await checkPosition(page);
    assert.equal(await page.evaluate(() => scrollY), scroll);
    if (running) {
      assert.equal(await page.locator('#start').innerText(), 'STOP');
      await page.waitForTimeout(700);
      const clicks = await page.evaluate(() => window.scheduledClicks.slice(-3));
      assert.ok(clicks.length >= 2);
      assert.ok(Math.abs(clicks.at(-1) - clicks.at(-2) - 60 / after) < 0.001);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('#weight').evaluate(w => w.classList.contains('dragging')), false);
    if (running) await page.locator('#start').click();
  }
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932]]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => scrollTo(0, 0));
    await setBpm(page, 105);
    const hit = await page.locator('#weight').evaluate(w => {
      const r = w.getBoundingClientRect();
      return [-20, 0, 20].map(dx => document.elementFromPoint(r.x + r.width / 2 + dx, r.y + r.height / 2)?.id);
    });
    assert.deepEqual(hit, ['weight', 'weight', 'weight']);
    assert.equal(await page.locator('#weight').evaluate(w => getComputedStyle(w).touchAction), 'none');
    await touchDrag(45);
    await touchDrag(-30);
    for (const value of [30, 300]) { await setBpm(page, value); await checkPosition(page); }
    await page.locator('#minus').click(); await checkPosition(page);
    await page.locator('#plus').click(); await checkPosition(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await setBpm(page, 120);
  await touchDrag(70, true);
  // A cancelled touch must not leave the handle or the page locked.
  const touchBox = await page.locator('#weight').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height / 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  assert.equal(await page.locator('#weight').evaluate(w => w.classList.contains('dragging')), false);
  await touchDrag(-20);
  // Make the test page scrollable without relying on product help content.
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '600px';
    document.body.append(spacer);
  });
  await page.evaluate(() => scrollTo(0, 0));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 10, y: 600 }] });
  for (let step = 1; step <= 6; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 10, y: 600 - step * 40 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await page.evaluate(() => scrollY > 0));
  await page.evaluate(() => scrollTo(0, 0));
  // Let native touch-scroll momentum settle before measuring mouse coordinates.
  await page.waitForTimeout(350);
  await page.evaluate(() => scrollTo(0, 0));
  // Non-touch pointers must remain usable even if Safari rejects pointer capture.
  await page.setViewportSize({ width: 1280, height: 800 });
  await setBpm(page, 120);
  await page.locator('#weight').evaluate(w => { w.setPointerCapture = () => { throw new Error('capture unavailable'); }; });
  const box = await page.locator('#weight').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 40, { steps: 6 });
  assert.ok(Number(await page.locator('#bpm').inputValue()) > 120);
  await page.mouse.up();
  await checkPosition(page);
  assert.equal(await page.locator('#weight').evaluate(w => w.classList.contains('dragging')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: touch hit targets, both drag directions and conversion, no scrolling, live BPM/audio tempo, direct input and +/- synchronization, mouse without capture, four phone sizes');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
