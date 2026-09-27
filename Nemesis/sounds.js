const Sounds = (() => {
  const els = {
    roulette: null,
    drop: null,
    equip: null,
    trade: null,
  };

  let muted = false;

  function init() {
    els.roulette = document.getElementById('sfx-roulette');
    els.drop = document.getElementById('sfx-drop');
    els.equip = document.getElementById('sfx-equip');
    els.trade = document.getElementById('sfx-trade');

    const savedMute = localStorage.getItem('nemesis_muted');
    muted = savedMute === 'true';

    Object.values(els).forEach((el) => {
      if (el) el.volume = 0.6;
    });
  }

  function play(name) {
    if (muted) return;
    const el = els[name];
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  }

  function stop(name) {
    const el = els[name];
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }

  function setMuted(value) {
    muted = value;
    localStorage.setItem('nemesis_muted', String(value));
  }

  function isMuted() {
    return muted;
  }

  function toggle() {
    setMuted(!muted);
    return muted;
  }

  return { init, play, stop, setMuted, isMuted, toggle };
})();

document.addEventListener('DOMContentLoaded', Sounds.init);
