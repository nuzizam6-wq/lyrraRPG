// ─── app.js ──────────────────────────────────────────────────────────────
// LYRRA MMORPG client. Connects to a game server by IP:port over WebSocket,
// exactly like adding a server address in Minecraft/Terraria.

let ws = null;
let pendingAuthMode = null; // 'login' | 'register'
let player = null;

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $all('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Saved servers (stored locally on device, not sent anywhere) ──
function loadSavedServers() {
  try { return JSON.parse(localStorage.getItem('lyrra_servers') || '[]'); }
  catch { return []; }
}
function saveServer(host, port) {
  const list = loadSavedServers().filter(s => !(s.host === host && s.port === port));
  list.unshift({ host, port });
  localStorage.setItem('lyrra_servers', JSON.stringify(list.slice(0, 5)));
  renderSavedServers();
}
function renderSavedServers() {
  const box = $('#saved-servers');
  const list = loadSavedServers();
  box.innerHTML = '';
  list.forEach(s => {
    const div = document.createElement('div');
    div.className = 'saved-server-item';
    div.textContent = s.port ? `${s.host}:${s.port}` : s.host;
    div.onclick = () => { $('#in-host').value = s.host; $('#in-port').value = s.port; };
    box.appendChild(div);
  });
}
renderSavedServers();

// ── Terminal log ──
function logLine(text, cls = '') {
  const term = $('#terminal');
  const div = document.createElement('div');
  div.className = 'line ' + cls;
  div.textContent = text;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
}
function logLines(lines, cls = '') { (lines || []).forEach(l => logLine(l, cls)); }

// ── Connect ──
$('#btn-connect').onclick = () => {
  const host = $('#in-host').value.trim().replace(/^wss?:\/\//, '').replace(/\/$/, '');
  const port = $('#in-port').value.trim();
  if (!host) { $('#connect-status').textContent = 'Isi alamat server dulu.'; return; }

  $('#connect-status').textContent = 'Menghubungkan...';

  // Kalau Port dikosongkan -> anggap ini domain publik (mis. Cloudflare
  // Tunnel: xxxx.trycloudflare.com), pakai wss:// tanpa port (default 443).
  // Kalau Port diisi -> anggap koneksi langsung ke IP/host, pakai ws://.
  const url = port ? `ws://${host}:${port}` : `wss://${host}`;

  try { ws = new WebSocket(url); } catch (e) {
    $('#connect-status').textContent = 'Alamat server tidak valid.';
    return;
  }

  ws.onopen = () => {
    $('#connect-status').textContent = 'Terhubung!';
    saveServer(host, port);
    $('#auth-server-label').textContent = `Server: ${host}${port ? ':' + port : ''}`;
    showScreen('#screen-auth');
  };
  ws.onerror = () => { $('#connect-status').textContent = 'Gagal konek. Cek alamat server & pastikan server menyala.'; };
  ws.onclose = () => {
    if ($('#screen-game').classList.contains('active') || $('#screen-auth').classList.contains('active') || $('#screen-class').classList.contains('active')) {
      alert('Koneksi ke server terputus.');
      showScreen('#screen-connect');
    }
  };
  ws.onmessage = onMessage;
};

// ── Auth ──
$('#btn-back').onclick = () => { if (ws) ws.close(); showScreen('#screen-connect'); };

$('#btn-login').onclick = () => doAuth('login');
$('#btn-register').onclick = () => doAuth('register');

function doAuth(mode) {
  const username = $('#in-user').value.trim();
  const password = $('#in-pass').value;
  if (!username || !password) { $('#auth-status').textContent = 'Isi username & password.'; return; }
  pendingAuthMode = mode;
  ws.send(JSON.stringify({ type: mode, username, password }));
  $('#auth-status').textContent = mode === 'login' ? 'Masuk...' : 'Mendaftar...';
}

// ── Class picking ──
function renderClassList(classes) {
  const box = $('#class-list');
  box.innerHTML = '';
  classes.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd';
    btn.textContent = `${c.emoji || ''} ${c.name}`;
    btn.title = c.desc;
    btn.onclick = () => sendCommand('pickclass', { classId: c.id });
    box.appendChild(btn);
  });
}

