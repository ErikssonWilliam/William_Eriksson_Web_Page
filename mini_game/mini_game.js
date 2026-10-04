/* ============================================================
   Lyckohjulet - CS:GO-style case reel, rigged so every spin wins.

   How the rig works: the winning prize is chosen FIRST (weighted by
   rarity), then the strip is built with that prize planted at a known
   index. The animation simply scrolls to that index. There is no losing
   slot on the strip at all, so the player cannot walk away empty-handed.
   ============================================================ */
(function () {
  'use strict';

  /* ---------- Prizes ----------
     `weight` is relative, not a percentage - the picker normalises it,
     so you can add or remove items without rebalancing the others. */
  var PRIZES = [
    { name: 'Klistermärken',  icon: '🏷️', tier: 'common',     weight: 22 },
    { name: 'Penna',          icon: '🖊️', tier: 'common',     weight: 20 },
    { name: 'Godispåse',      icon: '🍬', tier: 'common',     weight: 18 },
    { name: 'Choklad',        icon: '🍫', tier: 'uncommon',   weight: 12 },
    { name: 'Red Bull',       icon: '🥤', tier: 'uncommon',   weight: 12 },
    { name: 'Anteckningsbok', icon: '📓', tier: 'uncommon',   weight: 8  },
    { name: 'Kaffe',     icon: '☕', tier: 'rare',       weight: 6  },
    { name: 'Celsius',     icon: '🧊', tier: 'legendary',       weight: 6  },
  ];

  var TIER_LABEL = {
    common: 'Vanlig', uncommon: 'Ovanlig',
    rare: 'Sällsynt', legendary: 'Legendarisk'
  };

  var STRIP_LEN = 64;   // tiles built per spin
  var WIN_INDEX = 58;   // where the winner is planted - long run-up, short tail
  var SPIN_MS   = 6200;

  var strip    = document.getElementById('strip');
  var viewport = document.getElementById('viewport');
  var spinBtn  = document.getElementById('spin');
  var spinLbl  = document.getElementById('spin-label');
  var soundBtn = document.getElementById('sound');
  var soundLbl = document.getElementById('sound-label');
  var resultEl = document.getElementById('result');
  var haulEl   = document.getElementById('haul');
  var haulWrap = document.getElementById('haul-section');
  var resetBtn = document.getElementById('reset');

  var spinning = false;
  var soundOn  = true;
  var haul     = [];       // [{ name, icon, tier, count }]
  var lastWin  = null;     // kept so a resize can re-centre the reel

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Weighted pick ---------- */
  function pickPrize() {
    var total = 0, i;
    for (i = 0; i < PRIZES.length; i++) total += PRIZES[i].weight;
    var roll = Math.random() * total;
    for (i = 0; i < PRIZES.length; i++) {
      roll -= PRIZES[i].weight;
      if (roll <= 0) return PRIZES[i];
    }
    return PRIZES[PRIZES.length - 1];
  }

  /* ---------- Build the strip ---------- */
  function tile(prize) {
    var el = document.createElement('div');
    el.className = 'reel-item t-' + prize.tier;
    el.setAttribute('aria-hidden', 'true');   // the live region announces the result
    var icon = document.createElement('span');
    icon.className = 'icon';
    icon.textContent = prize.icon;
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = prize.name;
    el.appendChild(icon);
    el.appendChild(name);
    return el;
  }

  function buildStrip(winner) {
    var frag = document.createDocumentFragment();
    var prev = null;
    for (var i = 0; i < STRIP_LEN; i++) {
      var p;
      if (i === WIN_INDEX) {
        p = winner;
      } else {
        // Re-roll on an immediate repeat: weighted picking clusters badly
        // (runs of four identical tiles), which reads as a broken reel.
        var guard = 0;
        do { p = pickPrize(); } while (prev && p.name === prev.name && ++guard < 6);
      }
      prev = p;
      frag.appendChild(tile(p));
    }
    strip.innerHTML = '';
    strip.appendChild(frag);
  }

  /* ---------- Geometry ----------
     Measured from the DOM rather than assumed from CSS, so the maths
     survives the responsive --item-w / --item-gap changes. */
  function pitch() {
    var items = strip.children;
    if (items.length < 2) return 0;
    return items[1].offsetLeft - items[0].offsetLeft;
  }

  function offsetFor(index, jitter) {
    var p = pitch();
    var itemW = strip.children[0] ? strip.children[0].offsetWidth : 0;
    var centreOfItem = index * p + itemW / 2;
    return -(centreOfItem - viewport.clientWidth / 2 + jitter);
  }

  function setX(x) {
    strip.style.transform = 'translate3d(' + x + 'px, 0, 0)';
  }

  function currentX() {
    var m = window.getComputedStyle(strip).transform;
    if (!m || m === 'none') return 0;
    var parts = m.match(/matrix.*\((.+)\)/);
    if (!parts) return 0;
    var v = parts[1].split(', ');
    return parseFloat(v.length === 16 ? v[12] : v[4]) || 0;
  }

  /* ---------- Sound (synthesised, no asset files) ---------- */
  var ac = null;
  var audioBroken = false;
  function audio() {
    if (!soundOn || audioBroken) return null;
    try {
      if (!ac) {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) { audioBroken = true; return null; }
        ac = new Ctx();
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) {
      // Never let a blocked/unavailable audio context break the spin
      audioBroken = true;
      return null;
    }
  }

  function tick() {
    var c = audio();
    if (!c) return;
    var t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(1100, t);
    g.gain.setValueAtTime(0.035, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + 0.04);
  }

  function chime(tier) {
    var c = audio();
    if (!c) return;
    var notes = (tier === 'legendary') ? [523, 659, 784, 1047]
              : (tier === 'rare')      ? [523, 659, 784]
              : [523, 659];
    notes.forEach(function (hz, i) {
      var t = c.currentTime + i * 0.1;
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(hz, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.13, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + 0.4);
    });
  }

  /* ---------- Spin ---------- */
  function spin() {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    spinLbl.textContent = 'Snurrar…';
    resultEl.innerHTML = '';

    var winner = pickPrize();
    buildStrip(winner);

    // Land off-centre by up to ~30% of a tile so it never looks snapped.
    var itemW = strip.children[0].offsetWidth;
    var jitter = (Math.random() - 0.5) * itemW * 0.6;

    strip.style.transition = 'none';
    setX(0);
    // force a reflow so the reset position is committed before animating
    void strip.offsetWidth;

    var endX = offsetFor(WIN_INDEX, jitter);
    var duration = reduceMotion ? 400 : SPIN_MS;

    var anim = strip.animate(
      [{ transform: 'translate3d(0,0,0)' },
       { transform: 'translate3d(' + endX + 'px,0,0)' }],
      { duration: duration, easing: 'cubic-bezier(.12,.68,.16,1)', fill: 'forwards' }
    );

    // Tick once per tile crossing the centre marker
    var p = pitch();
    var lastIdx = -1;
    var ticking = true;
    (function loop() {
      if (!ticking) return;
      var idx = Math.floor((-currentX() + viewport.clientWidth / 2) / p);
      if (idx !== lastIdx) { lastIdx = idx; tick(); }
      requestAnimationFrame(loop);
    })();

    anim.onfinish = function () {
      ticking = false;
      anim.cancel();              // hand control back to the inline transform
      setX(endX);
      lastWin = { index: WIN_INDEX, jitter: jitter };
      spinning = false;
      spinBtn.disabled = false;
      spinLbl.textContent = 'Snurra igen';
      reveal(winner);
      chime(winner.tier);
    };
  }

  /* ---------- Result + haul ---------- */
  function reveal(prize) {
    var card = document.createElement('div');
    card.className = 'result-card t-' + prize.tier;
    card.innerHTML =
      '<span class="icon">' + prize.icon + '</span>' +
      '<div>' +
        '<p class="won">Du vann</p>' +
        '<h3></h3>' +
        '<span class="tier-chip t-' + prize.tier + '"></span>' +
      '</div>';
    card.querySelector('h3').textContent = prize.name;
    card.querySelector('.tier-chip').textContent = TIER_LABEL[prize.tier];
    resultEl.innerHTML = '';
    resultEl.appendChild(card);

    addToHaul(prize);
  }

  function addToHaul(prize) {
    var found = null;
    for (var i = 0; i < haul.length; i++) {
      if (haul[i].name === prize.name) { found = haul[i]; break; }
    }
    if (found) found.count++;
    else haul.push({ name: prize.name, icon: prize.icon, tier: prize.tier, count: 1 });
    renderHaul();
  }

  function renderHaul() {
    haulWrap.hidden = haul.length === 0;
    haulEl.innerHTML = '';
    haul.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 't-' + item.tier;
      var icon = document.createElement('span');
      icon.className = 'icon';
      icon.textContent = item.icon;
      var name = document.createElement('span');
      name.textContent = item.name;
      li.appendChild(icon);
      li.appendChild(name);
      if (item.count > 1) {
        var c = document.createElement('span');
        c.className = 'count';
        c.textContent = '×' + item.count;
        li.appendChild(c);
      }
      haulEl.appendChild(li);
    });
  }

  /* ---------- Wiring ---------- */
  spinBtn.addEventListener('click', spin);

  soundBtn.addEventListener('click', function () {
    soundOn = !soundOn;
    soundBtn.setAttribute('aria-pressed', String(soundOn));
    soundLbl.textContent = soundOn ? 'Ljud på' : 'Ljud av';
  });

  resetBtn.addEventListener('click', function () {
    haul = [];
    renderHaul();
  });

  /* Spacebar spins. Handy at the stand: no need to aim for the button.
     Skipped when a button or link has focus, because the browser already
     fires a click there on space - handling it here too would double-trigger. */
  document.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (e.repeat) return;                    // ignore key-held autorepeat
    var t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'A' ||
              t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
              t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();                      // stop the page scrolling
    spin();
  });

  // Keep the won tile under the marker when the window changes size
  window.addEventListener('resize', function () {
    if (spinning || !lastWin) return;
    setX(offsetFor(lastWin.index, lastWin.jitter));
  });

  // Idle state: a populated strip so the reel isn't empty before the first spin
  buildStrip(pickPrize());
  setX(0);

  document.getElementById('year').textContent = new Date().getFullYear();
})();
