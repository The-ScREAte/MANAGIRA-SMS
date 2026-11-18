/* One confetti for every celebration (a new term, finishing the first-time setup, birthdays):
 * a canvas over the page, two waves fired from both lower corners and a shower across the top,
 * floating down like paper (light gravity, air drag, a sway and a flutter as each piece turns)
 * for about seven seconds, then a fade. The school's colour leads. Timed by the clock, so a
 * 120 Hz screen isn't twice as fast.
 * Fewer pieces on phones and small devices; nothing at all for anyone whose device asks for
 * less motion. Never blocks a click (pointer-events: none) and removes itself when done.
 *
 *   ManagiraConfetti.celebrate({ colors: ['#01535b'], zIndex: 12060 })
 *   ManagiraConfetti.celebrate({ container: popupOverlay })   // behind that popup's card
 */
(function () {
  'use strict';
  if (window.ManagiraConfetti) return;

  var BRIGHT = ['#f59e0b', '#ec4899', '#22c55e', '#3b82f6', '#fde047', '#8b5cf6', '#06b6d4', '#f97316'];

  function reducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function schoolColour() {
    var header = document.getElementById('top-header');
    var value = (header && getComputedStyle(header).getPropertyValue('--org-primary-color').trim())
      || getComputedStyle(document.documentElement).getPropertyValue('--org-primary-color').trim()
      || getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();
    return value || '#01535b';
  }

  function celebrate(options) {
    options = options || {};
    if (reducedMotion()) return Promise.resolve();
    var width = window.innerWidth;
    var height = window.innerHeight;
    var small = width < 640 || (typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= 4);
    var dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
    var brand = options.colors && options.colors.length ? options.colors : [schoolColour()];
    // The school's colour about a third of the pieces, bright ones the rest.
    var palette = brand.concat(brand, BRIGHT);

    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    // Inside a popup's overlay it sits behind the card (first in the overlay); else over the page.
    var inside = options.container && options.container.nodeType === 1 ? options.container : null;
    canvas.style.cssText = (inside ? 'position:absolute;' : 'position:fixed;z-index:' + (options.zIndex || 12060) + ';')
      + 'inset:0;width:100%;height:100%;pointer-events:none;';
    if (!inside) { canvas.style.width = '100vw'; canvas.style.height = '100vh'; }
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (inside) inside.insertBefore(canvas, inside.firstChild);
    else document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    var pieces = [];
    function rand(a, b) { return a + Math.random() * (b - a); }
    // delay in milliseconds; speeds are per 1/60 of a second (the clock keeps every screen the
    // same, 60 or 120 frames a second).
    function add(x, y, angle, speed, delay) {
      var ribbon = Math.random() < 0.3;
      pieces.push({
        x: x, y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        w: ribbon ? rand(3, 4.5) : rand(6, 10),
        h: ribbon ? rand(12, 18) : rand(8, 13),
        round: !ribbon && Math.random() < 0.22,
        color: palette[Math.floor(Math.random() * palette.length)],
        rot: rand(0, Math.PI * 2),
        spin: rand(-0.12, 0.12),
        tilt: rand(0, Math.PI * 2),
        tiltSpeed: rand(0.05, 0.12),
        sway: rand(0.4, 1.2),
        fall: rand(1.8, 3.2), // the most a piece falls each step: paper floats down
        delay: delay || 0
      });
    }
    // Two waves from the lower corners, aimed up and across, so pieces reach the middle and the top.
    var speedScale = Math.max(0.8, Math.min(1.3, height / 760));
    var perCannon = small ? 55 : 95;
    [0, 850].forEach(function (waveDelay, wave) {
      var count = wave ? Math.round(perCannon * 0.6) : perCannon;
      for (var i = 0; i < count; i += 1) {
        var aim = rand(-1.45, -0.7); // steep to wide
        var speed = rand(15, 27) * speedScale;
        add(rand(-10, 30), height + 10, aim, speed, waveDelay + rand(0, 260));
        add(width - rand(-10, 30), height + 10, Math.PI - aim, rand(15, 27) * speedScale, waveDelay + rand(0, 260));
      }
    });
    // A shower across the whole width from the top, while the first pieces turn back down.
    var shower = small ? 70 : 140;
    for (var j = 0; j < shower; j += 1) add(rand(0, width), rand(-220, -12), Math.PI / 2, rand(0.5, 2), rand(350, 2200));

    var GRAVITY = 0.16;
    var DURATION = 7000;   // ms
    var FADE = 1300;       // the last part fades out
    var started = 0;
    var last = 0;
    return new Promise(function (resolve) {
      function frame(now) {
        if (!started) { started = now; last = now; }
        var elapsed = now - started;
        var dt = Math.min(3, Math.max(0, (now - last) / 16.667));
        last = now;
        ctx.clearRect(0, 0, width, height);
        var alive = 0;
        var fade = elapsed > DURATION - FADE ? Math.max(0, (DURATION - elapsed) / FADE) : 1;
        for (var k = 0; k < pieces.length; k += 1) {
          var p = pieces[k];
          if (p.delay > elapsed) { alive += 1; continue; }
          var drag = Math.pow(0.986, dt);
          p.vx *= drag;
          p.vy = p.vy * drag + GRAVITY * dt;
          if (p.vy > p.fall) p.vy = p.fall;
          p.x += (p.vx + Math.sin(p.tilt) * p.sway) * dt;
          p.y += p.vy * dt;
          p.rot += p.spin * dt;
          p.tilt += p.tiltSpeed * dt;
          if (p.y > height + 40 && p.vy > 0) continue;
          alive += 1;
          ctx.save();
          ctx.globalAlpha = fade;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          // The flutter: a piece turning in the air looks narrower, then wider.
          ctx.scale(Math.cos(p.tilt), 1);
          ctx.fillStyle = p.color;
          if (p.round) {
            ctx.beginPath();
            ctx.ellipse(0, 0, p.w / 2, p.w / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
          ctx.restore();
        }
        if (alive && elapsed < DURATION && canvas.isConnected) {
          requestAnimationFrame(frame);
        } else {
          canvas.remove();
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  window.ManagiraConfetti = { celebrate: celebrate };
})();
