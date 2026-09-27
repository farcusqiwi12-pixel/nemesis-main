const App = (() => {
  let socket = null;
  let currentUser = null;
  let activeTradeId = null;
  let myTradeOffer = { items: [], currency: 0 };

  function token() { return localStorage.getItem('nemesis_token'); }
  function setToken(t) { localStorage.setItem('nemesis_token', t); }
  function clearToken() { localStorage.removeItem('nemesis_token'); }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    return data;
  }

  function showScreen(name) {
    document.getElementById('auth-screen').classList.toggle('hidden', name !== 'auth');
    document.getElementById('app-screen').classList.toggle('hidden', name !== 'app');
  }

  function initAuthForms() {
    document.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`${tab.dataset.form}-form`).classList.add('active');
      });
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nickname = document.getElementById('login-nick').value.trim();
      const password = document.getElementById('login-pass').value;
      try {
        const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ nickname, password }) });
        setToken(data.token);
        currentUser = data.user;
        await bootApp();
      } catch (err) {
        document.getElementById('login-error').textContent = errorText(err.error);
      }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nickname = document.getElementById('reg-nick').value.trim();
      const password = document.getElementById('reg-pass').value;
      try {
        const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ nickname, password }) });
        setToken(data.token);
        currentUser = data.user;
        await bootApp();
      } catch (err) {
        document.getElementById('register-error').textContent = errorText(err.error);
      }
    });
  }

  function errorText(code) {
    const map = {
      bad_nickname: 'Никнейм: 3-16 символов, латиница/цифры/подчёркивание',
      bad_password: 'Пароль минимум 6 символов',
      nickname_taken: 'Ник уже занят',
      invalid_credentials: 'Неверный никнейм или пароль',
      kicked: 'Вы временно ограничены модерацией',
      no_token: 'Сессия истекла, войдите снова',
      invalid_token: 'Сессия истекла, войдите снова',
      not_enough_balance: 'Недостаточно средств',
      item_equipped: 'Сначала снимите предмет с персонажа',
      not_owner: 'Предмет вам не принадлежит',
      bad_price: 'Укажите корректную цену',
      cant_buy_own: 'Нельзя купить собственный предмет',
      self_trade: 'Нельзя обмениваться с собой',
      not_participant: 'Вы не участник этого обмена',
      rate_limited: 'Слишком часто. Попробуйте через минуту',
      no_case: 'Кейс не найден',
      empty_case: 'В кейсе нет предметов',
      already_claimed: 'Награда уже получена сегодня',
      already_listed: 'Предмет уже выставлен на маркет',
      listing_invalid: 'Это объявление больше недействительно',
      bad_offer: 'Некорректное предложение',
      bad_currency: 'Некорректная сумма',
      already_confirmed: 'Вы уже подтвердили обмен',
      duplicate_item: 'Один предмет нельзя передать дважды',
      item_no_longer_owned: 'Один из предметов больше вам не принадлежит',
    };
    return map[code] || 'Ошибка, попробуйте снова';
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        onTabOpen(btn.dataset.tab);
      });
    });
  }

  async function onTabOpen(tab) {
    if (tab === 'inventory') await loadInventory();
    if (tab === 'market') await loadMarket();
    if (tab === 'profile') await loadProfile();
    if (tab === 'character') await loadEquipped();
  }

  async function loadMe() {
    currentUser = await api('/api/me');
    document.getElementById('balance-value').textContent = Number(currentUser.balance || 0).toLocaleString('ru-RU');
    document.getElementById('user-nick').textContent = currentUser.nickname;
    return currentUser;
  }

  async function loadCases() {
    const cases = await api('/api/cases');
    const grid = document.getElementById('cases-grid');
    grid.innerHTML = '';
    cases.forEach((c) => {
      const card = document.createElement('div');
      card.className = 'item-card rarity-rare';
      card.innerHTML = `
        <div style="width:100%;height:100px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:10px;"></div>
        <div style="font-weight:700;">${c.name}</div>
        <div style="color:var(--legendary);margin-top:6px;">${c.price} ₦</div>
      `;
      card.addEventListener('click', () => openCase(c));
      grid.appendChild(card);
    });
  }

  async function openCase(caseObj) {
    if (Roulette.isSpinning()) return;
    if (currentUser.balance < caseObj.price) {
      alert('Недостаточно средств');
      return;
    }
    try {
      const result = await api(`/api/cases/${caseObj.id}/open`, { method: 'POST' });
      currentUser.balance -= caseObj.price;
      document.getElementById('balance-value').textContent = currentUser.balance;

      const grid = document.getElementById('cases-grid');
      const rouletteContainer = document.createElement('div');
      rouletteContainer.style.cssText = 'width:100%;overflow:hidden;height:150px;margin-bottom:16px;border-radius:14px;';
      grid.parentElement.insertBefore(rouletteContainer, grid);

      const pool = [
        { name: result.item.name, rarity: result.item.rarity },
        { name: 'Common Item', rarity: 'common' },
        { name: 'Uncommon Item', rarity: 'uncommon' },
        { name: 'Rare Item', rarity: 'rare' },
        { name: 'Epic Item', rarity: 'epic' },
      ];

      Roulette.spin(rouletteContainer, pool, { name: result.item.name, rarity: result.item.rarity }, {
        onComplete: () => {
          rouletteContainer.remove();
          if (result.was_duplicate) {
            Inventory.showDuplicatePopup(
              result.item,
              async (item) => {
                try {
                  await api(`/api/market/listings`, { method: 'POST', body: JSON.stringify({ item_id: item.id, price: item.suggested_price || 50 }) });
                  await loadInventory();
                  await loadMarket();
                } catch (err) {
                  alert(errorText(err.error));
                }
              },
              async () => { await loadInventory(); }
            );
          }
        },
      });
    } catch (err) {
      alert(errorText(err.error) || 'Не удалось открыть кейс');
    }
  }

  async function loadInventory() {
    const list = await Inventory.fetchInventory(token());
    applyInventoryFilters();
    await loadEquipped();
  }

  function applyInventoryFilters() {
    const type = document.getElementById('filter-type').value;
    const rarity = document.getElementById('filter-rarity').value;
    const sort = document.getElementById('sort-inventory').value;
    const filtered = Inventory.filterAndSort(Inventory.items, { type, rarity, sort });
    Inventory.renderGrid(document.getElementById('inventory-grid'), filtered);
  }

  function initInventoryFilters() {
    ['filter-type', 'filter-rarity', 'sort-inventory'].forEach((id) => {
      document.getElementById(id).addEventListener('change', applyInventoryFilters);
    });
  }

  async function loadEquipped() {
    const eq = await api('/api/equipped');
    const equippedItems = {};
    ['helmet', 'chest', 'legs', 'weapon', 'backpack'].forEach((slot) => {
      const itemId = eq[slot];
      const item = Inventory.items.find((i) => i.id === itemId);
      equippedItems[slot] = item || null;
    });
    Character.renderFromEquipped(equippedItems);
  }

  async function loadMarket() {
    const listings = await api('/api/market/listings');
    const grid = document.getElementById('market-grid');
    grid.innerHTML = '';
    if (!listings.length) {
      grid.innerHTML = '<div style="color:var(--text-dim);padding:20px;">Маркет пуст</div>';
      return;
    }
    listings.forEach((l) => {
      const card = document.createElement('div');
      card.className = `item-card rarity-${l.rarity}`;
      card.innerHTML = `
        <div style="width:100%;height:80px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px;"></div>
        <div style="font-size:13px;font-weight:600;">${l.name}</div>
        <div style="font-size:11px;color:var(--text-dim);">${l.seller_nickname}</div>
        <div style="color:var(--legendary);font-weight:700;margin-top:6px;">${l.price} ₦</div>
      `;
      card.addEventListener('click', async () => {
        if (!confirm(`Купить ${l.name} за ${l.price} ₦?`)) return;
        try {
          await api(`/api/market/listings/${l.id}/buy`, { method: 'POST' });
          await loadMe();
          await loadMarket();
        } catch (err) {
          alert(errorText(err.error) || 'Не удалось купить');
        }
      });
      grid.appendChild(card);
    });
  }

  function initMarketControls() {
    document.getElementById('market-search').addEventListener('input', debounce(loadMarketWithFilters, 300));
    document.getElementById('market-sort').addEventListener('change', loadMarketWithFilters);
  }

  async function loadMarketWithFilters() {
    const search = document.getElementById('market-search').value;
    const sort = document.getElementById('market-sort').value;
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    const listings = await api(`/api/market/listings?${params.toString()}`);
    const grid = document.getElementById('market-grid');
    grid.innerHTML = '';
    listings.forEach((l) => {
      const card = document.createElement('div');
      card.className = `item-card rarity-${l.rarity}`;
      card.innerHTML = `<div style="font-weight:600;">${l.name}</div><div style="color:var(--legendary);">${l.price} ₦</div>`;
      grid.appendChild(card);
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  async function loadProfile() {
    const me = await api('/api/me');
    document.getElementById('profile-stats').innerHTML = `
      <p><strong>${me.nickname}</strong></p>
      <p>Баланс: ${me.balance} ₦</p>
      <p>Открыто кейсов: ${me.cases_opened}</p>
      <p>Премиум: ${me.is_premium ? 'Активен' : 'Нет'}</p>
    `;
  }

  function initTrade() {
    document.getElementById('trade-offer-btn').addEventListener('click', async () => {
      if (!activeTradeId) return;
      const currency = Number(document.getElementById('trade-my-currency').value) || 0;
      const itemIds = myTradeOffer.items.map((i) => i.id);
      await api(`/api/trade/${activeTradeId}/offer`, {
        method: 'POST',
        body: JSON.stringify({ item_ids: itemIds, currency }),
      });
    });

    document.getElementById('trade-confirm-btn').addEventListener('click', async () => {
      if (!activeTradeId) return;
      try {
        await api(`/api/trade/${activeTradeId}/confirm`, { method: 'POST' });
        document.getElementById('trade-confirm-btn').disabled = true;
      } catch (err) {
        alert(errorText(err.error));
      }
    });

    const myZone = document.getElementById('trade-my-items');
    myZone.addEventListener('dragover', (e) => { e.preventDefault(); myZone.classList.add('drag-over'); });
    myZone.addEventListener('dragleave', () => myZone.classList.remove('drag-over'));
    myZone.addEventListener('drop', (e) => {
      e.preventDefault();
      myZone.classList.remove('drag-over');
      const itemId = e.dataTransfer.getData('text/item-id');
      const item = Inventory.items.find((i) => i.id === itemId);
      if (item && !myTradeOffer.items.find((i) => i.id === itemId)) {
        myTradeOffer.items.push(item);
        renderTradeSlot(myZone, item);
      }
    });
  }

  function renderTradeSlot(zone, item) {
    const el = document.createElement('div');
    el.className = `item-card rarity-${item.rarity}`;
    el.style.cssText = 'width:90px;font-size:11px;';
    el.textContent = item.name;
    zone.appendChild(el);
  }

  function connectSocket() {
    if (!token() || typeof io !== 'function') return;
    if (socket) socket.disconnect();
    socket = io({ auth: { token: token() }, transports: ['websocket', 'polling'] });
    socket.on('connect_error', () => {
      // API остаётся доступным даже если WebSocket временно недоступен.
    });

    socket.on('trade_invite', ({ trade }) => {
      activeTradeId = trade.id;
      document.querySelector('[data-tab="trade"]').click();
    });

    socket.on('trade_updated', () => { Sounds.play('trade'); });

    socket.on('trade_countdown', ({ seconds }) => {
      let remaining = seconds;
      const timerEl = document.getElementById('trade-timer');
      const iv = setInterval(() => {
        timerEl.textContent = `Обмен через ${remaining}с`;
        remaining -= 1;
        if (remaining < 0) clearInterval(iv);
      }, 1000);
    });

    socket.on('trade_completed', async () => {
      document.getElementById('trade-timer').textContent = 'Обмен завершён';
      activeTradeId = null;
      myTradeOffer = { items: [], currency: 0 };
      await loadMe();
      await loadInventory();
    });

    socket.on('trade_cancelled', () => {
      document.getElementById('trade-timer').textContent = 'Обмен отменён';
      activeTradeId = null;
    });

    socket.on('kicked', ({ until }) => {
      alert(`Вы ограничены модерацией до ${new Date(until).toLocaleTimeString()}`);
      logout();
    });

    socket.on('online_count', ({ online }) => {
      const el = document.getElementById('user-nick');
      if (el) el.title = `Онлайн: ${online}`;
    });
  }

  function logout() {
    clearToken();
    if (socket) socket.disconnect();
    currentUser = null;
    showScreen('auth');
  }

  async function bootApp() {
    showScreen('app');
    await loadMe();
    await loadCases();
    await Character.init(document.getElementById('character-viewport'));
    await loadInventory();
    connectSocket();
  }

  async function init() {
    initAuthForms();
    initTabs();
    initInventoryFilters();
    initMarketControls();
    initTrade();
    document.getElementById('logout-btn').addEventListener('click', logout);

    if (token()) {
      try {
        await bootApp();
      } catch {
        clearToken();
        showScreen('auth');
      }
    } else {
      showScreen('auth');
    }
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
