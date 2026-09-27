const Roulette = (() => {
  let spinning = false;

  function rarityColor(rarity) {
    return {
      common: '#9aa5b5',
      uncommon: '#3ecf7f',
      rare: '#3e9dff',
      epic: '#c04ef7',
      legendary: '#ffb020',
    }[rarity] || '#9aa5b5';
  }

  function buildStrip(container, pool, winner) {
    container.innerHTML = '';
    const track = document.createElement('div');
    track.className = 'roulette-track';
    track.style.cssText = 'display:flex;gap:10px;transition:transform 5.5s cubic-bezier(0.12,0.8,0.1,1);will-change:transform;';

    const STRIP_LEN = 60;
    const winnerIndex = 50;
    const strip = [];
    for (let i = 0; i < STRIP_LEN; i++) {
      if (i === winnerIndex) strip.push(winner);
      else strip.push(pool[Math.floor(Math.random() * pool.length)]);
    }

    strip.forEach((it) => {
      const card = document.createElement('div');
      card.className = 'roulette-item';
      card.style.cssText = `flex:0 0 120px;height:140px;border-radius:12px;border:2px solid ${rarityColor(it.rarity)};
        background:rgba(20,25,40,0.8);display:flex;flex-direction:column;align-items:center;justify-content:center;
        box-shadow:0 0 14px ${rarityColor(it.rarity)}55;`;
      card.innerHTML = `<div style="width:60px;height:60px;background:rgba(255,255,255,0.06);border-radius:8px;margin-bottom:8px;"></div>
        <div style="font-size:11px;color:#e8ecf5;text-align:center;padding:0 6px;">${it.name}</div>`;
      track.appendChild(card);
    });

    container.appendChild(track);
    return { track, winnerIndex };
  }

  async function spin(container, pool, winner, opts = {}) {
    if (spinning) return;
    spinning = true;

    const sfx = document.getElementById('sfx-roulette');
    if (sfx) { sfx.currentTime = 0; sfx.play().catch(() => {}); }

    const { track, winnerIndex } = buildStrip(container, pool, winner);
    const cardWidth = 130;
    const containerWidth = container.clientWidth;
    const targetOffset = -(winnerIndex * cardWidth - containerWidth / 2 + cardWidth / 2);
    const jitter = Math.floor(Math.random() * 40) - 20;

    track.style.transform = `translateX(0px)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        track.style.transform = `translateX(${targetOffset + jitter}px)`;
      });
    });

    await new Promise((res) => setTimeout(res, 5600));

    const dropSfx = document.getElementById('sfx-drop');
    if (dropSfx) { dropSfx.currentTime = 0; dropSfx.play().catch(() => {}); }

    spinning = false;
    if (opts.onComplete) opts.onComplete(winner);
  }

  function isSpinning() {
    return spinning;
  }

  return { spin, isSpinning };
})();
