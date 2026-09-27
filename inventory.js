const Inventory = (() => {
  let items = [];
  const RARITY_ORDER = { common:1, uncommon:2, rare:3, epic:4, legendary:5 };
  const TYPE_LABEL = { armor:'Броня', weapon:'Оружие', backpack:'Рюкзак' };
  const TYPE_ICON = { armor:'⬢', weapon:'◈', backpack:'▣' };

  async function fetchInventory(token) {
    const res = await fetch('/api/inventory', { headers:{Authorization:`Bearer ${token}`} });
    const data = await res.json().catch(()=>[]);
    if (!res.ok) throw data;
    items = Array.isArray(data) ? data : [];
    return items;
  }

  function filterAndSort(list,{type,rarity,sort}) {
    let out=[...list];
    if(type) out=out.filter(i=>i.type===type);
    if(rarity) out=out.filter(i=>i.rarity===rarity);
    if(sort==='level') out.sort((a,b)=>b.level-a.level);
    else if(sort==='rarity') out.sort((a,b)=>(RARITY_ORDER[b.rarity]||0)-(RARITY_ORDER[a.rarity]||0));
    else out.sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    return out;
  }

  function stats(item) {
    let s=item?.base_stats;
    if(typeof s==='string'){try{s=JSON.parse(s)}catch{s={}}}
    return s||{};
  }

  function renderCard(item) {
    const card=document.createElement('article');
    card.className=`item-card rarity-${item.rarity}`;
    card.dataset.itemId=item.id;
    card.draggable=true;
    card.addEventListener('dragstart',(e)=>e.dataTransfer.setData('text/item-id',item.id));
    const st=stats(item);
    const statText=[st.damage&&`DMG ${st.damage}`,st.defense&&`DEF ${st.defense}`,st.slots&&`SLOTS ${st.slots}`].filter(Boolean).join(' · ');
    card.innerHTML=`
      <div class="item-icon">
        ${item.icon_url?`<img src="${item.icon_url}" alt="" style="max-width:82%;max-height:82%;object-fit:contain">`:`<span class="type-symbol">${TYPE_ICON[item.type]||'◈'}</span>`}
      </div>
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="item-level">Ур. ${item.level} · ${escapeHtml(item.rarity)}</div>
      <div style="font-size:9px;color:var(--dim);margin-top:7px">${statText||TYPE_LABEL[item.type]||'Предмет'}</div>`;
    card.addEventListener('click',()=>openItemModal(item));
    return card;
  }

  function renderGrid(container,list) {
    container.innerHTML='';
    if(!list.length){
      container.innerHTML='<div class="empty-state"><strong>Здесь пока пусто</strong>Открывай кейсы или покупай предметы на маркете.</div>';
      return;
    }
    list.forEach(item=>container.appendChild(renderCard(item)));
  }

  function openItemModal(item) {
    const overlay=document.getElementById('modal-overlay');
    const modal=document.getElementById('modal-content');
    const slotMap={armor:'chest',weapon:'weapon',backpack:'backpack'};
    const st=stats(item);
    const statLines=[
      st.damage?`Урон: ${st.damage}`:'',
      st.defense?`Защита: ${st.defense}`:'',
      st.slots?`Слоты: ${st.slots}`:''
    ].filter(Boolean);
    modal.innerHTML=`
      <div class="panel-kicker">${escapeHtml(TYPE_LABEL[item.type]||'ПРЕДМЕТ')} · ${escapeHtml(item.rarity)}</div>
      <div class="item-detail">
        <div class="detail-art rarity-${item.rarity}">${TYPE_ICON[item.type]||'◈'}</div>
        <div class="detail-info">
          <h3>${escapeHtml(item.name)}</h3>
          <p>Уровень ${item.level}</p>
          ${statLines.map(x=>`<p>${x}</p>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" id="modal-equip">Надеть</button>
        <button class="btn-secondary" id="modal-sell">На маркет</button>
        <button class="btn-secondary" id="modal-close">Закрыть</button>
      </div>`;
    overlay.classList.remove('hidden');

    document.getElementById('modal-close').onclick=()=>overlay.classList.add('hidden');
    document.getElementById('modal-equip').onclick=async()=>{
      const slot=slotMap[item.type];
      if(!slot)return;
      try{
        await equipItem(item,slot);
        overlay.classList.add('hidden');
        await App.refreshAfterSkin();
      }catch(err){showError(err)}
    };
    document.getElementById('modal-sell').onclick=async()=>{
      const price=prompt('Цена на маркете (₦):',String(item.suggested_price||100));
      if(price===null)return;
      try{
        await sellItem(item,Number(price));
        overlay.classList.add('hidden');
        if(window.App) await App.refreshAfterSkin();
      }catch(err){showError(err)}
    };
  }

  async function equipItem(item,slot){
    const res=await fetch(`/api/inventory/${item.id}/equip`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('nemesis_token')}`},
      body:JSON.stringify({slot})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw data;
    Character.equip(slot,item);
    if(window.Sounds)Sounds.play('equip');
  }

  async function sellItem(item,price){
    if(!Number.isSafeInteger(price)||price<=0)throw {error:'bad_price'};
    const res=await fetch('/api/market/listings',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${localStorage.getItem('nemesis_token')}`},
      body:JSON.stringify({item_id:item.id,price})
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw data;
    items=items.filter(i=>i.id!==item.id);
    if(window.App)window.App.refreshAfterSkin().catch(()=>{});
    return data;
  }

  function showDuplicatePopup(newItem,onSell,onKeep){
    const overlay=document.getElementById('modal-overlay');
    const modal=document.getElementById('modal-content');
    modal.innerHTML=`
      <div class="panel-kicker">COLLECTION</div>
      <h3>Дубликат найден</h3>
      <p class="muted">Этот шаблон уже есть в твоём инвентаре. Оставить предмет или выставить его на маркет?</p>
      <div class="modal-actions">
        <button class="btn-primary" id="dup-sell">На маркет</button>
        <button class="btn-secondary" id="dup-keep">Оставить</button>
      </div>`;
    overlay.classList.remove('hidden');
    document.getElementById('dup-sell').onclick=()=>{overlay.classList.add('hidden');onSell(newItem)};
    document.getElementById('dup-keep').onclick=()=>{overlay.classList.add('hidden');onKeep(newItem)};
  }

  function checkDuplicate(newItem){return items.some(i=>i.template_id===newItem.template_id)}
  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  function showError(err){const msg=(window.App&&typeof window.App.errorText==='function')?window.App.errorText(err?.error):err?.error||'Не удалось выполнить действие';if(window.toast)window.toast(msg,'error');else alert(msg)}

  return {fetchInventory,filterAndSort,renderGrid,checkDuplicate,showDuplicatePopup,get items(){return items}};
})();
