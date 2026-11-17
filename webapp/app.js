(function () {
  'use strict';
  var root = document.getElementById('downrabbit-app');
  if (!root) return;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CMDS = {
    windows: 'irm https://downrabbit.pages.dev/install.ps1 | iex',
    macos: 'curl -fsSL https://downrabbit.pages.dev/install.sh | sh',
    linux: 'curl -fsSL https://downrabbit.pages.dev/install.sh | sh',
    android: 'curl -fsSL https://downrabbit.pages.dev/install.sh | sh'
  };
  var NAMES = { windows: 'windows', macos: 'macOS', linux: 'linux', android: 'android' };
  var ua = navigator.userAgent || '';
  var os = /android/i.test(ua) ? 'android' : /win/i.test(ua) ? 'windows' : /mac/i.test(ua) ? 'macos' : 'linux';
  var osName = $('#os-name');
  var heroCmd = $('#hero-cmd');
  if (osName) osName.textContent = NAMES[os];
  if (heroCmd) heroCmd.textContent = CMDS[os];
  $$('.tab').forEach(function (t) { if (t.getAttribute('data-os') === os) t.classList.add('on'); });
  $$('.panel').forEach(function (p) { if (p.getAttribute('data-panel') === os) p.classList.add('on'); });
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
      $$('.panel').forEach(function (p) {
        p.classList.toggle('on', p.getAttribute('data-panel') === t.getAttribute('data-os'));
      });
    });
  });

  var Rig = (function () {
    var rig = $('#rig'), headLook = $('#r-head-look'), eyesLook = $('#r-eyes-look');
    var eyeL = $('#r-eye-l'), eyeR = $('#r-eye-r'), earL = $('#r-ear-l'), earR = $('#r-ear-r');
    var bubble = $('#rabbit-bubble');
    var bubbleText = bubble ? bubble.textContent : '';
    if (!rig || !eyeL) return { setState: function () {}, say: function () {} };
    var state = 'idle', look = { x: 0, y: 0 }, target = { x: 0, y: 0 };
    var blinkT = null, flickT = null, raf = null, revertT = null, sayT = null;
    function doBlink() {
      eyeL.classList.add('blink'); eyeR.classList.add('blink');
      setTimeout(function () { eyeL.classList.remove('blink'); eyeR.classList.remove('blink'); }, 210);
    }
    function scheduleBlink() {
      blinkT = setTimeout(function () {
        if (!reduced) {
          doBlink();
          if (Math.random() < 0.22) setTimeout(doBlink, 280);
        }
        scheduleBlink();
      }, 1900 + Math.random() * 4300);
    }
    function scheduleFlick() {
      flickT = setTimeout(function () {
        if (!reduced && state === 'idle') {
          var e = Math.random() < 0.5 ? earL : earR;
          e.classList.add('flick');
          setTimeout(function () { e.classList.remove('flick'); }, 580);
        }
        scheduleFlick();
      }, 3600 + Math.random() * 5200);
    }
    function frame() {
      look.x += (target.x - look.x) * 0.1;
      look.y += (target.y - look.y) * 0.1;
      if (eyesLook) eyesLook.style.transform = 'translate(' + (look.x * 4.5).toFixed(2) + 'px,' + (look.y * 3.5).toFixed(2) + 'px)';
      if (headLook) headLook.style.transform = 'rotate(' + (look.x * 3.2).toFixed(2) + 'deg)';
      raf = requestAnimationFrame(frame);
    }
    function onMove(e) {
      var r = rig.getBoundingClientRect();
      if (!r.width || !eyesLook) return;
      var cx = r.left + r.width / 2, cy = r.top + r.height * 0.42;
      target.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width * 0.9)));
      target.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height * 0.9)));
    }
    document.addEventListener('mousemove', onMove);
    if (!reduced) {
      raf = requestAnimationFrame(frame);
      scheduleBlink();
      scheduleFlick();
    }
    function setState(s) {
      state = s;
      rig.setAttribute('data-state', s);
      if (s === 'success') {
        target.x = 0; target.y = -0.3;
        clearTimeout(revertT);
        revertT = setTimeout(function () { setState('idle'); }, 1500);
      } else if (s === 'idle') {
        target.x = 0; target.y = 0;
      }
    }
    function say(msg, ms) {
      if (!bubble) return;
      bubble.textContent = msg;
      clearTimeout(sayT);
      sayT = setTimeout(function () { bubble.textContent = bubbleText; }, ms || 2400);
    }
    return { setState: setState, say: say };
  })();

  var toastT = null;
  function toast(msg) {
    var t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('on'); }, 2300);
  }

  function copyText(text) {
    function legacy() {
      return new Promise(function (res, rej) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy') ? res() : rej(new Error('copy failed'));
        } catch (e) {
          rej(e);
        } finally {
          document.body.removeChild(ta);
        }
      });
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(legacy);
    }
    return legacy();
  }

  function wireCopy(btn, getText) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      copyText(getText()).then(function () {
        toast('copied — paste it in your terminal');
        Rig.setState('success');
        Rig.say('copied. now run it.');
      }).catch(function () {
        toast('copy failed — select the text manually');
      });
    });
  }
  wireCopy($('#hero-copy'), function () { return $('#hero-cmd') ? $('#hero-cmd').textContent : ''; });
  $$('.panel .cp').forEach(function (b) {
    wireCopy(b, function () { return $('code', b.parentNode) ? $('code', b.parentNode).textContent : ''; });
  });

  var lines = $$('#term .ln');
  if (reduced || !('IntersectionObserver' in window)) {
    lines.forEach(function (l) { l.classList.add('on'); });
  } else {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.disconnect();
        lines.forEach(function (l, i) { setTimeout(function () { l.classList.add('on'); }, 150 * i); });
      });
    }, { threshold: 0.3 });
    var term = $('#term');
    if (term) io.observe(term);
  }

  var built = $('#built-with');
  var builtClose = $('#built-close');
  if (built && builtClose) {
    builtClose.addEventListener('click', function () { built.remove(); });
  }
})();