// ── Stats sidebar (ASCII character sheet) ──
function asciiBar(cur, max, width = 10, fillChar = '#', emptyChar = '-') {
  const pct = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
  const filled = Math.round(pct * width);
  return fillChar.repeat(filled) + emptyChar.repeat(width - filled);
}

function renderStats() {
  if (!player) return;
  const menuName = $('#menu-username');
  if (menuName) menuName.textContent = player.username;
  const box = $('#stats-bar');
  box.innerHTML = '';
  const rows = [
    ['NAME', player.username],
    ['CLASS', player.class || '-'],
    ['LV', String(player.level)],
  ];
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'stat-row';
    row.innerHTML = `<span class="k">${k}</span><span>${v}</span>`;
    box.appendChild(row);
  });

  const hpRow = document.createElement('div');
  hpRow.className = 'stat-row';
  hpRow.innerHTML = `<span class="k">HP</span><span class="bar-track">[<span class="bar-fill hp">${asciiBar(player.hp, player.maxHp)}</span>] ${player.hp}/${player.maxHp}</span>`;
  box.appendChild(hpRow);

  const mpRow = document.createElement('div');
  mpRow.className = 'stat-row';
  mpRow.innerHTML = `<span class="k">MP</span><span class="bar-track">[<span class="bar-fill mp">${asciiBar(player.mana, player.maxMana)}</span>] ${player.mana}/${player.maxMana}</span>`;
  box.appendChild(mpRow);

  const expRow = document.createElement('div');
  expRow.className = 'stat-row';
  expRow.innerHTML = `<span class="k">EXP</span><span class="bar-track">[<span class="bar-fill">${asciiBar(player.exp, player.expNext)}</span>] ${player.exp}/${player.expNext}</span>`;
  box.appendChild(expRow);

  const goldRow = document.createElement('div');
  goldRow.className = 'stat-row';
  goldRow.innerHTML = `<span class="k">GOLD</span><span>${player.gold}</span>`;
  box.appendChild(goldRow);
}

// ── Command sending ──
function sendCommand(cmd, args = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'command', cmd, args }));
}

$all('.btn-cmd[data-cmd]').forEach(btn => {
  btn.addEventListener('click', () => {
    const cmd = btn.getAttribute('data-cmd');
    const args = btn.getAttribute('data-args');
    sendCommand(cmd, args ? JSON.parse(args) : {});
  });
});

// ── Hamburger menu (account / status / friend list) ──
$('#menu-btn').onclick = () => {
  $('#side-menu').classList.toggle('hidden');
  $('#fab-menu').classList.add('hidden');
  if (player) $('#menu-username').textContent = player.username;
};

$('#btn-logout').onclick = () => {
  if (ws) ws.close();
  player = null;
  showScreen('#screen-connect');
};

$('#menu-status-btn').onclick = () => {
  $('#side-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('stats');
};

$('#btn-friends-view').onclick = () => sendCommand('friends_list');

$('#btn-friends-add').onclick = () => {
  const username = prompt('Username teman yang mau ditambah:');
  if (!username || !username.trim()) return;
  sendCommand('friend_add', { username: username.trim() });
};

function renderFriendButtons(friends) {
  const box = $('#friend-list');
  box.innerHTML = '';
  if (!friends || !friends.length) { box.textContent = 'Belum ada teman.'; return; }
  friends.forEach(f => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const info = document.createElement('div');
    info.className = 'hint';
    info.style.flex = '1';
    info.textContent = `${f.username} Lv.${f.level} [${f.class}] @ ${f.map} HP ${f.hp}/${f.maxHp}`;
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = 'Hapus';
    btn.onclick = () => sendCommand('friend_remove', { username: f.username });
    wrap.appendChild(info);
    wrap.appendChild(btn);
    box.appendChild(wrap);
  });
}
$('#fab-quick').onclick = () => {
  $('#fab-menu').classList.toggle('hidden');
};

