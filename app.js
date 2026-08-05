// ─── app.js ──────────────────────────────────────────────────────────────
// LYRRA MMORPG client. Connects to a game server by IP:port over WebSocket,
// exactly like adding a server address in Minecraft/Terraria.

let ws = null;
let pendingAuthMode = null; // 'login' | 'register'
let player = null;
let currentHost = null;
let currentPort = null;

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $all('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ── Persistent login session (stored locally on device as a token, not the
// password itself) — lets the app auto-login next time instead of asking
// for username/password again on the same server. ──
function sessionKey(host, port) { return `lyrra_session_${host}_${port || ''}`; }
function saveSession(host, port, token) {
  try { localStorage.setItem(sessionKey(host, port), token); } catch { /* ignore */ }
}
function loadSession(host, port) {
  try { return localStorage.getItem(sessionKey(host, port)); } catch { return null; }
}
function clearSession(host, port) {
  try { localStorage.removeItem(sessionKey(host, port)); } catch { /* ignore */ }
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
  currentHost = host;
  currentPort = port;

  ws.onopen = () => {
    $('#connect-status').textContent = 'Terhubung!';
    saveServer(host, port);
    $('#auth-server-label').textContent = `Server: ${host}${port ? ':' + port : ''}`;

    const savedToken = loadSession(host, port);
    if (savedToken) {
      $('#connect-status').textContent = 'Login otomatis...';
      ws.send(JSON.stringify({ type: 'session_login', token: savedToken }));
    } else {
      showScreen('#screen-auth');
    }
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

  // Nudge the player toward the Heal shortcut when HP is critical
  const fab = $('#fab-quick');
  if (fab) fab.classList.toggle('low-hp', player.maxHp > 0 && player.hp / player.maxHp < 0.3);
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

// ── Hamburger menu (account / status / social) ──
$('#menu-btn').onclick = () => {
  $('#side-menu').classList.toggle('hidden');
  $('#action-modal-backdrop').classList.add('hidden');
  if (player) $('#menu-username').textContent = player.username;
};

$('#btn-logout').onclick = () => {
  clearSession(currentHost, currentPort);
  if (ws) ws.close();
  player = null;
  showScreen('#screen-connect');
};

$('#menu-status-btn').onclick = () => {
  $('#side-menu').classList.add('hidden');
  switchToTab('main');
  sendCommand('stats');
};

// ── Bank ──
$('#btn-bank-view').onclick = () => sendCommand('bank_info');
$('#btn-bank-deposit').onclick = () => {
  const amount = prompt('Deposit berapa Gold?');
  if (!amount) return;
  sendCommand('bank_deposit', { amount: Number(amount) });
};
$('#btn-bank-withdraw').onclick = () => {
  const amount = prompt('Withdraw berapa Gold?');
  if (!amount) return;
  sendCommand('bank_withdraw', { amount: Number(amount) });
};
function renderBankInfo(bank) {
  const box = $('#bank-info');
  if (!bank) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.textContent = `Saldo Bank: ${bank.balance} Gold | Di tangan: ${bank.onHand} Gold`;
}

function renderChestList(chests) {
  const box = $('#chest-list');
  box.innerHTML = '';
  if (!chests || !chests.length) { box.textContent = ''; return; }
  chests.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = `Buka ${c.emoji} ${c.name} x${c.qty}`;
    btn.onclick = () => sendCommand('chest_open', { chestId: c.id });
    box.appendChild(btn);
  });
}

$('#btn-friends-view').onclick = () => sendCommand('friends_list');

$('#btn-friends-add').onclick = () => {
  const username = prompt('Username teman yang mau ditambah:');
  if (!username || !username.trim()) return;
  sendCommand('friend_add', { username: username.trim() });
};

$('#btn-guild-create').onclick = () => {
  const name = prompt('Nama guild baru (3-20 karakter):');
  if (name) sendCommand('guild_create', { name: name.trim() });
};
$('#btn-guild-invite').onclick = () => {
  const username = prompt('Username pemain yang mau diundang:');
  if (username) sendCommand('guild_invite', { username: username.trim() });
};

$('#btn-online-refresh').onclick = () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'who' })); };

