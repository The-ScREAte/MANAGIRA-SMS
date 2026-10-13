/* Shared contrast logic is also tested with Node's existing test runner. */
(function (root) {
  let colorContext;
  function rgb(value) {
    const match = String(value).match(/^rgba?\(([^)]+)\)/);
    if (!match) {
      if (!root?.document || !String(value).startsWith('oklch(')) return null;
      if (!colorContext) colorContext = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      if (!colorContext) return null;
      colorContext.clearRect(0, 0, 1, 1);
      colorContext.fillStyle = value;
      colorContext.fillRect(0, 0, 1, 1);
      const pixel = colorContext.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
    }
    const values = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return values.length >= 3 ? values : null;
  }
  function luminance(color) {
    return color.slice(0, 3).map(n => {
      const v = n / 255;
      return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
    }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  }
  function contrastInk(color) {
    const l = luminance(color);
    return (l + .05) / .05 >= 1.05 / (l + .05) ? 'black' : 'white';
  }
  function neutral(color) {
    return color && Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)) < 35;
  }
  const api = { rgb, luminance, contrastInk, neutral };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  function start() {
    const body = document.body;
    if (!body.classList.contains('org-appearance')) return;
    const brandProbe = document.createElement('span');
    brandProbe.className = 'org-brand-probe';
    body.appendChild(brandProbe);
    const brandColor = rgb(getComputedStyle(brandProbe).backgroundColor);
    if (brandColor) body.style.setProperty('--oc-on-brand', `var(--oc-${contrastInk(brandColor)})`);
    brandProbe.remove();
    function background(element) {
      for (let el = element; el; el = el.parentElement) {
        const color = rgb(getComputedStyle(el).backgroundColor);
        if (color && (color.length < 4 || color[3] > .8)) return color;
      }
      return rgb(getComputedStyle(body).backgroundColor);
    }
    function refresh() {
      // Mark neutral legacy surfaces, never brand areas, charts, images or status colors.
      document.querySelectorAll('main * , #top-header .notif-panel, #top-header .search-results-dropdown, #header-nav-menu').forEach(el => {
        if (el.closest('svg, canvas, .hero, .banner, [data-appearance-choice]') || ['SCRIPT','STYLE','IMG','IFRAME'].includes(el.tagName)
          || el.matches('main, .ws-root, .page-shell, .page-wrap, .hub-wrapper, .hub-layout, .hub-main, .management-wrapper, .management-layout, .management-main, .settings-wrapper, .settings-layout, .settings-main, .cal-page, .embed-panel-body, .os-page')) return;
        const style = getComputedStyle(el);
        const bg = rgb(style.backgroundColor);
        if (!el.hasAttribute('data-appearance-surface') && bg && (bg.length < 4 || bg[3] > .8) && neutral(bg) && Math.min(...bg.slice(0, 3)) > 220) {
          el.setAttribute('data-appearance-surface', '');
        }
      });
      document.querySelectorAll('main *, #top-header *').forEach(el => {
        if (el.closest('svg, canvas, [data-appearance-choice]') || ['SCRIPT','STYLE','IMG','IFRAME'].includes(el.tagName)) return;
        const style = getComputedStyle(el);
        const bg = background(el);
        if (!bg) return;
        // Actual background contrast handles bright yellow brands, dark brands,
        // active menu icons and independent notification/status badge colors.
        const colored = !neutral(bg) || el.matches('button, .btn, .btn-primary, .ws-btn--primary, [class*="badge"], .ws-pill, .fc-event')
          || !!el.closest('.btn-primary, .ws-btn--primary, [class*="badge"], .fc-event');
        if (colored || el.matches('.notif-badge, .nav-link.active, .nav-sublink.active')) {
          el.setAttribute('data-appearance-ink', contrastInk(bg));
        } else if (neutral(rgb(style.color))) {
          el.setAttribute('data-appearance-ink', 'text');
        }
      });
      if (root.Chart && typeof root.Chart.getChart === 'function') {
        const tokens = getComputedStyle(body);
        document.querySelectorAll('canvas').forEach(canvas => {
          const chart = root.Chart.getChart(canvas);
          if (!chart) return;
          Object.values(chart.options.scales || {}).forEach(scale => {
            if (scale.ticks) scale.ticks.color = tokens.getPropertyValue('--oc-muted').trim();
            if (scale.grid) scale.grid.color = tokens.getPropertyValue('--oc-line').trim();
          });
          if (chart.options.plugins?.legend?.labels) chart.options.plugins.legend.labels.color = tokens.getPropertyValue('--oc-text').trim();
          chart.update('none');
        });
      }
    }
    let pending = false;
    function schedule() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; refresh(); });
    }
    refresh();
    new MutationObserver(schedule).observe(body, { childList: true, subtree: true });
    document.addEventListener('click', schedule);
    window.addEventListener('spa:pageLoaded', schedule);
    window.addEventListener('load', schedule, { once: true });
  }
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
  else start();
})(typeof window !== 'undefined' ? window : null);