function switchToTab(tabName) {
  $all('.tab-btn').forEach(t => t.classList.remove('active'));
  $all('.tab-content').forEach(t => t.classList.remove('active'));
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const tabContent = document.querySelector(`.tab-content[data-tab-content="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.add('active');
}

$('#fab-rest').onclick = () => {
  $('#fab-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('rest');
};
$('#fab-skill').onclick = () => {
  $('#fab-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('skills');
};
$('#fab-useitem').onclick = () => {
  $('#fab-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('inventory');
};
$('#fab-equip').onclick = () => {
  $('#fab-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('inventory');
};

// Tabs
$all('.tab-btn').forEach(tab => {
  tab.addEventListener('click', () => {
    $all('.tab-btn').forEach(t => t.classList.remove('active'));
    $all('.tab-content').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $(`.tab-content[data-tab-content="${tab.dataset.tab}"]`).classList.add('active');
  });
});

// Chat
$('#btn-send-chat').onclick = sendChat;
$('#in-chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const input = $('#in-chat');
  const text = input.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  input.value = '';
  // Fix: on some Android WebView + Gboard combos, clearing .value without
  // resetting the cursor leaves the keyboard's internal position stale,
  // causing the NEXT message typed to insert characters at position 0
  // (i.e. the whole message comes out reversed). Explicitly re-sync it.
  input.setSelectionRange(0, 0);
  input.focus();
}

// ── Dynamic buttons from structured server data ──
function renderMoveButtons(area) {
  const box = $('#move-list');
  box.innerHTML = '';
  if (!area || !area.connected?.length) { box.textContent = 'Tidak ada rute dari sini.'; return; }
  area.connected.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd';
    btn.textContent = `${a.name} (Lv.${a.levelReq})`;
    btn.onclick = () => sendCommand('move', { to: a.id });
    box.appendChild(btn);
  });
}

function renderFightButtons(monsters) {
  const box = $('#fight-list');
  box.innerHTML = '';
  if (!monsters || !monsters.length) { box.textContent = 'Tidak ada monster di sini.'; return; }
  monsters.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd';
    btn.textContent = `${m.name} (Lv.${m.level}) [${m.type}]`;
    btn.onclick = () => sendCommand('fight', { monsterId: m.id });
    box.appendChild(btn);
  });
}

function renderShopButtons(shopData) {
  const box = $('#shop-list');
  box.innerHTML = '';
  if (!shopData || !shopData.items?.length) { box.textContent = 'Tidak ada barang.'; return; }
  shopData.items.forEach(it => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${it.label} - ${it.price}g`;
    btn.onclick = () => sendCommand('buy', { itemId: it.id, qty: 1 });
    box.appendChild(btn);
  });
}

function renderCraftButtons(recipes) {
  const box = $('#craft-list');
  box.innerHTML = '';
  if (!recipes || !recipes.length) { box.textContent = 'Tidak ada resep.'; return; }
  recipes.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${r.name} (Lv.${r.levelReq})`;
    btn.onclick = () => sendCommand('craft', { recipeId: r.id });
    box.appendChild(btn);
  });
}

function renderDungeonButtons(dungeons) {
  const box = $('#dungeon-list');
  box.innerHTML = '';
  if (!dungeons || !dungeons.length) { box.textContent = 'Tidak ada dungeon.'; return; }
  dungeons.forEach(d => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${d.name}${d.available ? '' : ' (terkunci)'}`;
    btn.disabled = !d.available;
    btn.onclick = () => sendCommand('dungeon_run', { dungeonId: d.id });
    box.appendChild(btn);
  });
}

function renderQuestButtons(quests) {
  const box = $('#quest-list');
  box.innerHTML = '';
  if (!quests || !quests.length) { box.textContent = 'Tidak ada quest baru.'; return; }
  quests.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `[${q.type}] ${q.name}`;
    btn.onclick = () => sendCommand('quest_accept', { questId: q.id });
    box.appendChild(btn);
  });
}

function renderMarketButtons(listings) {
  const box = $('#market-list');
  box.innerHTML = '';
  if (!listings || !listings.length) { box.textContent = 'Tidak ada listing.'; return; }
  listings.forEach(l => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `#${l.id} ${l.itemId} x${l.qty} - ${l.priceEach}g (${l.sellerName})`;
    btn.onclick = () => sendCommand('market_buy', { listingId: l.id });
    box.appendChild(btn);
  });
}

