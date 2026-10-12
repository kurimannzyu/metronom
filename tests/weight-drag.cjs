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
  await page.locator('#tap').click();
  await enterDraft(page, String(value));
  await page.locator('#bpm-confirm').click();
}
async function enterDraft(page, value) {
  await page.locator('#bpm-clear').click();
  for (const digit of String(value)) {
    if (/^\d$/.test(digit)) await page.locator(`[data-digit="${digit}"]`).click();
    else await page.keyboard.press(digit);
  }
}
async function checkPosition(page) {
  const geometry = await page.locator('#weight').evaluate(weight => {
    const arm = document.querySelector('#arm');
    return { actual: parseFloat(weight.style.top), expected: weight.offsetHeight / 2 +
      (Number(document.querySelector('#bpm').textContent) - 30) / 270 * (arm.offsetHeight - weight.offsetHeight) };
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
    window.scheduledTones = [];
    const create = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const node = create.call(this), start = node.start, setFrequency = node.frequency.setValueAtTime;
      let frequency = 0;
      node.frequency.setValueAtTime = function(value, time) {frequency=value;return setFrequency.call(this,value,time)};
      node.start = function (time) { window.scheduledClicks.push(time);window.scheduledTones.push({time,type:node.type,frequency}); return start.call(this, time); };
      return node;
    };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  assert.equal(await page.locator('#bpm').innerText(), '93');
  assert.equal(await page.locator('#meter').innerText(), '3/4');
  assert.equal(await page.locator('#mute').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('blue-tempo-v1')).retained), 'legacy');
  assert.equal(await page.locator('#bpm').evaluate(e=>e.tagName),'DIV');
  assert.equal(await page.locator('#bpm').evaluate(e=>e.isContentEditable),false);
  await page.locator('#bpm').tap();
  assert.equal(await page.evaluate(()=>document.activeElement.tagName==='INPUT'),false);
  assert.equal(await page.locator('#bpm').innerText(),'93');
  assert.equal(await page.locator('#bpm-dialog #bpm-title, #bpm-dialog .bpm-range').count(),0);
  assert.equal(await page.locator('#bpm-confirm').innerText(),'セット');
  assert.equal(await page.locator('.help').count(), 0);
  assert.equal(await page.locator('#status').innerText(), '');
  assert.equal(await page.locator('#status').isVisible(), false);
  await setBpm(page, 147);
  await page.locator('#settings-open').click();
  await page.locator('#volume').fill('41');
  await page.locator('#accent').uncheck();
  await page.reload();
  assert.equal(await page.locator('#bpm').innerText(), '147');
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#volume').inputValue(), '41');
  assert.equal(await page.locator('#accent').isChecked(), false);
  await page.locator('#settings-close').click();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForFunction(async () => (await caches.open('blue-tempo-v11')).match('./index.html').then(Boolean));
  await context.setOffline(true);
  await page.reload();
  assert.equal(await page.locator('#bpm').innerText(), '147');
  assert.equal(await page.locator('#start').innerText(), 'START');
  await context.setOffline(false);
  assert.equal(await page.locator('header').count(), 0);
  // The arrow/right padding is part of the existing native button's tap target.
  const meterBox = await page.locator('#meter').boundingBox();
  assert.ok(meterBox.width >= 80 && meterBox.height >= 44);
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
  assert.equal(await page.locator('#bpm-entry').innerText(),'120');
  assert.equal(await page.locator('#bpm-dialog input').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.tagName==='INPUT'),false);
  await enterDraft(page,'200');await page.locator('#bpm-cancel').click();
  assert.equal(await page.locator('#bpm').innerText(),'120');
  for (const invalid of ['29','301','abc','']) {
    await page.locator('#tap').click();await enterDraft(page,invalid);
    assert.equal(await page.locator('#bpm-confirm').isDisabled(),true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#bpm-dialog').evaluate(d=>d.open),true);
    assert.equal(await page.locator('#bpm').innerText(),'120');
    await page.locator('#bpm-close').click();
  }
  for (const valid of ['30','300']) {
    await page.locator('#tap').click();await enterDraft(page,valid);await page.keyboard.press('Enter');
    assert.equal(await page.locator('#bpm').innerText(),valid);await checkPosition(page);
  }
  await page.locator('#tap').click();await enterDraft(page,'123');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#bpm').innerText(),'300');
  await setBpm(page,120);await page.locator('#start').click();
  await page.waitForFunction(()=>document.querySelector('#start').textContent==='STOP');
  await page.locator('#tap').tap();await enterDraft(page,'180');await page.locator('#bpm-confirm').tap();
  assert.equal(await page.locator('#start').innerText(),'STOP');assert.equal(await page.locator('#bpm').innerText(),'180');
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
  const repeatBox=await page.locator('#plus').boundingBox(), repeatBpm=Number(await page.locator('#bpm').innerText());
  await page.mouse.move(repeatBox.x+repeatBox.width/2,repeatBox.y+repeatBox.height/2);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();
  assert.ok(Number(await page.locator('#bpm').innerText())>=repeatBpm+3);await checkPosition(page);
  console.log('PASS: 12 aligned meters; keypad validation/cancel/live audio; modal settings and tabs; six backgrounds and legacy settings preserved; long press');
  // Equal-width controls and touch-only keypad at phone and desktop sizes.
  for (const [width,height] of [[320,568],[375,667],[390,844],[430,932],[1280,800]]) {
    await page.setViewportSize({width,height});
    const controls=await page.locator('.controls button').evaluateAll(buttons=>buttons.map(b=>{
      const r=b.getBoundingClientRect(),c=getComputedStyle(b);return {x:r.x,y:r.y,w:r.width,h:r.height,font:c.fontSize,radius:c.borderRadius,padding:c.padding};
    }));
    assert.equal(controls.length,3);
    for(const c of controls){for(const k of ['w','h','y'])assert.ok(Math.abs(c[k]-controls[0][k])<1);for(const k of ['font','radius','padding'])assert.equal(c[k],controls[0][k]);}
    assert.ok(Math.abs((controls[1].x-controls[0].x)-(controls[2].x-controls[1].x))<1);
    assert.ok(await page.locator('.controls').evaluate(e=>e.clientWidth<=360));
    assert.equal(await page.locator('.meter-label').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.locator('#tap').tap();
    assert.equal(await page.locator('#bpm-dialog input').count(),0);
    assert.equal(await page.evaluate(()=>document.activeElement.tagName==='INPUT'),false);
    await enterDraft(page,'29');assert.equal(await page.locator('#bpm-confirm').isDisabled(),true);
    await enterDraft(page,'301');assert.equal(await page.locator('#bpm-confirm').isDisabled(),true);
    await page.locator('#bpm-clear').tap();assert.equal(await page.locator('#bpm-confirm').isDisabled(),true);
    await enterDraft(page,'145');await page.locator('#bpm-delete').tap();assert.equal(await page.locator('#bpm-entry').innerText(),'14');
    await page.locator('[data-digit="0"]').tap();await page.locator('#bpm-confirm').tap();
    assert.equal(await page.locator('#bpm').innerText(),'140');await checkPosition(page);
  }
  // A distinct desktop context checks native keyboard and mouse interaction.
  const pcContext=await browser.newContext({viewport:{width:1280,height:800}}),pc=await pcContext.newPage();
  pc.on('pageerror',e=>errors.push(e.message));await pc.goto(`http://127.0.0.1:${server.address().port}`);
  await pc.locator('#tap').click();await pc.keyboard.type('123');assert.equal(await pc.locator('#bpm-entry').innerText(),'123');
  await pc.keyboard.press('Backspace');assert.equal(await pc.locator('#bpm-entry').innerText(),'12');
  await pc.keyboard.press('Delete');assert.equal(await pc.locator('#bpm-entry').innerText(),'1');
  await pc.keyboard.type('50');await pc.keyboard.press('Enter');assert.equal(await pc.locator('#bpm').innerText(),'150');
  await pc.locator('#tap').click();await enterDraft(pc,'200');await pc.keyboard.press('Escape');assert.equal(await pc.locator('#bpm').innerText(),'150');
  await pc.locator('#tap').click();await enterDraft(pc,'160');await pc.locator('#bpm-confirm').click();assert.equal(await pc.locator('#bpm').innerText(),'160');
  const pcRect=await pc.locator('#tap').boundingBox();assert.ok(pcRect.width<=120);
  await pc.locator('#settings-open').click();await pc.locator('#sound-tab').focus();await pc.keyboard.press('Tab');
  assert.equal(await pc.locator('#background-tab').evaluate(e=>document.activeElement===e),true);
  await pc.keyboard.press('Space');assert.equal(await pc.locator('#background-tab').getAttribute('aria-selected'),'true');
  await pc.locator('#sound-tab').focus();await pc.keyboard.press('Enter');assert.equal(await pc.locator('#sound-tab').getAttribute('aria-selected'),'true');
  await pc.locator('#background-tab').click();await pc.locator('[data-background="beige"]').click();await pc.keyboard.press('Escape');
  // All desktop controls support real mouse/keyboard events.
  await pc.locator('#bpm').click();await pc.keyboard.type('999');
  assert.equal(await pc.locator('#bpm').innerText(),'160');
  assert.equal(await pc.locator('#bpm').evaluate(e=>e.isContentEditable||e.tagName==='INPUT'),false);
  await pc.locator('#tap').focus();await pc.keyboard.press('Space');await pc.keyboard.type('180');await pc.keyboard.press('Enter');
  assert.equal(await pc.locator('#bpm').innerText(),'180');
  await pc.locator('#bpm').click();
  await pc.keyboard.type('123');await pc.keyboard.press('Backspace');await pc.keyboard.press('Enter');
  assert.equal(await pc.locator('#bpm').innerText(),'180');
  await pc.locator('#tap').click();assert.equal(await pc.locator('#bpm-entry').innerText(),'180');
  await enterDraft(pc,'240');await pc.locator('#bpm-cancel').focus();await pc.keyboard.press('Space');
  assert.equal(await pc.locator('#bpm').innerText(),'180');
  await pc.locator('#tap').click();await pc.locator('#bpm-close').focus();await pc.keyboard.press('Space');
  assert.equal(await pc.locator('#bpm-dialog').evaluate(d=>d.open),false);
  await pc.locator('#plus').focus();await pc.keyboard.press('Enter');assert.equal(await pc.locator('#bpm').innerText(),'181');
  await pc.keyboard.down('Space');await pc.waitForTimeout(650);await pc.keyboard.up('Space');
  assert.ok(Number(await pc.locator('#bpm').innerText())>=184);
  await pc.locator('#minus').focus();const minusStart=Number(await pc.locator('#bpm').innerText());
  await pc.keyboard.down('Enter');await pc.waitForTimeout(650);await pc.keyboard.up('Enter');
  assert.ok(Number(await pc.locator('#bpm').innerText())<=minusStart-3);
  const stable=await pc.locator('#bpm').innerText();await pc.waitForTimeout(150);assert.equal(await pc.locator('#bpm').innerText(),stable);
  await pc.locator('#mute').focus();const wasMuted=await pc.locator('#mute').getAttribute('aria-pressed');await pc.keyboard.press('Space');
  assert.notEqual(await pc.locator('#mute').getAttribute('aria-pressed'),wasMuted);await pc.keyboard.press('Enter');
  assert.equal(await pc.locator('#mute').getAttribute('aria-pressed'),wasMuted);
  for(const meter of ['1/4','2/4','3/4','4/4','5/4','6/4','3/8','5/8','6/8','7/8','9/8','12/8']){
    await pc.locator('#meter').focus();await pc.keyboard.press('Enter');
    await pc.locator(`[data-meter="${meter}"]`).focus();await pc.keyboard.press('Space');
    assert.equal(await pc.locator('#meter').innerText(),meter);
    assert.equal(await pc.locator('#beats i').count(),parseInt(meter));
  }
  await pc.locator('#settings-open').focus();await pc.keyboard.press('Space');await pc.locator('#sound-tab').focus();await pc.keyboard.press('Space');
  await pc.locator('#accent').focus();const accentBefore=await pc.locator('#accent').isChecked();await pc.keyboard.press('Space');
  assert.notEqual(await pc.locator('#accent').isChecked(),accentBefore);
  await pc.locator('#volume').focus();const volumeBefore=Number(await pc.locator('#volume').inputValue());await pc.keyboard.press('ArrowLeft');
  assert.equal(Number(await pc.locator('#volume').inputValue()),volumeBefore-1);
  const slider=await pc.locator('#volume').boundingBox();await pc.mouse.click(slider.x+slider.width*.25,slider.y+slider.height/2);
  assert.ok(Number(await pc.locator('#volume').inputValue())<volumeBefore-1);
  await pc.locator('[data-timbre="wood"]').click();assert.equal(await pc.locator('[data-timbre="wood"]').getAttribute('aria-pressed'),'true');
  await pc.locator('[data-timbre="soft"]').focus();await pc.keyboard.press('Space');assert.equal(await pc.locator('[data-timbre="soft"]').getAttribute('aria-pressed'),'true');
  await pc.locator('#background-tab').focus();await pc.keyboard.press('Enter');await pc.locator('[data-background="pink"]').focus();await pc.keyboard.press('Space');
  assert.equal(await pc.locator('[data-background="pink"]').getAttribute('aria-pressed'),'true');
  await pc.locator('#settings-close').focus();await pc.keyboard.press('Space');assert.equal(await pc.locator('#settings-dialog').evaluate(d=>d.open),false);
  await setBpm(pc,120);await pc.locator('#start').focus();await pc.keyboard.press('Space');
  await pc.waitForFunction(()=>document.querySelector('#start').textContent==='STOP');
  let dragBox;
  for(let attempt=0;attempt<30;attempt++){
    dragBox=await pc.locator('#weight').boundingBox();await pc.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);await pc.mouse.down();
    if(await pc.locator('#weight').evaluate(e=>e.classList.contains('dragging')))break;await pc.mouse.up();
  }
  assert.equal(await pc.locator('#weight').evaluate(e=>e.classList.contains('dragging')),true);
  await pc.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2+30,{steps:6});
  const dragged=Number(await pc.locator('#bpm').innerText());assert.ok(dragged>120);
  await pc.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2-20,{steps:6});
  assert.ok(Number(await pc.locator('#bpm').innerText())<120);await pc.mouse.up();await checkPosition(pc);
  assert.equal(await pc.locator('#start').innerText(),'STOP');
  await setBpm(pc,180);assert.equal(await pc.locator('#start').innerText(),'STOP');await checkPosition(pc);
  assert.notEqual(await pc.locator('#arm').evaluate(e=>e.style.transform),'');
  await pc.locator('#weight').focus();await pc.keyboard.press('ArrowDown');assert.equal(await pc.locator('#bpm').innerText(),'181');
  await pc.keyboard.press('Home');assert.equal(await pc.locator('#bpm').innerText(),'30');
  await pc.keyboard.press('End');assert.equal(await pc.locator('#bpm').innerText(),'300');
  await pc.locator('#start').focus();await pc.keyboard.press('Enter');assert.equal(await pc.locator('#start').innerText(),'START');
  await pc.reload();assert.equal(await pc.locator('#bpm').innerText(),'300');
  console.log('PASS: read-only BPM and simplified Set modal; all PC controls via keyboard/mouse, holds, live weight drag, no leaked keypad events');
  await pcContext.close();
  // Previous division values remain stored, but never subdivide the beat.
  assert.equal(await page.locator('#division').count(),0);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')).division),4);
  await page.setViewportSize({width:390,height:844});await setBpm(page,300);
  if(await page.locator('#mute').getAttribute('aria-pressed')==='true')await page.locator('#mute').click();
  await page.locator('#settings-open').click();await page.locator('#sound-tab').click();
  const expected={classic:{type:'triangle',normal:1200,strong:1800},wood:{type:'sine',normal:850,strong:1100},digital:{type:'square',normal:1600,strong:2100},soft:{type:'sine',normal:600,strong:780}};
  const beforeState=await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')));
  for(const [key,tone]of Object.entries(expected)){
    const before=await page.evaluate(()=>window.scheduledTones.length);
    await page.locator(`[data-timbre="${key}"]`).tap();await page.waitForTimeout(120);
    const voices=await page.evaluate(n=>window.scheduledTones.slice(n),before);
    assert.equal(voices.length,1);assert.equal(voices[0].type,tone.type);assert.equal(voices[0].frequency,tone.normal);
    assert.equal(await page.locator(`[data-timbre="${key}"]`).getAttribute('aria-pressed'),'true');
    const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')));
    for(const k of ['bpm','meter','volume','accent','mute','background','retained'])assert.equal(after[k],beforeState[k]);
  }
  await page.locator('#settings-close').click();await page.reload();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('blue-tempo-v1')).timbre),'soft');
  await page.locator('#settings-open').click();assert.equal(await page.locator('[data-timbre="soft"]').getAttribute('aria-pressed'),'true');await page.locator('#settings-close').click();
  await page.locator('#mute').click();await page.locator('#settings-open').click();
  const mutedCount=await page.evaluate(()=>window.scheduledTones.length);
  await page.locator('[data-timbre="digital"]').click();await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.scheduledTones.length),mutedCount);
  await page.locator('#settings-close').click();await page.locator('#mute').click();await page.locator('#settings-open').click();
  await page.locator('#volume').fill('0');const silentCount=await page.evaluate(()=>window.scheduledTones.length);
  await page.locator('[data-timbre="classic"]').click();await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>window.scheduledTones.length),silentCount);
  await page.locator('#volume').fill('41');await page.locator('#settings-close').click();
  await page.locator('#start').click();await page.waitForFunction(()=>document.querySelector('#start').textContent==='STOP');
  await page.locator('#settings-open').click();await page.locator('#accent').check();
  for(const [key,tone]of Object.entries(expected)){
    await page.locator(`[data-timbre="${key}"]`).click();await page.waitForTimeout(1000);
    const recent=await page.evaluate(()=>window.scheduledTones.slice(-4));
    assert.ok(recent.every(v=>v.type===tone.type));
    assert.ok(recent.some(v=>v.frequency===tone.strong));assert.ok(recent.some(v=>v.frequency===tone.normal));
    for(let i=1;i<recent.length;i++)assert.ok(Math.abs(recent[i].time-recent[i-1].time-.2)<.001);
    assert.equal(await page.locator('#start').innerText(),'STOP');
  }
  await page.locator('#accent').uncheck();await page.waitForTimeout(700);
  assert.ok((await page.evaluate(()=>window.scheduledTones.slice(-3))).every(v=>v.frequency===600));
  await page.locator('#settings-close').click();await page.locator('#start').click();
  // Offline startup and tone audition need no audio files or remote requests.
  await context.setOffline(true);await page.reload();await page.locator('#settings-open').click();
  const offlineBefore=await page.evaluate(()=>window.scheduledTones.length);
  await page.locator('[data-timbre="wood"]').click();await page.waitForTimeout(100);
  assert.equal(await page.evaluate(n=>window.scheduledTones.slice(n).length,offlineBefore),1);
  await page.locator('#settings-close').click();await context.setOffline(false);
  // Small-height panels scroll internally and never move the background page.
  await page.setViewportSize({width:320,height:400});await page.evaluate(()=>scrollTo(0,0));await page.locator('#settings-open').click();
  const scrollBefore=await page.evaluate(()=>scrollY);await page.locator('#settings-dialog').hover();await page.mouse.wheel(0,300);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>scrollY),scrollBefore);assert.ok(await page.locator('#settings-dialog').evaluate(d=>d.scrollHeight>d.clientHeight&&d.scrollTop>0));
  await page.locator('#settings-close').click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
  console.log('PASS: equal home controls; touch/mouse/keyboard keypad; PC tabs; four preview/live/offline tones; accent and one click per beat; legacy settings; internal panel scroll');
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
    const before = Number(await page.locator('#bpm').innerText()), scroll = await page.evaluate(() => scrollY);
    const travel = await page.evaluate(() => document.querySelector('#arm').offsetHeight - document.querySelector('#weight').offsetHeight);
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x, y: point.y + delta * step / 6 }] });
    }
    const after = Number(await page.locator('#bpm').innerText());
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
  assert.ok(Number(await page.locator('#bpm').innerText()) > 120);
  await page.mouse.up();
  await checkPosition(page);
  assert.equal(await page.locator('#weight').evaluate(w => w.classList.contains('dragging')), false);
  assert.deepEqual(errors, []);
  console.log('PASS: touch hit targets, both drag directions and conversion, no scrolling, live BPM/audio tempo, display-only BPM and +/- synchronization, mouse without capture, four phone sizes');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.close();
});
