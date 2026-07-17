// Floating "HYPE ME UP" button, injected via JS the same way
// topbar.js injects the shared nav — no HTML edits needed elsewhere.
// Requires hype-audio.js to already be loaded on the page.
(function () {
  'use strict';

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = [
      '#hype-btn { position: fixed; bottom: 84px; right: 16px; z-index: 9998;',
      '  background: #d81e1e; color: #fff; border: none; border-radius: 999px;',
      '  padding: 14px 20px; font-weight: 700; font-size: 14px;',
      '  box-shadow: 0 4px 12px rgba(0,0,0,.35); cursor: pointer; }',
      '#hype-btn:active { transform: scale(0.96); }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function injectButton() {
    if (document.getElementById('hype-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'hype-btn';
    btn.type = 'button';
    btn.textContent = '🔥 HYPE ME UP';
    btn.onclick = function () {
      if (!window.HypeAudio) return;
      const clip = window.HypeAudio.pickRandom({ pillar: 'iron' });
      if (!clip) {
        alert('No iron clips yet — add some from the hype-audio app.');
        return;
      }
      window.HypeAudio.playClip(clip);
    };
    document.body.appendChild(btn);
  }

  function init() {
    injectStyles();
    injectButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
