const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:4000/account/login', { waitUntil: 'networkidle0' });
  await page.type('input[name="email"]', 'test.manager@example.com');
  await page.type('input[name="password"]', 'TestAccount@2026');
  await Promise.all([page.click('button[type="submit"]'), page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})]);
  await page.goto('http://localhost:4000/common/classDashboard/46/student/208?termId=150', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  const frame = await (await page.$('iframe.workspace-frame')).contentFrame();
  const r = await frame.evaluate(() => {
    const a = document.querySelector('a[href*="guardianDetails"]');
    const rect = a.getBoundingClientRect();
    const topEl = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    let prevented = null;
    document.addEventListener('click', e => { prevented = e.defaultPrevented; }, false);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    a.dispatchEvent(ev);
    return { href: a.href, rect: [rect.x, rect.y, rect.width, rect.height], vw: innerWidth, vh: innerHeight, topEl: topEl && (topEl.tagName + '.' + topEl.className), prevented: ev.defaultPrevented };
  });
  console.log(JSON.stringify(r));
  await browser.close();
})();