function renderOnlinePlayers(list) {
  const box = $('#online-players-list');
  box.innerHTML = '';
  if (!list || !list.length) { box.textContent = 'Tidak ada pemain online.'; return; }
  list.forEach(name => {
    if (player && name === player.username) return; // skip diri sendiri
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const info = document.createElement('div');
    info.className = 'hint';
    info.style.flex = '1';
    info.textContent = `🟢 ${name}`;
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = '+Teman';
    btn.onclick = () => sendCommand('friend_add', { username: name });
    wrap.appendChild(info);
    wrap.appendChild(btn);
    box.appendChild(wrap);
  });
  if (!box.children.length) box.textContent = 'Cuma kamu yang online.';
}

// ── Ranking modal (opened from hamburger menu) ──
$('#btn-open-rank').onclick = () => {
  $('#side-menu').classList.add('hidden');
  $('#rank-modal-backdrop').classList.remove('hidden');
};
$('#rank-modal-close').onclick = () => {
  $('#rank-modal-backdrop').classList.add('hidden');
};
$('#rank-modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'rank-modal-backdrop') $('#rank-modal-backdrop').classList.add('hidden');
});

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

// ── Inventory modal (bag button) ──
$('#bag-btn').onclick = () => {
  $('#inventory-modal-backdrop').classList.remove('hidden');
  $('#side-menu').classList.add('hidden');
  $('#action-modal-backdrop').classList.add('hidden');
  sendCommand('inventory');
  sendCommand('equipment');
};
$('#inventory-modal-close').onclick = () => {
  $('#inventory-modal-backdrop').classList.add('hidden');
};
$('#inventory-modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'inventory-modal-backdrop') $('#inventory-modal-backdrop').classList.add('hidden');
});

function renderFullInventory(items) {
  const box = $('#inventory-full-list');
  box.innerHTML = '';
  if (!items || !items.length) { box.textContent = 'Inventory kosong.'; return; }
  items.forEach(it => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const info = document.createElement('div');
    info.className = 'hint';
    info.style.flex = '1';
    info.textContent = `${it.name}${it.qty > 1 ? ' x' + it.qty : ''}`;
    wrap.appendChild(info);

    if (it.equippable) {
      const btn = document.createElement('button');
      btn.className = 'btn-cmd small';
      btn.textContent = 'Pakai';
      btn.onclick = () => sendCommand('equip', { itemId: it.id });
      wrap.appendChild(btn);
    } else if (it.usable) {
      const btn = document.createElement('button');
      btn.className = 'btn-cmd small';
      btn.textContent = 'Pakai';
      btn.onclick = () => sendCommand('use_item', { itemId: it.id });
      wrap.appendChild(btn);
    } else if (it.sellPrice > 0) {
      const btn = document.createElement('button');
      btn.className = 'btn-cmd small';
      btn.textContent = `Jual (${it.sellPrice}g)`;
      btn.onclick = () => sendCommand('sell', { itemId: it.id, qty: 1 });
      wrap.appendChild(btn);
    }
    box.appendChild(wrap);
  });
}

// ── Quick Actions modal (FAB): Heal / Item / Skill / Equip ──
$('#fab-quick').onclick = () => {
  $('#action-modal-backdrop').classList.remove('hidden');
  $('#side-menu').classList.add('hidden');
};
$('#action-modal-close').onclick = () => {
  $('#action-modal-backdrop').classList.add('hidden');
};
$('#action-modal-backdrop').addEventListener('click', (e) => {
  if (e.target.id === 'action-modal-backdrop') $('#action-modal-backdrop').classList.add('hidden');
});

// ── Draggable FAB — bisa digeser ke posisi mana saja, posisinya diingat ──
// ── Anchor the FAB (⚡) and bag (🎒) buttons to the REAL top edge of the
// action panel, measured live — because the panel's height changes per tab
// (Aksi is short, Fitur is long), a hardcoded vh-based offset would drift
// out of place. This re-measures whenever the panel's size actually changes. ──
function anchorFloatingButtons() {
  const panel = $('#action-panel');
  const bag = $('#bag-btn');
  const fab = $('#fab-quick');
  if (!panel) return;
  const top = panel.getBoundingClientRect().top;

  if (bag) {
    bag.style.position = 'fixed';
    bag.style.top = (top - bag.offsetHeight) + 'px';
    bag.style.bottom = 'auto';
  }
  if (fab && !hasCustomFabPos()) {
    fab.style.position = 'fixed';
    fab.style.top = (top - fab.offsetHeight - 14) + 'px';
    fab.style.bottom = 'auto';
  }
}