function renderMailButtons(mails) {
  const box = $('#mail-list');
  box.innerHTML = '';
  if (!mails || !mails.length) { box.textContent = 'Kotak mail kosong.'; return; }
  mails.forEach((m, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `[${i}] ${m.from}: ${m.message}${m.claimed ? ' (diklaim)' : ''}`;
    btn.disabled = !!m.claimed;
    btn.onclick = () => sendCommand('mail_claim', { idx: i });
    box.appendChild(btn);
  });
}

function renderEquipButtons(items) {
  const box = $('#equip-list');
  box.innerHTML = '';
  $('#unequip-list').innerHTML = '';
  if (!items || !items.length) { box.textContent = ''; return; }
  const label = document.createElement('div');
  label.className = 'hint';
  label.textContent = 'Tap untuk pakai:';
  box.appendChild(label);
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${it.name} [${it.type}]${it.qty > 1 ? ' x' + it.qty : ''}`;
    btn.onclick = () => sendCommand('equip', { itemId: it.id });
    box.appendChild(btn);
  });
}

function renderUnequipButtons(slots) {
  const box = $('#unequip-list');
  box.innerHTML = '';
  $('#equip-list').innerHTML = '';
  if (!slots || !slots.length) { box.textContent = ''; return; }
  const label = document.createElement('div');
  label.className = 'hint';
  label.textContent = 'Tap untuk lepas:';
  box.appendChild(label);
  slots.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `Lepas ${s.name} [${s.slot}]`;
    btn.onclick = () => sendCommand('unequip', { slot: s.slot });
    box.appendChild(btn);
  });
}

function renderUsableButtons(items) {
  const box = $('#usable-list');
  box.innerHTML = '';
  if (!items || !items.length) { box.textContent = ''; return; }
  const label = document.createElement('div');
  label.className = 'hint';
  label.textContent = 'Potion/Food — tap untuk pakai:';
  box.appendChild(label);
  items.forEach(it => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}`;
    btn.onclick = () => sendCommand('use_item', { itemId: it.id });
    box.appendChild(btn);
  });
}

function renderSkillButtons(skills) {
  const box = $('#skill-list');
  box.innerHTML = '';
  if (!skills || !skills.length) { box.textContent = ''; return; }
  const label = document.createElement('div');
  label.className = 'hint';
  label.textContent = 'Skill — tap untuk pakai:';
  box.appendChild(label);
  skills.forEach(sk => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `${sk.name} [${sk.type}] ${sk.manaCost}mp${sk.onCooldown ? ' (CD)' : ''}`;
    btn.disabled = !!sk.onCooldown;
    btn.onclick = () => {
      if (sk.type === 'heal' || sk.type === 'buff') {
        const target = prompt(`Pakai "${sk.name}" ke siapa? (kosongkan = ke diri sendiri)`);
        if (target === null) return; // dibatalkan
        sendCommand('use_skill', { skillId: sk.id, targetUsername: target.trim() || undefined });
      } else if (['attack', 'aoe', 'control', 'debuff'].includes(sk.type)) {
        const isPvp = confirm(`Serang PEMAIN LAIN pakai "${sk.name}"?\nOK = pemain (PvP) — Cancel = monster / auto-target`);
        if (isPvp) {
          const username = prompt('Username pemain target:');
          if (!username || !username.trim()) return;
          sendCommand('use_skill', { skillId: sk.id, targetUsername: username.trim() });
        } else {
          const monsterId = prompt('ID monster target (kosongkan = otomatis pilih monster di area ini):');
          if (monsterId === null) return; // dibatalkan
          sendCommand('use_skill', { skillId: sk.id, monsterId: monsterId.trim() || undefined });
        }
      } else {
        sendCommand('use_skill', { skillId: sk.id });
      }
    };
    box.appendChild(btn);
  });
}

