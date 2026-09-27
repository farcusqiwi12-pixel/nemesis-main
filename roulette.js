const Roulette = (() => {
  let opening = false;

  const COLORS = {
    common: '#9aa5b5',
    uncommon: '#46d58a',
    rare: '#4aa8ff',
    epic: '#c56cff',
    legendary: '#ffbf55'
  };

  function rarityColor(rarity) {
    return COLORS[rarity] || COLORS.common;
  }

  function rarityLabel(rarity) {
    return ({
      common: 'ОБЫЧНЫЙ',
      uncommon: 'НЕОБЫЧНЫЙ',
      rare: 'РЕДКИЙ',
      epic: 'ЭПИЧЕСКИЙ',
      legendary: 'ЛЕГЕНДАРНЫЙ'
    })[rarity] || String(rarity || '').toUpperCase();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
    }[c]));
  }

  async function openChest(winner, opts = {}) {
    if (opening) return;
    opening = true;

    const color = rarityColor(winner.rarity);
    const overlay = document.createElement('div');
    overlay.className = 'chest-opening';
    overlay.style.setProperty('--drop-color', color);

    overlay.innerHTML = `
      <div class="chest-opening__scan"></div>
      <div class="chest-opening__header">
        <span>NEMESIS DROP SYSTEM</span>
        <b>CONTAINER ACCESS</b>
      </div>

      <div class="chest-stage">
        <div class="chest-particles"></div>
        <div class="drop-flash"></div>

        <div class="crate-shadow"></div>
        <div class="crate">
          <div class="crate-lid">
            <div class="crate-lid-mark">N</div>
          </div>
          <div class="crate-body">
            <div class="crate-lock"></div>
            <div class="crate-mark">N</div>
            <div class="crate-lines"></div>
          </div>
          <div class="crate-glow"></div>
        </div>

        <div class="drop-core">
          <div class="core-ring"></div>
          <div class="core-name">${escapeHtml(winner.name)}</div>
          <div class="core-rarity">${rarityLabel(winner.rarity)}</div>
        </div>
      </div>

      <div class="chest-opening__status" id="chest-status">Проверка контейнера…</div>
      <div class="chest-opening__result">
        <div class="result-rarity">${rarityLabel(winner.rarity)}</div>
        <h2>${escapeHtml(winner.name)}</h2>
        <p>Предмет добавлен в инвентарь.</p>
        <div class="result-actions">
          <button class="btn-primary chest-sell" type="button">ПРОДАТЬ СРАЗУ <span></span></button>
          <button class="btn-secondary chest-market" type="button">НА МАРКЕТ</button>
          <button class="btn-secondary chest-close" type="button">ЗАБРАТЬ</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.body.classList.add('chest-active');

    const status = overlay.querySelector('#chest-status');
    const crate = overlay.querySelector('.crate');
    const result = overlay.querySelector('.chest-opening__result');
    const close = overlay.querySelector('.chest-close');
    const sell = overlay.querySelector('.chest-sell');
    const market = overlay.querySelector('.chest-market');

    const finish = async () => {
      if (opts.onComplete) await opts.onComplete(winner, overlay);
      document.body.classList.remove('chest-active');
      overlay.remove();
      opening = false;
    };

    // Cinematic sequence: scan -> unlock -> lid -> rarity burst -> item reveal.
    await wait(700);
    status.textContent = 'КОНТЕЙНЕР ПОДТВЕРЖДЁН';
    await wait(650);
    crate.classList.add('unlock');
    status.textContent = 'СНЯТИЕ ФИКСАТОРА…';
    await wait(800);
    crate.classList.add('open');
    status.textContent = 'ОТКРЫТИЕ…';
    await wait(1000);
    overlay.classList.add('reveal');
    status.textContent = `ОБНАРУЖЕН ДРОП · ${rarityLabel(winner.rarity)}`;
    await wait(900);
    result.classList.add('show');

    if (opts.suggestedPrice) {
      sell.querySelector('span').textContent = `${Number(opts.suggestedPrice).toLocaleString('ru-RU')} ₦`;
    }

    close.onclick = finish;
    market.onclick = () => {
      if (opts.onMarket) opts.onMarket(winner);
    };
    sell.onclick = async () => {
      sell.disabled = true;
      try {
        if (opts.onSell) {
          await opts.onSell(winner);
          sell.textContent = 'ПРОДАНО ✓';
          sell.classList.add('sold');
        }
      } catch (e) {
        sell.disabled = false;
        if (window.toast) window.toast(e?.error || 'Не удалось продать', 'error');
      }
    };

    // Auto-close is intentionally disabled: the player controls what happens to the drop.
  }

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    openChest,
    rarityColor,
    isSpinning: () => opening
  };
})();
