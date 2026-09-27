const Character = (() => {
  let svgRoot = null;

  const ARMOR_SHAPES = {
    helmet: '<path d="M74 32 Q100 14 126 32 L124 58 Q100 48 76 58 Z" fill="#3a4556" stroke="#1c2330" stroke-width="1.5"/>',
    chest: '<path d="M62 106 Q100 96 138 106 L146 200 Q100 214 54 200 Z" fill="#3a4556" stroke="#1c2330" stroke-width="1.5"/>',
    legs: '<rect x="74" y="222" width="24" height="104" rx="8" fill="#2a3342"/><rect x="102" y="222" width="24" height="104" rx="8" fill="#2a3342"/>',
  };

  const WEAPON_SHAPES = {
    weapon: '<rect x="146" y="150" width="10" height="90" rx="3" fill="#20242c" transform="rotate(18 151 195)"/>',
  };

  const BACKPACK_SHAPES = {
    backpack: '<rect x="40" y="120" width="26" height="70" rx="10" fill="#2d3542" stroke="#151a22"/>',
  };

  function rarityColor(rarity) {
    return {
      common: '#9aa5b5',
      uncommon: '#3ecf7f',
      rare: '#3e9dff',
      epic: '#c04ef7',
      legendary: '#ffb020',
    }[rarity] || '#9aa5b5';
  }

  async function init(containerEl) {
    const res = await fetch('character.svg');
    const svgText = await res.text();
    containerEl.innerHTML = svgText;
    svgRoot = containerEl.querySelector('#character-root');
  }

  function applySkinVisual(el, skin) {
    if (!skin) return;
    if (skin.color) el.setAttribute('fill', skin.color);
    if (skin.glow) el.setAttribute('filter', 'url(#glowFilter)');
  }

  function equip(slot, item) {
    if (!svgRoot) return;
    let targetLayer, shapeMap;
    if (slot === 'weapon') { targetLayer = svgRoot.querySelector('#layer-weapon'); shapeMap = WEAPON_SHAPES; }
    else if (slot === 'backpack') { targetLayer = svgRoot.querySelector('#layer-backpack'); shapeMap = BACKPACK_SHAPES; }
    else { targetLayer = svgRoot.querySelector('#layer-armor'); shapeMap = ARMOR_SHAPES; }

    const existing = targetLayer.querySelector(`[data-slot="${slot}"]`);
    if (existing) existing.remove();

    const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    wrapper.setAttribute('data-slot', slot);
    wrapper.innerHTML = shapeMap[slot] || '';
    if (item) {
      const shapeEl = wrapper.firstElementChild;
      if (shapeEl) {
        shapeEl.setAttribute('stroke', rarityColor(item.rarity));
        if (item.skin) applySkinVisual(shapeEl, item.skin);
      }
    }
    targetLayer.appendChild(wrapper);

    const sfx = document.getElementById('sfx-equip');
    if (sfx) { sfx.currentTime = 0; sfx.play().catch(() => {}); }
  }

  function unequip(slot) {
    if (!svgRoot) return;
    const layers = ['#layer-armor', '#layer-weapon', '#layer-backpack'];
    layers.forEach((sel) => {
      const el = svgRoot.querySelector(`${sel} [data-slot="${slot}"]`);
      if (el) el.remove();
    });
  }

  function renderFromEquipped(equipped) {
    ['helmet', 'chest', 'legs', 'weapon', 'backpack'].forEach((slot) => {
      const item = equipped[slot];
      if (item) equip(slot, item); else unequip(slot);
    });
  }

  return { init, equip, unequip, renderFromEquipped };
})();