function hasCustomFabPos() {
  try { return !!localStorage.getItem('lyrra_fab_pos'); } catch { return false; }
}

(function setupDraggableFab() {
  const fab = $('#fab-quick');
  let dragging = false, moved = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function savePos(left, top) {
    try { localStorage.setItem('lyrra_fab_pos', JSON.stringify({ left, top })); } catch { /* ignore */ }
  }

  function loadPos() {
    try {
      const saved = JSON.parse(localStorage.getItem('lyrra_fab_pos') || 'null');
      if (!saved) return;
      fab.style.left = clamp(saved.left, 4, window.innerWidth - fab.offsetWidth - 4) + 'px';
      fab.style.top = clamp(saved.top, 4, window.innerHeight - fab.offsetHeight - 4) + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
    } catch { /* ignore */ }
  }

  fab.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = false;
    const rect = fab.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    fab.setPointerCapture(e.pointerId);
  });

  fab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
    if (!moved) return;
    const newLeft = clamp(startLeft + dx, 4, window.innerWidth - fab.offsetWidth - 4);
    const newTop = clamp(startTop + dy, 4, window.innerHeight - fab.offsetHeight - 4);
    fab.style.left = newLeft + 'px';
    fab.style.top = newTop + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  });

  fab.addEventListener('pointerup', () => {
    dragging = false;
    if (moved) {
      const rect = fab.getBoundingClientRect();
      savePos(rect.left, rect.top);
    }
  });

  // Kalau ini beneran drag (bukan sekadar tap), jangan buka modal Aksi Cepat
  fab.addEventListener('click', (e) => {
    if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
  }, true);

  if (hasCustomFabPos()) loadPos();

  // Re-anchor bag/FAB whenever the action-panel's actual size changes
  // (tab switch, dungeon panel show/hide, orientation change, etc.)
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => anchorFloatingButtons());
    ro.observe($('#action-panel'));
  }
  window.addEventListener('resize', anchorFloatingButtons);
  window.addEventListener('orientationchange', () => setTimeout(anchorFloatingButtons, 60));
  anchorFloatingButtons();
})();

function switchToTab(tabName) {
  $all('.tab-btn').forEach(t => t.classList.remove('active'));
  $all('.tab-content').forEach(t => t.classList.remove('active'));
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const tabContent = document.querySelector(`.tab-content[data-tab-content="${tabName}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  if (tabContent) tabContent.classList.add('active');
}

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
    btn.onclick = () => sendCommand('dungeon_enter', { dungeonId: d.id });
    box.appendChild(btn);
  });
}

function renderDungeonFloor(df) {
  const panel = $('#dungeon-floor-panel');
  const status = $('#dungeon-floor-status');
  if (!df) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  const lines = [`${df.dungeonId} — Lantai ${df.floor}/${df.totalFloors}`];
  if (df.monster) {
    lines.push(`Musuh: ${df.monster.name} HP ${df.monster.hp}/${df.monster.maxHp}`);
  } else {
    lines.push('Lantai aman — tekan Lantai Berikutnya.');
  }
  lines.push(`Bareng: ${df.others.length ? df.others.join(', ') : '(sendirian)'}`);
  status.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  $('#btn-dungeon-attack').disabled = !df.monster;
  $('#btn-dungeon-skill').disabled = !df.monster;
  $('#btn-dungeon-advance').disabled = !!df.monster;
}

$('#btn-dungeon-attack').onclick = () => sendCommand('dungeon_attack');
$('#btn-dungeon-advance').onclick = () => sendCommand('dungeon_advance');
$('#btn-dungeon-leave').onclick = () => {
  sendCommand('dungeon_leave');
  $('#dungeon-floor-panel').style.display = 'none';
};
$('#btn-dungeon-refresh').onclick = () => sendCommand('dungeon_status');
$('#btn-dungeon-skill').onclick = () => {
  const skillId = prompt('ID skill serang yang mau dipakai (lihat di tombol Skill buat daftarnya):');
  if (!skillId || !skillId.trim()) return;
  sendCommand('dungeon_skill', { skillId: skillId.trim() });
};

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

function renderRankList(rank) {
  const box = $('#rank-list');
  box.innerHTML = '';
  if (!rank || !rank.length) { box.textContent = ''; return; }
  rank.forEach(r => {
    const line = document.createElement('div');
    line.className = 'hint';
    line.style.display = 'block';
    line.textContent = `#${r.pos} ${r.username} — ${r.value}`;
    box.appendChild(line);
  });
}

