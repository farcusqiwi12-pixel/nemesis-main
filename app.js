const App = (() => {
  let socket = null;
  let currentUser = null;
  let activeTradeId = null;
  let myTradeOffer = { items: [], currency: 0 };
  let tradeState = null;

  const RARITY_ORDER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
  const RARITY_LABEL = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY' };
  const TYPE_LABEL = { armor: 'БРОНЯ', weapon: 'ОРУЖИЕ', backpack: 'РЮКЗАК' };
  const TYPE_ICON = { armor: '⬢', weapon: '◈', backpack: '▣' };

  function token() { return localStorage.getItem('nemesis_token'); }
  function setToken(t) { localStorage.setItem('nemesis_token', t); }
  function clearToken() { localStorage.removeItem('nemesis_token'); }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        ...(opts.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    return data;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
  }

  function toast(message, type = 'ok') {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function showScreen(name) {
    document.getElementById('auth-screen').classList.toggle('hidden', name !== 'auth');
    document.getElementById('app-screen').classList.toggle('hidden', name !== 'app');
  }

  function errorText(code) {
    const map = {
      bad_nickname:'Никнейм: 3–16 символов, латиница/цифры/подчёркивание',
      bad_password:'Пароль минимум 6 символов',
      nickname_taken:'Этот ник уже занят',
      invalid_credentials:'Неверный никнейм или пароль',
      kicked:'Вы временно ограничены модерацией',
      no_token:'Сессия истекла, войдите снова',
      invalid_token:'Сессия истекла, войдите снова',
      not_enough_balance:'Недостаточно средств',
      item_equipped:'Сначала снимите предмет с персонажа',
      not_owner:'Предмет вам не принадлежит',
      bad_price:'Укажите корректную цену',
      cant_buy_own:'Нельзя купить собственный предмет',
      self_trade:'Нельзя обмениваться с собой',
      not_participant:'Вы не участник этого обмена',
      rate_limited:'Слишком часто. Попробуйте позже',
      no_case:'Кейс не найден',
      empty_case:'В кейсе нет предметов',
      already_claimed:'Награда уже получена сегодня',
      already_listed:'Предмет уже выставлен на маркет',
      listing_invalid:'Это объявление больше недействительно',
      bad_offer:'Некорректное предложение',
      bad_currency:'Некорректная сумма',
      already_confirmed:'Вы уже подтвердили обмен',
      duplicate_item:'Один предмет нельзя передать дважды',
      item_no_longer_owned:'Один из предметов больше вам не принадлежит',
      not_found:'Объект не найден',
      server_error:'Серверная ошибка. Попробуйте ещё раз',
    };
    return map[code] || 'Не удалось выполнить действие';
  }

  function initAuthForms() {
    document.querySelectorAll('.auth-tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.form}-form`).classList.add('active');
    }));

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nickname = document.getElementById('login-nick').value.trim();
      const password = document.getElementById('login-pass').value;
      try {
        const data = await api('/api/login', { method:'POST', body:JSON.stringify({ nickname, password }) });
        setToken(data.token); currentUser = data.user; await bootApp();
      } catch (err) { document.getElementById('login-error').textContent = errorText(err.error); }
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nickname = document.getElementById('reg-nick').value.trim();
      const password = document.getElementById('reg-pass').value;
      try {
        const data = await api('/api/register', { method:'POST', body:JSON.stringify({ nickname, password }) });
        setToken(data.token); currentUser = data.user; await bootApp();
      } catch (err) { document.getElementById('register-error').textContent = errorText(err.error); }
    });
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', async () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
      await onTabOpen(btn.dataset.tab);
    }));
  }

  async function onTabOpen(tab) {
    if (tab === 'inventory') await loadInventory();
    if (tab === 'market') await loadMarket();
    if (tab === 'profile') await loadProfile();
    if (tab === 'character') await loadEquipped();
    if (tab === 'trade' && activeTradeId) await loadTrade(activeTradeId);
  }

  async function loadMe() {
    currentUser = await api('/api/me');
    document.getElementById('balance-value').textContent = Number(currentUser.balance || 0).toLocaleString('ru-RU');
    document.getElementById('user-nick').textContent = currentUser.nickname;
    document.getElementById('dash-cases').textContent = Number(currentUser.cases_opened || 0).toLocaleString('ru-RU');
    document.getElementById('profile-nickname').textContent = currentUser.nickname;
    const roleEl = document.getElementById('profile-role-tag');
    if (roleEl) {
      roleEl.textContent = currentUser.role_tag || (currentUser.is_admin ? 'Разработчик' : 'Игрок');
      roleEl.className = `profile-role-tag ${currentUser.profile_theme === 'developer' ? 'developer' : ''}`;
    }
    document.body.classList.toggle('developer-session', currentUser.profile_theme === 'developer');
    return currentUser;
  }

  async function updateOnline() {
    try {
      const data = await api('/api/online-count');
      document.getElementById('online-value').textContent = Number(data.online || 0);
    } catch {}
  }

  function rarityColor(r) {
    return ({ common:'#9aa5b5', uncommon:'#46d58a', rare:'#4aa8ff', epic:'#c56cff', legendary:'#ffbf55' })[r] || '#9aa5b5';
  }

  async function loadDailyReward() {
    const btn = document.getElementById('daily-reward-btn');
    const status = document.getElementById('daily-status');
    try {
      const data = await api('/api/daily-reward/status');
      const profileBtn = document.getElementById('daily-reward-profile');
      if (data.claimed) {
        btn.disabled = true;
        btn.textContent = 'Получено ✓';
        profileBtn.disabled = true;
        profileBtn.textContent = 'Получено ✓';
        status.textContent = 'Награда уже забрана сегодня';
      } else {
        btn.disabled = false;
        btn.textContent = 'Забрать';
        profileBtn.disabled = false;
        profileBtn.textContent = 'Получить ежедневную награду';
        status.textContent = 'Получишь +100 ₦ один раз в день';
      }
    } catch {
      btn.disabled = false;
      status.textContent = 'Награда: +100 ₦ в день';
    }
  }

  async function claimDailyReward() {
    const buttons = [document.getElementById('daily-reward-btn'), document.getElementById('daily-reward-profile')];
    buttons.forEach((b) => { if (b) b.disabled = true; });
    try {
      const result = await api('/api/daily-reward', { method:'POST' });
      await loadMe();
      document.getElementById('daily-status').textContent = 'Награда получена. Возвращайся завтра.';
      document.getElementById('daily-reward-btn').textContent = 'Получено ✓';
      document.getElementById('daily-reward-profile').textContent = 'Получено ✓';
      toast(`+${result.amount} ₦ зачислено на баланс`);
    } catch (err) {
      if (err.error === 'already_claimed') {
        document.getElementById('daily-status').textContent = 'Сегодня уже получено';
        document.getElementById('daily-reward-btn').textContent = 'Получено ✓';
        document.getElementById('daily-reward-profile').textContent = 'Получено ✓';
        toast('Ежедневная награда уже забрана');
      } else {
        buttons.forEach((b) => { if (b) b.disabled = false; });
        toast(errorText(err.error), 'error');
      }
    }
  }

  async function loadCases() {
    const cases = await api('/api/cases');
    const grid = document.getElementById('cases-grid');
    const meta = document.querySelector('#tab-cases .section-meta');
    if (meta) meta.textContent = `${cases.length} контейнеров`;
    grid.innerHTML = '';
    const accents = ['var(--common)','var(--uncommon)','var(--rare)','var(--epic)','var(--legendary)'];

    cases.forEach((c, index) => {
      const accent = accents[index % accents.length];
      const card = document.createElement('article');
      card.className = 'case-card';
      card.style.setProperty('--rarity', accent);
      card.innerHTML = `
        <div class="case-glow"></div>
        <div class="case-visual">
          <div class="case-box">
            <div class="case-box-lid"></div>
            <span>N</span>
          </div>
        </div>
        <div>
          <div class="case-name">${esc(c.name)}</div>
          <div class="case-hint">Контейнер · вскрытие · дроп по редкости</div>
          <div class="case-price">${Number(c.price).toLocaleString('ru-RU')} ₦</div>
          <button class="case-open-btn" type="button">ВСКРЫТЬ КОНТЕЙНЕР</button>
        </div>`;
      card.addEventListener('click', () => openCase(c));
      card.querySelector('.case-open-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openCase(c);
      });
      grid.appendChild(card);
    });

    if (!cases.length) {
      grid.innerHTML = '<div class="empty-state"><strong>Контейнеры недоступны</strong>Сервер не вернул активные контейнеры.</div>';
    }
  }

  async function quickSellDrop(item) {
    const result = await api(`/api/inventory/${item.id}/sell`, { method: 'POST' });
    await loadMe();
    await loadInventory();
    Sounds.play('trade');
    toast(`Продано: ${item.name} · +${Number(result.amount).toLocaleString('ru-RU')} ₦`);
    return result;
  }

  async function listDropOnMarket(item) {
    const suggested = Number(item.suggested_price || 100);
    const price = prompt('Твоя цена на маркете (₦):', String(suggested));
    if (price === null) return;
    const numeric = Number(price);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      toast('Цена должна быть целым числом больше 0', 'error');
      return;
    }
    await api('/api/market/listings', {
      method: 'POST',
      body: JSON.stringify({ item_id: item.id, price: numeric })
    });
    toast(`Предмет выставлен за ${numeric.toLocaleString('ru-RU')} ₦`);
    await loadInventory();
  }

  async function openCase(caseObj) {
    if (Roulette.isSpinning()) return;
    try { await loadMe(); } catch {}

    const balance = Number(currentUser?.balance || 0);
    const price = Number(caseObj.price || 0);
    if (balance < price) {
      const need = Math.max(0, price - balance);
      toast(`Недостаточно средств: нужно ещё ${need.toLocaleString('ru-RU')} ₦`, 'error');
      return;
    }

    document.getElementById('dash-state').textContent = 'ПОДГОТОВКА…';
    try {
      const result = await api(`/api/cases/${caseObj.id}/open`, { method: 'POST' });
      await loadMe();

      await Roulette.openChest(
        {
          ...result.item,
          suggestedPrice: Number(result.item.suggested_price || 100)
        },
        {
          suggestedPrice: Number(result.item.suggested_price || 100),
          onSell: async (item) => {
            await quickSellDrop(item);
          },
          onMarket: async (item) => {
            await listDropOnMarket(item);
          },
          onComplete: async () => {
            document.getElementById('dash-state').textContent = 'ГОТОВ';
            Sounds.play('drop');
            if (result.was_duplicate) toast('Дубликат предмета. Теперь его можно продать или выставить на маркет.');
            await loadInventory();
          }
        }
      );
    } catch (err) {
      document.getElementById('dash-state').textContent = 'ГОТОВ';
      toast(errorText(err.error), 'error');
    }
  }

  async function loadInventory() {
    await Inventory.fetchInventory(token());
    applyInventoryFilters();
    document.getElementById('inventory-count').textContent = `${Inventory.items.length} предметов`;
    await loadEquipped();
  }

  function applyInventoryFilters() {
    const type = document.getElementById('filter-type').value;
    const rarity = document.getElementById('filter-rarity').value;
    const sort = document.getElementById('sort-inventory').value;
    const search = document.getElementById('inventory-search').value.trim().toLowerCase();
    let list = Inventory.items.filter((i) => !search || String(i.name).toLowerCase().includes(search));
    list = Inventory.filterAndSort(list, { type, rarity, sort });
    Inventory.renderGrid(document.getElementById('inventory-grid'), list);
  }

  function initInventoryFilters() {
    ['filter-type','filter-rarity','sort-inventory'].forEach((id) => document.getElementById(id).addEventListener('change', applyInventoryFilters));
    document.getElementById('inventory-search').addEventListener('input', debounce(applyInventoryFilters, 120));
  }

  function itemStats(item) {
    let stats = item?.base_stats;
    if (typeof stats === 'string') { try { stats = JSON.parse(stats); } catch { stats = {}; } }
    return stats || {};
  }

  async function loadEquipped() {
    const eq = await api('/api/equipped');
    const equippedItems = {};
    let defense = 0, damage = 0, slots = 0;
    ['helmet','chest','legs','weapon','backpack'].forEach((slot) => {
      const itemId = eq[slot];
      const item = Inventory.items.find((i) => i.id === itemId) || null;
      equippedItems[slot] = item;
      if (item) {
        const st = itemStats(item);
        defense += Number(st.defense || 0);
        damage += Number(st.damage || 0);
        slots += Number(st.slots || 0);
      }
    });
    Character.renderFromEquipped(equippedItems);
    renderCharacterStats({ defense, damage, slots });
    renderEquipLabels(equippedItems);
  }

  function renderCharacterStats({ defense, damage, slots }) {
    const power = defense + damage + slots * 2;
    document.getElementById('character-power').textContent = `POWER ${power}`;
    document.getElementById('character-stats').innerHTML = `
      <div class="stat-card"><span>ЗАЩИТА</span><strong>${defense}</strong></div>
      <div class="stat-card"><span>УРОН</span><strong>${damage}</strong></div>
      <div class="stat-card"><span>СЛОТЫ РЮКЗАКА</span><strong>${slots}</strong></div>
      <div class="stat-card"><span>ПРЕДМЕТОВ</span><strong>${Inventory.items.length}</strong></div>`;
  }

  function renderEquipLabels(eq) {
    document.querySelectorAll('.equip-slot').forEach((el) => {
      const item = eq[el.dataset.slot];
      const em = el.querySelector('em');
      if (em) em.textContent = item ? `${item.name} · ур.${item.level}` : 'пусто';
      el.style.setProperty('--rarity', item ? rarityColor(item.rarity) : '#253444');
    });
  }

  async function loadMarket() {
    await loadMarketWithFilters();
  }

  async function loadMarketWithFilters() {
    const params = new URLSearchParams();
    const search = document.getElementById('market-search').value.trim();
    const sort = document.getElementById('market-sort').value;
    const type = document.getElementById('market-type').value;
    const rarity = document.getElementById('market-rarity').value;
    if (search) params.set('search', search);
    if (sort) params.set('sort', sort);
    if (type) params.set('type', type);
    if (rarity) params.set('rarity', rarity);
    try {
      const listings = await api(`/api/market/listings?${params.toString()}`);
      renderMarket(listings);
    } catch (err) { toast(errorText(err.error),'error'); }
  }

  function renderMarket(listings) {
    const grid = document.getElementById('market-grid');
    grid.innerHTML = '';
    if (!listings.length) {
      grid.innerHTML = '<div class="empty-state"><strong>Маркет пуст</strong>Попробуй другой фильтр или выставь предмет из инвентаря.</div>';
      return;
    }
    listings.forEach((l) => {
      const card = document.createElement('article');
      card.className = `market-card rarity-${l.rarity}`;
      card.innerHTML = `
        <div class="market-card-top"><span class="market-type">${esc(TYPE_LABEL[l.type] || l.type)}</span><span class="rarity-tag">${esc(RARITY_LABEL[l.rarity] || l.rarity)}</span></div>
        <div class="market-name">${esc(l.name)}</div>
        <div class="market-seller">продавец: ${esc(l.seller_nickname)} · ур.${l.level}</div>
        <div class="market-bottom"><span class="market-price">${Number(l.price).toLocaleString('ru-RU')} ₦</span><button class="btn-primary btn-small">Купить</button></div>`;
      card.querySelector('button').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Купить ${l.name} за ${Number(l.price).toLocaleString('ru-RU')} ₦?`)) return;
        try {
          await api(`/api/market/listings/${l.id}/buy`, {method:'POST'});
          await loadMe(); await loadMarket(); toast('Покупка завершена');
        } catch (err) { toast(errorText(err.error),'error'); }
      });
      grid.appendChild(card);
    });
  }

  function initMarketControls() {
    ['market-sort','market-type','market-rarity'].forEach((id) => document.getElementById(id).addEventListener('change', loadMarketWithFilters));
    document.getElementById('market-search').addEventListener('input', debounce(loadMarketWithFilters, 250));
  }

  function renderProfile(me) {
    const isDev = me.profile_theme === 'developer' || me.is_admin;
    document.getElementById('profile-stats').innerHTML = `
      <div class="profile-stat"><span>УРОВЕНЬ</span><strong>${Number(me.level || 1)}</strong></div>
      <div class="profile-stat"><span>БАЛАНС</span><strong>${Number(me.balance).toLocaleString('ru-RU')} ₦</strong></div>
      <div class="profile-stat"><span>КЕЙСОВ ОТКРЫТО</span><strong>${Number(me.cases_opened || 0).toLocaleString('ru-RU')}</strong></div>
      <div class="profile-stat"><span>СТАТУС</span><strong>${isDev ? 'SYSTEM / ONLINE' : 'ONLINE'}</strong></div>
      <div class="profile-stat"><span>ПРЕМИУМ</span><strong>${me.is_premium ? 'АКТИВЕН' : 'НЕТ'}</strong></div>
      <div class="profile-stat"><span>РОЛЬ</span><strong>${esc(me.role_tag || 'Игрок')}</strong></div>`;
    const bio = document.getElementById('profile-bio');
    if (bio) bio.textContent = me.bio || 'Оперативник NEMESIS.';
    const level = document.getElementById('profile-level');
    if (level) level.textContent = Number(me.level || 1);
  }

  async function loadProfile() {
    const me = await api('/api/me');
    renderProfile(me);
  }

  async function searchTradeUsers() {
    const q = document.getElementById('trade-search-input').value.trim();
    const root = document.getElementById('trade-search-results');
    if (q.length < 2) { root.innerHTML = '<div class="muted">Введите минимум 2 символа.</div>'; return; }
    try {
      const users = await api(`/api/users/search?nickname=${encodeURIComponent(q)}`);
      root.innerHTML = users.length ? '' : '<div class="muted" style="margin-top:12px">Игроки не найдены.</div>';
      users.forEach((u) => {
        const row = document.createElement('div');
        row.className = 'trade-result';
        row.innerHTML = `<div><strong>${esc(u.nickname)}</strong><div class="muted">${u.is_premium ? 'PREMIUM' : 'Игрок'}</div></div><button class="btn-primary btn-small">Пригласить</button>`;
        row.querySelector('button').addEventListener('click', () => createTrade(u));
        root.appendChild(row);
      });
    } catch (err) { toast(errorText(err.error),'error'); }
  }

  async function createTrade(user) {
    try {
      const trade = await api('/api/trade/create',{method:'POST',body:JSON.stringify({recipient_id:user.id})});
      activeTradeId = trade.id;
      await loadTrade(activeTradeId);
      document.querySelector('[data-tab="trade"]').click();
      toast(`Приглашение отправлено ${user.nickname}`);
    } catch (err) { toast(errorText(err.error),'error'); }
  }

  async function loadTrade(id) {
    try {
      const data = await api(`/api/trade/${id}`);
      tradeState = data.trade;
      const isInitiator = data.trade.initiator_id === currentUser.id;
      const opponent = isInitiator ? data.trade.recipient_nickname : data.trade.initiator_nickname;
      document.getElementById('trade-invite-panel').classList.add('hidden');
      document.getElementById('trade-active-panel').classList.remove('hidden');
      document.getElementById('trade-opponent-label').textContent = `Обмен с ${opponent}`;
      document.getElementById('trade-my-confirm').textContent = isInitiator && data.trade.initiator_confirmed || !isInitiator && data.trade.recipient_confirmed ? 'ГОТОВО' : 'НЕ ГОТОВО';
      document.getElementById('trade-their-confirm').textContent = isInitiator && data.trade.recipient_confirmed || !isInitiator && data.trade.initiator_confirmed ? 'ГОТОВО' : 'ОЖИДАНИЕ';
      const myId = currentUser.id;
      const myItems = data.items.filter((x) => x.from_user_id === myId);
      const theirItems = data.items.filter((x) => x.from_user_id !== myId);
      renderTradeItems(document.getElementById('trade-my-items'), myItems, true);
      renderTradeItems(document.getElementById('trade-their-items'), theirItems, false);
      document.getElementById('trade-my-currency').value = isInitiator ? data.trade.initiator_currency : data.trade.recipient_currency;
      document.getElementById('trade-their-currency').textContent = `${Number(isInitiator ? data.trade.recipient_currency : data.trade.initiator_currency).toLocaleString('ru-RU')} ₦`;
      document.getElementById('trade-confirm-btn').disabled = isInitiator ? data.trade.initiator_confirmed : data.trade.recipient_confirmed;
      if (data.trade.status !== 'pending') {
        document.getElementById('trade-timer').textContent = `Статус: ${data.trade.status}`;
      }
    } catch (err) {
      if (err.error === 'not_found') resetTrade();
    }
  }

  function renderTradeItems(zone, items, mine) {
    zone.innerHTML = '';
    if (!items.length) {
      zone.innerHTML = `<span class="muted">${mine ? 'Перетащите предметы сюда' : 'Пока ничего'}</span>`;
      return;
    }
    items.forEach((item) => {
      const el = document.createElement('div');
      el.className = `item-card rarity-${item.rarity}`;
      el.style.cssText = 'width:115px;font-size:10px;padding:8px';
      el.innerHTML = `<div class="item-icon" style="height:58px!important;display:grid;place-items:center"><span class="type-symbol" style="color:${rarityColor(item.rarity)}">${TYPE_ICON[item.type] || '◈'}</span></div><b>${esc(item.name)}</b>`;
      zone.appendChild(el);
    });
  }

  async function initTrade() {
    document.getElementById('trade-search-btn').addEventListener('click', searchTradeUsers);
    document.getElementById('trade-search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchTradeUsers(); });
    document.getElementById('trade-cancel-btn').addEventListener('click', async () => {
      if (!activeTradeId) return;
      try { await api(`/api/trade/${activeTradeId}/cancel`,{method:'POST'}); } catch {}
      resetTrade(); toast('Обмен отменён');
    });
    document.getElementById('trade-offer-btn').addEventListener('click', async () => {
      if (!activeTradeId) return;
      const currency = Number(document.getElementById('trade-my-currency').value) || 0;
      try {
        await api(`/api/trade/${activeTradeId}/offer`,{method:'POST',body:JSON.stringify({item_ids:myTradeOffer.items.map(i=>i.id),currency})});
        myTradeOffer.currency = currency;
        await loadTrade(activeTradeId);
        toast('Предложение обновлено');
      } catch (err) { toast(errorText(err.error),'error'); }
    });
    document.getElementById('trade-confirm-btn').addEventListener('click', async () => {
      if (!activeTradeId) return;
      try { await api(`/api/trade/${activeTradeId}/confirm`,{method:'POST'}); await loadTrade(activeTradeId); }
      catch (err) { toast(errorText(err.error),'error'); }
    });
    const myZone = document.getElementById('trade-my-items');
    myZone.addEventListener('dragover',(e)=>{e.preventDefault();myZone.classList.add('drag-over')});
    myZone.addEventListener('dragleave',()=>myZone.classList.remove('drag-over'));
    myZone.addEventListener('drop',(e)=>{
      e.preventDefault();myZone.classList.remove('drag-over');
      const itemId=e.dataTransfer.getData('text/item-id');
      const item=Inventory.items.find(i=>i.id===itemId);
      if(item && !myTradeOffer.items.some(i=>i.id===itemId)){myTradeOffer.items.push(item);renderTradeItems(myZone,myTradeOffer.items,true)}
    });
  }

  function resetTrade() {
    activeTradeId = null; tradeState = null; myTradeOffer={items:[],currency:0};
    document.getElementById('trade-invite-panel').classList.remove('hidden');
    document.getElementById('trade-active-panel').classList.add('hidden');
    document.getElementById('trade-timer').textContent = '';
  }

  function connectSocket() {
    if (!token() || typeof io !== 'function') return;
    if (socket) socket.disconnect();
    socket = io({auth:{token:token()},transports:['websocket','polling']});
    socket.on('connect_error',()=>{ document.getElementById('dash-state').textContent='API MODE'; });
    socket.on('connect',()=>{ document.getElementById('dash-state').textContent='ONLINE'; updateOnline(); });
    socket.on('trade_invite', async ({trade}) => {
      activeTradeId=trade.id;
      document.querySelector('[data-tab="trade"]').click();
      await loadTrade(trade.id);
      toast('Новое приглашение на обмен');
    });
    socket.on('trade_updated', async ({trade_id}) => {
      Sounds.play('trade');
      if(activeTradeId===trade_id) await loadTrade(trade_id);
    });
    socket.on('trade_countdown', ({trade_id,seconds}) => {
      let remaining=seconds;
      const timerEl=document.getElementById('trade-timer');
      const iv=setInterval(()=>{timerEl.textContent=`Подтверждено · обмен через ${remaining}с`;remaining--;if(remaining<0)clearInterval(iv)},1000);
    });
    socket.on('trade_completed', async ({trade_id}) => {
      if(activeTradeId===trade_id){toast('Обмен завершён');resetTrade();await loadMe();await loadInventory();}
    });
    socket.on('trade_cancelled', ({trade_id}) => { if(activeTradeId===trade_id){toast('Обмен отменён','error');resetTrade();} });
    socket.on('kicked',({until})=>{toast(`Ограничение до ${new Date(until).toLocaleTimeString()}`,'error');logout()});
    socket.on('online_count',({online})=>{document.getElementById('online-value').textContent=online});
  }

  async function logout() {
    clearToken();
    if(socket) socket.disconnect();
    currentUser=null; resetTrade(); showScreen('auth');
  }

  function initModal() {
    document.getElementById('modal-overlay').addEventListener('click',(e)=>{
      if(e.target.id==='modal-overlay') e.currentTarget.classList.add('hidden');
    });
  }

  async function bootApp() {
    showScreen('app');
    await loadMe();
    await loadCases();
    await Character.init(document.getElementById('character-viewport'));
    await loadInventory();
    await loadDailyReward();
    updateOnline();
    connectSocket();
  }

  function debounce(fn,ms){let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)}}

  async function init() {
    initAuthForms(); initTabs(); initInventoryFilters(); initMarketControls(); await initTrade(); initModal();
    document.getElementById('logout-btn').addEventListener('click',logout);
    document.getElementById('logout-top-btn').addEventListener('click',logout);
    document.getElementById('daily-reward-btn').addEventListener('click',claimDailyReward);
    document.getElementById('daily-reward-profile').addEventListener('click',claimDailyReward);
    document.getElementById('refresh-btn').addEventListener('click',async()=>{
      try { await loadMe(); await loadCases(); await loadInventory(); updateOnline(); toast('Данные обновлены'); }
      catch(err){toast(errorText(err.error),'error')}
    });

    if(token()){
      try{await bootApp()}catch(err){clearToken();showScreen('auth')}
    }else showScreen('auth');
  }

  async function refreshAfterSkin() {
    await loadMe();
    await loadInventory();
    await loadEquipped();
  }

  return { init, refreshAfterSkin };
})();
document.addEventListener('DOMContentLoaded', App.init);
