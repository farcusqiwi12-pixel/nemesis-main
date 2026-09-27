const Inventory = (() => {
  let items = [];
  let equippedState = {};

  const RARITY_ORDER = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };

  async function fetchInventory(token) {
    const res = await fetch('/api/inventory', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => []);
    if (!res.ok) throw data;
    items = Array.isArray(data) ? data : [];
    return items;
  }

  function filterAndSort(list, { type, rarity, sort }) {
    let out = [...list];
    if (type) out = out.filter((i) => i.type === type);
    if (rarity) out = out.filter((i) => i.rarity === rarity);
    if (sort === 'level') out.sort((a, b) => b.level - a.level);
    else if (sort === 'rarity') out.sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity]);
    else if (sort === 'price') out.sort((a, b) => (b.price || 0) - (a.price || 0));
    else out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return out;
  }

  function renderCard(item) {
    const card = document.createElement('div');
    card.className = `item-card rarity-${item.rarity}`;
    card.dataset.itemId = item.id;
    card.draggable = true;
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/item-id', item.id);
    });
    card.innerHTML = `
      <div class="item-icon" style="width:100%;height:80px;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;">
        ${item.icon_url ? `<img src="${item.icon_url}" alt="" style="max-width:90%;max-height:74px;object-fit:contain;">` : '<span style="font-size:30px;opacity:.35;">◈</span>'}
      </div>
      <div class="item-name" style="font-size:13px;font-weight:600;">${item.name}</div>
      <div class="item-level" style="font-size:11px;color:var(--text-dim);">Ур. ${item.level} · ${item.rarity}</div>
    `;
    card.addEventListener('click', () => openItemModal(item));
    return card;
  }

  function renderGrid(container, list) {
    container.innerHTML = '';
    if (!list.length) {
      container.innerHTML = '<div style="color:var(--text-dim);padding:20px;">Инвентарь пуст</div>';
      return;
    }
    list.forEach((item) => container.appendChild(renderCard(item)));
  }

  function openItemModal(item) {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');
    const slotMap = { armor: 'chest', weapon: 'weapon', backpack: 'backpack' };
    modal.innerHTML = `
      <h3>${item.name}</h3>
      <p style="color:var(--text-dim);margin:8px 0;">Уровень ${item.level} · ${item.rarity}</p>
      <div class="modal-actions">
        <button class="btn-primary" id="modal-equip">Надеть</button>
        <button class="btn-secondary" id="modal-sell">Продать</button>
        <button class="btn-secondary" id="modal-close">Закрыть</button>
      </div>
    `;
    overlay.classList.remove('hidden');

    document.getElementById('modal-close').onclick = () => overlay.classList.add('hidden');
    document.getElementById('modal-equip').onclick = async () => {
      const slot = item.type === 'armor' ? slotMap.armor : slotMap[item.type];
      if (!slot) return;
      try {
        await equipItem(item, slot);
        overlay.classList.add('hidden');
        await App.refreshAfterSkin();
      } catch (err) {
        alert((err && err.error) || 'Не удалось экипировать предмет');
      }
    };
    document.getElementById('modal-sell').onclick = async () => {
      await sellItem(item);
      overlay.classList.add('hidden');
    };
  }

  async function equipItem(item, slot) {
    const token = localStorage.getItem('nemesis_token');
    const res = await fetch(`/api/inventory/${item.id}/equip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ slot }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    Character.equip(slot, item);
  }

  async function sellItem(item) {
    const token = localStorage.getItem('nemesis_token');
    const res = await fetch(`/api/market/listings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ item_id: item.id, price: item.suggested_price || 100 }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw data;
    items = items.filter((i) => i.id !== item.id);
  }

  function checkDuplicate(newItem) {
    return items.some((i) => i.template_id === newItem.template_id);
  }

  function showDuplicatePopup(newItem, onSell, onKeep) {
    const overlay = document.getElementById('modal-overlay');
    const modal = document.getElementById('modal-content');
    modal.innerHTML = `
      <h3>Дубликат!</h3>
      <p style="color:var(--text-dim);margin:8px 0;">Такой предмет уже есть. Продать?</p>
      <div class="modal-actions">
        <button class="btn-primary" id="dup-sell">Продать</button>
        <button class="btn-secondary" id="dup-keep">Оставить</button>
      </div>
    `;
    overlay.classList.remove('hidden');
    document.getElementById('dup-sell').onclick = () => { overlay.classList.add('hidden'); onSell(newItem); };
    document.getElementById('dup-keep').onclick = () => { overlay.classList.add('hidden'); onKeep(newItem); };
  }

  return { fetchInventory, filterAndSort, renderGrid, checkDuplicate, showDuplicatePopup, get items() { return items; } };
})();