$('#btn-rank-prof').onclick = () => {
  const prof = prompt('Profesi (mining/chopping/fishing/farming/hunting/herbalism/smithing/cooking/alchemy/tailoring):', 'mining');
  if (!prof) return;
  sendCommand('rank_profession', { profession: prof.trim().toLowerCase() });
};

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
  renderEquippedInBag(slots);
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

function renderEquippedInBag(slots) {
  const box = $('#inventory-equipped-list');
  if (!box) return;
  box.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'feature-title';
  label.textContent = '⚔️ Terpasang';
  box.appendChild(label);
  if (!slots || !slots.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = 'Belum ada equipment terpasang.';
    box.appendChild(empty);
    return;
  }
  slots.forEach(s => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:4px;align-items:center;';
    const info = document.createElement('div');
    info.className = 'hint';
    info.style.flex = '1';
    info.textContent = `${s.name} [${s.slot}]`;
    const btn = document.createElement('button');
    btn.className = 'btn-cmd small';
    btn.textContent = 'Lepas';
    btn.onclick = () => sendCommand('unequip', { slot: s.slot });
    wrap.appendChild(info);
    wrap.appendChild(btn);
    box.appendChild(wrap);
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
          const monsterName = prompt('Nama monster target (kosongkan = otomatis pilih monster di area ini):');
          if (monsterName === null) return; // dibatalkan
          sendCommand('use_skill', { skillId: sk.id, monsterName: monsterName.trim() || undefined });
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
  const gemName = prompt('Nama gem dari inventory (mis. Ruby):');
  if (gemName) sendCommand('socket_gem', { slot: selectedSlot, gemName: gemName.trim() });
};

// ── Pet ──
$('#btn-pet-equip').onclick = () => {
  const petName = prompt('Nama pet dari inventory (mis. Slime):');
  if (petName) sendCommand('pet_equip', { petName: petName.trim() });
};
$('#btn-pet-feed').onclick = () => {
  const foodName = prompt('Nama makanan dari inventory:');
  if (foodName) sendCommand('pet_feed', { foodName: foodName.trim() });
};

// ── Player market (jual) ──
$('#btn-market-list').onclick = () => {
  const itemName = prompt('Nama item yang mau dijual:');
  if (!itemName) return;
  const qty = prompt('Jumlah:', '1');
  const price = prompt('Harga per item (gold):', '10');
  sendCommand('market_list', { itemName: itemName.trim(), qty: Number(qty) || 1, price: Number(price) || 1 });
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
      if (msg.sessionToken) saveSession(currentHost, currentPort, msg.sessionToken);
      showScreen(msg.needsClass ? '#screen-class' : '#screen-game');
      if (msg.needsClass) sendCommand('classes');
      break;

    case 'session_invalid':
      clearSession(currentHost, currentPort);
      $('#connect-status').textContent = '';
      showScreen('#screen-auth');
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
      if (msg.data?.dungeonFloor) renderDungeonFloor(msg.data.dungeonFloor);
      if (msg.data?.availableQuests) renderQuestButtons(msg.data.availableQuests);
      if (msg.data?.listings) renderMarketButtons(msg.data.listings);
      if (msg.data?.mails) renderMailButtons(msg.data.mails);
      if (msg.data?.equippableItems) renderEquipButtons(msg.data.equippableItems);
      if (msg.data?.equippedSlots) renderUnequipButtons(msg.data.equippedSlots);
      if (msg.data?.usableItems) renderUsableButtons(msg.data.usableItems);
      if (msg.data?.skills) renderSkillButtons(msg.data.skills);
      if (msg.data?.friends) renderFriendButtons(msg.data.friends);
      if (msg.data?.rank) renderRankList(msg.data.rank);
      if (msg.data?.bank) renderBankInfo(msg.data.bank);
      if (msg.data?.chests) renderChestList(msg.data.chests);
      if (msg.data?.allItems) renderFullInventory(msg.data.allItems);
      break;

    case 'chat':
      logLine(`<${msg.from}> ${msg.text}`, 'chat');
      break;

    case 'online':
      $('#online-list').textContent = 'Online: ' + (msg.list?.join(', ') || '-');
      renderOnlinePlayers(msg.list || []);
      break;

    default:
      break;
  }
}