// ── Upgrade slot picker ──
let selectedSlot = 'weapon';
$all('.slot-pick').forEach(btn => {
  btn.addEventListener('click', () => {
    $all('.slot-pick').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedSlot = btn.dataset.slot;
    $('#upgrade-slot-label').textContent = selectedSlot;
  });
});
$('#btn-enhance').onclick = () => sendCommand('enhance', { slot: selectedSlot });
$('#btn-enchant').onclick = () => sendCommand('enchant', { slot: selectedSlot });
$('#btn-reforge').onclick = () => sendCommand('reforge', { slot: selectedSlot });
$('#btn-awaken').onclick = () => sendCommand('awaken', { slot: selectedSlot });
$('#btn-socket-gem').onclick = () => {
  const gemId = prompt('ID gem dari inventory (mis. gem_ruby):');
  if (gemId) sendCommand('socket_gem', { slot: selectedSlot, gemId: gemId.trim() });
};

// ── Guild ──
$('#btn-guild-create').onclick = () => {
  const name = prompt('Nama guild baru (3-20 karakter):');
  if (name) sendCommand('guild_create', { name: name.trim() });
};
$('#btn-guild-invite').onclick = () => {
  const username = prompt('Username pemain yang mau diundang:');
  if (username) sendCommand('guild_invite', { username: username.trim() });
};

// ── Pet ──
$('#btn-pet-equip').onclick = () => {
  const petItemId = prompt('ID item pet dari inventory (mis. pet_slime):');
  if (petItemId) sendCommand('pet_equip', { petItemId: petItemId.trim() });
};
$('#btn-pet-feed').onclick = () => {
  const foodItemId = prompt('ID makanan dari inventory:');
  if (foodItemId) sendCommand('pet_feed', { foodItemId: foodItemId.trim() });
};

// ── Player market (jual) ──
$('#btn-market-list').onclick = () => {
  const itemId = prompt('ID item yang mau dijual:');
  if (!itemId) return;
  const qty = prompt('Jumlah:', '1');
  const price = prompt('Harga per item (gold):', '10');
  sendCommand('market_list', { itemId: itemId.trim(), qty: Number(qty) || 1, price: Number(price) || 1 });
};

// ── Incoming messages ──
function onMessage(evt) {
  const msg = JSON.parse(evt.data);
  switch (msg.type) {
    case 'hello':
      break;

    case 'auth_error':
      $('#auth-status').textContent = msg.msg;
      break;

    case 'auth_ok':
      showScreen(msg.needsClass ? '#screen-class' : '#screen-game');
      if (msg.needsClass) sendCommand('classes');
      break;

    case 'kicked':
      alert(msg.msg);
      ws.close();
      showScreen('#screen-connect');
      break;

    case 'state':
      player = msg.player;
      renderStats();
      if (player.class && $('#screen-class').classList.contains('active')) {
        showScreen('#screen-game');
      }
      break;

    case 'log':
      logLines(msg.lines, 'sys');
      if (msg.data?.classes) renderClassList(msg.data.classes);
      if (msg.data?.area) renderMoveButtons(msg.data.area);
      if (msg.data?.monsters) renderFightButtons(msg.data.monsters);
      if (msg.data?.items) renderShopButtons(msg.data);
      if (msg.data?.recipes) renderCraftButtons(msg.data.recipes);
      if (msg.data?.dungeons) renderDungeonButtons(msg.data.dungeons);
      if (msg.data?.availableQuests) renderQuestButtons(msg.data.availableQuests);
      if (msg.data?.listings) renderMarketButtons(msg.data.listings);
      if (msg.data?.mails) renderMailButtons(msg.data.mails);
      if (msg.data?.equippableItems) renderEquipButtons(msg.data.equippableItems);
      if (msg.data?.equippedSlots) renderUnequipButtons(msg.data.equippedSlots);
      if (msg.data?.usableItems) renderUsableButtons(msg.data.usableItems);
      if (msg.data?.skills) renderSkillButtons(msg.data.skills);
      if (msg.data?.friends) renderFriendButtons(msg.data.friends);
      break;

    case 'chat':
      logLine(`<${msg.from}> ${msg.text}`, 'chat');
      break;

    case 'online':
      $('#online-list').textContent = 'Online: ' + (msg.list?.join(', ') || '-');
      break;

    default:
      break;
  }
}
