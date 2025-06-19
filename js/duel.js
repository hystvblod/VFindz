// ========== PARAMS ==========
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const path = window.location.pathname;

// ========== VARIABLES GLOBALES ==========
let currentRoomId = null;
let isPlayer1 = false;
let roomData = null;
let timerInterval = null;

// ========== CHANNEL GLOBAL ==========
window._duelRoomChannel = null;
window._duelRoomChannelId = null;

// ========== Helpers cloud points/jetons ==========
window.getPointsCloud = async function() {
  const profil = await window.getUserDataCloud();
  return profil.points || 0;
};
window.getJetons = async function() {
  const profil = await window.getUserDataCloud();
  return profil.jetons || 0;
};

// ========== IndexedDB cache ==========
const VFindDuelDB = {
  db: null,
  async init() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('VFindDuelPhotos', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('photos', { keyPath: 'key' });
      };
      open.onsuccess = () => {
        VFindDuelDB.db = open.result;
        resolve();
      };
      open.onerror = reject;
    });
  },
  async set(key, data) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('photos', 'readwrite');
      tx.objectStore('photos').put({ key, dataUrl: data.url, cadre: data.cadre });
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  },
  async get(key) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('photos', 'readonly');
      const req = tx.objectStore('photos').get(key);
      req.onsuccess = () => resolve(req.result ? { url: req.result.dataUrl, cadre: req.result.cadre } : null);
      req.onerror = reject;
    });
  },
  async deleteAllForRoom(roomId) {
    await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('photos', 'readwrite');
      const store = tx.objectStore('photos');
      const req = store.openCursor();
      req.onsuccess = function() {
        const cursor = req.result;
        if (cursor) {
          if (cursor.key.startsWith(roomId + "_")) cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = resolve;
      tx.onerror = reject;
    });
  }
};
window.VFindDuelDB = VFindDuelDB;

// ========== Cadres par photo ==========
function getCadreDuel(duelId, idx) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (data[duelId] && data[duelId][idx]) return data[duelId][idx];
  return window.getCadreSelectionneCached ? getCadreSelectionneCached() : "polaroid_01";
}
window.getCadreDuel = getCadreDuel;

function setCadreDuel(duelId, idx, cadreId) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (!data[duelId]) data[duelId] = {};
  data[duelId][idx] = cadreId;
  localStorage.setItem("duel_cadres_specifiques", JSON.stringify(data));
}
window.setCadreDuel = setCadreDuel;

// ========== Premium colonne titre ==========
async function setColTitlePremium(element, pseudo) {
  if (!pseudo) { element.classList.remove('premium'); return; }
  const { data } = await window.supabase.from('users').select('premium').eq('pseudo', pseudo).single();
  if (data && data.premium) {
    element.classList.add('premium');
  } else {
    element.classList.remove('premium');
  }
}
window.setColTitlePremium = setColTitlePremium;

// ========== PHOTOS AIMÉES ==========
function getPhotosAimeesDuel() {
  return JSON.parse(localStorage.getItem("photos_aimees_duel") || "[]");
}
window.getPhotosAimeesDuel = getPhotosAimeesDuel;

function aimerPhotoDuel(defiId) {
  let aimes = getPhotosAimeesDuel();
  if (!aimes.includes(defiId)) {
    aimes.push(defiId);
    localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
  }
}
window.aimerPhotoDuel = aimerPhotoDuel;

function retirerPhotoAimeeDuel(defiId) {
  let aimes = getPhotosAimeesDuel();
  aimes = aimes.filter(id => id !== defiId);
  localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
}
window.retirerPhotoAimeeDuel = retirerPhotoAimeeDuel;

// ========== UPLOAD PHOTO (webp, storage, DB, cache) ==========
async function uploadPhotoDuelWebp(dataUrl, duelId, idx, cadreId) {
  function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], {type:mime});
  }
  const userId = window.getUserId ? window.getUserId() : (await window.getPseudo());
  const blob = dataURLtoBlob(dataUrl);
  const filePath = `duel_photos/${duelId}_${idx}_${userId}_${Date.now()}.webp`;

  const { error: uploadError } = await window.supabase.storage
    .from('photosduel')
    .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) throw new Error("Erreur upload storage : " + uploadError.message);

  const { data: urlData } = window.supabase.storage.from('photosduel').getPublicUrl(filePath);
  const url = urlData.publicUrl;

  const pseudo = await window.getPseudo();
  const { data: room, error: roomError } = await window.supabase.from('duels').select('*').eq('id', duelId).single();
  if (!room) throw new Error("Room introuvable");

  const champ = (room.player1_pseudo === pseudo) ? 'photosa' : 'photosb';
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await window.supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);

  await VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url, cadre: cadreId });
  setCadreDuel(duelId, idx, cadreId);

  return url;
}
window.uploadPhotoDuelWebp = uploadPhotoDuelWebp;

// ========== HANDLERS SOLDE/POINTS/JETONS ==========
async function afficherSolde() {
  const points = await window.getPointsCloud();
  const jetons = await window.getJetons();
  const pointsSpan = document.getElementById('points');
  const jetonsSpan = document.getElementById('jetons');
  if (pointsSpan) pointsSpan.textContent = points ?? 0;
  if (jetonsSpan) jetonsSpan.textContent = jetons ?? 0;
}
window.afficherSolde = afficherSolde;

async function validerDefiAvecJeton(idx) {
  const { error } = await window.supabase.rpc('secure_remove_jeton', { nb: 1 });
  if (error) {
    alert("Erreur lors du retrait du jeton : " + error.message);
    return;
  }
  await afficherSolde();
}
window.validerDefiAvecJeton = validerDefiAvecJeton;

async function gagnerJeton() {
  const { error } = await window.supabase.rpc('secure_add_jetons', { nb: 1 });
  if (error) {
    alert("Erreur lors de l'ajout du jeton : " + error.message);
    return;
  }
  await afficherSolde();
}
window.gagnerJeton = gagnerJeton;

async function retirerPoints(montant) {
  const { error } = await window.supabase.rpc('secure_remove_points', { nb: montant });
  if (error) {
    alert("Erreur lors du retrait des points : " + error.message);
    return;
  }
  await afficherSolde();
}
window.retirerPoints = retirerPoints;

async function gagnerPoints(montant) {
  const { error } = await window.supabase.rpc('secure_add_points', { nb: montant });
  if (error) {
    alert("Erreur lors de l'ajout des points : " + error.message);
    return;
  }
  await afficherSolde();
}
window.gagnerPoints = gagnerPoints;

// ========== HELPERS ==========
function $(id) { return document.getElementById(id); }
window.$ = $;

// ========== GET DEFIS (depuis Supabase, fallback local si erreur) ==========
async function getDefisDuelFromSupabase(count = 3) {
  let { data, error } = await window.supabase
    .from('defis')
    .select('intitule')
    .order('random()', { ascending: false })
    .limit(count);
  if (error || !data || data.length < count) {
    const backup = [
      "Un escargot",
      "Photo d'un animal",
      "Photo d'une ombre"
    ];
    return backup.sort(() => 0.5 - Math.random()).slice(0, count);
  }
  return data.map(x => x.intitule);
}
window.getDefisDuelFromSupabase = getDefisDuelFromSupabase;

// ========== FIND OR CREATE ROOM ALÉATOIRE ==========
async function findOrCreateRoom() {
  if (await checkAlreadyInDuel()) return;
  localStorage.removeItem("duel_random_room");
  localStorage.removeItem("duel_is_player1");
  const pseudo = await window.getPseudo();

  const start = Date.now();
  let foundRoom = false;

  // On essaie de trouver une room existante pendant 30 secondes maximum
  while (Date.now() - start < 30000) {
    let { data: rooms } = await window.supabase
      .from('duels')
      .select('*')
      .eq('status', 'waiting')
      .neq('player1_pseudo', pseudo);
    if (rooms && rooms.length > 0) {
      const room = rooms[0];
      const player2_id = await window.getUserId();
      await window.supabase.from('duels').update({
        player2_id,
        player2_pseudo: pseudo,
        status: 'playing',
        starttime: Date.now()
      }).eq('id', room.id);
      localStorage.setItem("duel_random_room", room.id);
      localStorage.setItem("duel_is_player1", "0");
      setTimeout(() => {
        window.location.href = `duel_game.html?room=${room.id}`;
      }, 200);
      foundRoom = true;
      break;
    }
    // Délai randomisé entre 800 et 1300 ms
    const delay = 800 + Math.floor(Math.random() * 500);
    await new Promise(r => setTimeout(r, delay));
  }

  if (foundRoom) return;

  // SÉCURITÉ finale : on vérifie une dernière fois avant de créer
  let { data: rooms } = await window.supabase
    .from('duels')
    .select('*')
    .eq('status', 'waiting')
    .neq('player1_pseudo', pseudo);
  if (rooms && rooms.length > 0) {
    const room = rooms[0];
    const player2_id = await window.getUserId();
    await window.supabase.from('duels').update({
      player2_id,
      player2_pseudo: pseudo,
      status: 'playing',
      starttime: Date.now()
    }).eq('id', room.id);
    localStorage.setItem("duel_random_room", room.id);
    localStorage.setItem("duel_is_player1", "0");
    setTimeout(() => {
      window.location.href = `duel_game.html?room=${room.id}`;
    }, 200);
    return;
  }

  // Toujours aucune room, on crée la nôtre
  const player1Id = await window.getUserId();
  const defis = await getDefisDuelFromSupabase(3);

  const roomObj = {
    player1_id: player1Id,
    player2_id: null,
    player1_pseudo: pseudo,
    player2_pseudo: null,
    score1: 0, score2: 0, status: 'waiting',
    createdat: Date.now(), defis, starttime: null, photosa: {}, photosb: {}, type: 'random'
  };

  const { data, error } = await window.supabase.from('duels').insert([roomObj]).select();
  if (error) {
    alert("Erreur création duel : " + error.message);
    return;
  }
  localStorage.setItem("duel_random_room", data[0].id);
  localStorage.setItem("duel_is_player1", "1");
  setTimeout(() => {
    waitRoom(data[0].id);
  }, 200);
}
window.findOrCreateRoom = findOrCreateRoom;

// ========== FONCTION CREATION DUEL PRIVE/PREMIUM ==========
window.creerDuelPrive = async function(amiPseudo) {
  const monPseudo = await window.getPseudo();
  const defis = await getDefisDuelFromSupabase(3);
  const roomObj = {
    player1_pseudo: monPseudo,
    player2_pseudo: amiPseudo,
    score1: 0, score2: 0,
    status: 'playing',
    createdat: Date.now(),
    defis,
    starttime: Date.now(),
    photosa: {}, photosb: {},
    type: 'prive'
  };
  const { data, error } = await window.supabase.from('duels').insert([roomObj]).select();
  if (error) {
    alert("Erreur création duel privé : " + error.message);
    return;
  }
  window.location.href = `duel_game.html?room=${data[0].id}`;
}

window.creerDuelPremium = async function(amiPseudo) {
  const monPseudo = await window.getPseudo();
  const defis = await getDefisDuelFromSupabase(3);
  const roomObj = {
    player1_pseudo: monPseudo,
    player2_pseudo: amiPseudo,
    score1: 0, score2: 0,
    status: 'playing',
    createdat: Date.now(),
    defis,
    starttime: Date.now(),
    photosa: {}, photosb: {},
    type: 'premium'
  };
  const { data, error } = await window.supabase.from('duels').insert([roomObj]).select();
  if (error) {
    alert("Erreur création duel premium : " + error.message);
    return;
  }
  window.location.href = `duel_game.html?room=${data[0].id}`;
}

// ========== GESTION ROOM & DUEL ==========
async function checkAlreadyInDuel() {
  const pseudo = await window.getPseudo();
  const { data: duelsEnCours, error } = await window.supabase
    .from('duels')
    .select('id, status, player1_pseudo, player2_pseudo')
    .in('status', ['waiting', 'playing'])
    .or(`player1_pseudo.eq.${pseudo},player2_pseudo.eq.${pseudo}`);
  if (error) return false;
  if (duelsEnCours && duelsEnCours.length > 0) {
    const room = duelsEnCours[0];
    setTimeout(() => {
      window.location.href = `duel_game.html?room=${room.id}`;
    }, 200);
    return true;
  }
  return false;
}
window.checkAlreadyInDuel = checkAlreadyInDuel;

function waitRoom(roomId) {
  const poll = async () => {
    try {
      const { data: r, error } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
      if (error) {
        setTimeout(poll, 2000);
        return;
      }
      if (r && r.status === "playing") {
        setTimeout(() => {
          window.location.href = `duel_game.html?room=${roomId}`;
        }, 200);
      } else if (r && r.status === "waiting") {
        setTimeout(poll, 1500);
      } else {
        alert("Room annulée ou supprimée.");
      }
    } catch (e) {
      setTimeout(poll, 2000);
    }
  };
  poll();
}
window.waitRoom = waitRoom;

// ========== LOGIQUE DU JEU : INIT, SYNC, RENDER ==========
async function initDuelGame() {
  if (!(path.includes("duel_game.html") && roomId)) return;
  currentRoomId = roomId;
  window.currentRoomId = currentRoomId;
  const pseudo = await window.getPseudo();
  const room = await getRoom(roomId);
  isPlayer1 = (room.player1_pseudo === pseudo);

  subscribeRoom(roomId, (data) => {
    roomData = data;
    updateDuelUI();
    checkFinDuel();
  });
  roomData = await getRoom(roomId);
  updateDuelUI();
  await checkFinDuel();

  async function updateDuelUI() {
    if (!roomData) return;
    const pseudo = await window.getPseudo();

    let advID = isPlayer1 ? roomData.player2_pseudo : roomData.player1_pseudo;
    let myID = isPlayer1 ? roomData.player1_pseudo : roomData.player2_pseudo;
    let headerLabel = advID ? advID : "Adversaire";

    if ($("nom-adversaire")) $("nom-adversaire").textContent = headerLabel;
    if ($("pseudo-moi")) $("pseudo-moi").textContent = myID ? myID : "Moi";

    if ($("pseudo-adv")) {
      if (advID) {
        const { data: advUser } = await window.supabase
          .from('users')
          .select('id_color')
          .eq('pseudo', advID)
          .single();
        let color = (advUser && advUser.id_color) ? advUser.id_color : "white";
        $("pseudo-adv").innerHTML = `<span style="color:${color};font-weight:bold;">${advID}</span>`;
      } else {
        $("pseudo-adv").textContent = "Adversaire";
      }
    }
    if (roomData.starttime && $("timer")) startGlobalTimer(roomData.starttime);
    else if ($("timer")) $("timer").textContent = "--:--:--";
    window.renderDefis();
  }

  function startGlobalTimer(startTime) {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const duration = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const diff = Math.max(0, (startTime + duration) - now);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      $("timer").textContent = `${h}h ${m}m ${s}s`;
      if (diff <= 0) clearInterval(timerInterval);
    }, 1000);
  }
}
window.initDuelGame = initDuelGame;

// ========== PATCH : GESTION ABONNEMENT CANAL SUPABASE ==========
function subscribeRoom(roomId, callback) {
  // Si déjà abonné à cette room, ne rien faire
  if (window._duelRoomChannel && window._duelRoomChannelId === roomId) return;

  // Si abonné à une autre room, clean l'ancien abonnement
  if (window._duelRoomChannel && window._duelRoomChannelId !== roomId) {
    window._duelRoomChannel.unsubscribe();
    window._duelRoomChannel = null;
    window._duelRoomChannelId = null;
  }

  // Nouveau subscribe
  const channel = window.supabase
    .channel('duel_room_' + roomId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'duels',
      filter: `id=eq.${roomId}`
    }, payload => {
      callback(payload.new);
    })
    .subscribe();

  window._duelRoomChannel = channel;
  window._duelRoomChannelId = roomId;
}
window.subscribeRoom = subscribeRoom;

// ========== UTILS GET ROOM, PHOTO DUEL, SAVE PHOTO ==========
async function getRoom(roomId) {
  const { data } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
  return data;
}
window.getRoom = getRoom;

async function getPhotoDuel(roomId, champ, idx) {
  const cacheKey = `${roomId}_${champ}_${idx}`;
  let obj = await VFindDuelDB.get(cacheKey);
  if (obj && obj.url) return obj;
  const room = await getRoom(roomId);
  let url, cadre;
  if (room && room[champ] && room[champ][idx]) {
    if (typeof room[champ][idx] === "object") {
      url = room[champ][idx].url;
      cadre = room[champ][idx].cadre;
    } else {
      url = room[champ][idx];
      cadre = "polaroid_01";
    }
  }
  if (url) {
    await VFindDuelDB.set(cacheKey, { url, cadre });
    return { url, cadre };
  }
  return null;
}
window.getPhotoDuel = getPhotoDuel;

async function savePhotoDuel(idx, url, cadreId = null) {
  const champ = isPlayer1 ? 'photosa' : 'photosb';
  if (!cadreId) cadreId = getCadreDuel(roomId, idx);
  const room = await getRoom(roomId);
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await window.supabase.from('duels').update({ [champ]: photos }).eq('id', roomId);
  await VFindDuelDB.set(`${roomId}_${champ}_${idx}`, { url, cadre: cadreId });
  setCadreDuel(roomId, idx, cadreId);
}
window.savePhotoDuel = savePhotoDuel;

function agrandirPhoto(url, cadre) {
  $("photo-affichee").src = url;
  $("cadre-affiche").src = `./assets/cadres/${cadre}.webp`;
  const popup = $("popup-photo");
  popup.classList.remove('hidden');
  popup.classList.add('show');
}
window.agrandirPhoto = agrandirPhoto;

async function cleanupDuelPhotos() {
  await VFindDuelDB.deleteAllForRoom(roomId);
}
window.cleanupDuelPhotos = cleanupDuelPhotos;

// ========== LOGIQUE FIN DE DUEL + POPUP ==========
async function checkFinDuel() {
  if (!roomData) return;
  const start = roomData.starttime;
  const duration = 24 * 60 * 60 * 1000;
  if (start && (Date.now() > start + duration)) {
    await finirDuel();
    return;
  }
  const nbDefis = (roomData.defis || []).length;
  const okA = Object.values(roomData.photosa || {}).filter(x => x && x.url).length === nbDefis;
  const okB = Object.values(roomData.photosb || {}).filter(x => x && x.url).length === nbDefis;
  if (okA && okB) await finirDuel();
}
window.checkFinDuel = checkFinDuel;

async function finirDuel() {
  if (roomData.status !== 'finished') {
    await window.supabase.from('duels').update({ status: 'finished' }).eq('id', roomData.id);
  }
  afficherPopupFinDuel(roomData);
}
window.finirDuel = finirDuel;

// ========== POPUP FIN DE DUEL ==========
async function afficherPopupFinDuel(room) {
  const pseudo = await window.getPseudo();
  const isP1 = room.player1 === pseudo;
  const myChamp = isP1 ? 'photosa' : 'photosb';
  const advChamp = isP1 ? 'photosb' : 'photosa';
  const myID = isP1 ? room.player1 : room.player2;
  const advID = isP1 ? room.player2 : room.player1;

  const nbDefis = (room.defis || []).length;
  const photosMy = room[myChamp] || {};
  const photosAdv = room[advChamp] || {};

  let html = '<table class="fin-defis-table"><tr><th>Défi</th><th>Moi</th><th>' + (advID || "Adversaire") + '</th></tr>';
  for (let i = 0; i < nbDefis; i++) {
    const defi = room.defis[i] || "-";
    const okMe = photosMy[i] && photosMy[i].url ? "✅" : "❌";
    const okAdv = photosAdv[i] && photosAdv[i].url ? "✅" : "❌";
    html += `<tr><td>${defi}</td><td style="text-align:center">${okMe}</td><td style="text-align:center">${okAdv}</td></tr>`;
  }
  html += '</table>';

  $("fin-faceaface").innerHTML =
    `<div class="fin-faceaface-row">
      <span><b>${myID || "Moi"}</b> (toi)</span>
      <span>vs</span>
      <span><b>${advID || "Adversaire"}</b></span>
    </div>`;
  $("fin-details").innerHTML = html;

  let nbFaits = Object.values(photosMy).filter(p => p && p.url).length;
  let gain = nbFaits * 10;
  if (nbFaits === nbDefis) gain += 10;

  let gainFlag = "gain_duel_" + room.id + "_" + myID;
  if (!localStorage.getItem(gainFlag)) {
    const { error } = await window.supabase.rpc('secure_add_points', { nb: gain });
    if (error) {
      alert("Erreur lors de l'ajout des points : " + error.message);
    } else {
      localStorage.setItem(gainFlag, "1");
    }
  }

  $("fin-gain").innerHTML =
    `+${gain} pièces (${nbFaits} défi${nbFaits > 1 ? "s" : ""} x10${nbFaits === 3 ? " +10 bonus" : ""})`;

  $("fin-titre").textContent = "Fin du duel";
  $("popup-fin-duel").classList.remove("hidden");
  $("popup-fin-duel").classList.add("show");

  $("fin-btn-replay").onclick = function () {
    window.location.href = "duel_random.html";
  };
  $("fin-btn-retour").onclick = function () {
    window.location.href = "index.html";
  };
  $("close-popup-fin").onclick = function () {
    $("popup-fin-duel").classList.add("hidden");
    $("popup-fin-duel").classList.remove("show");
  };
}
window.afficherPopupFinDuel = afficherPopupFinDuel;

// ========== POPUP PUB/PREMIUM ==========
function ouvrirPopupRepriseDuel(onPub) {
  const popup = document.getElementById("popup-reprise-photo-duel");
  popup.classList.remove("hidden");
  popup.classList.add("show");
  document.getElementById("btnReprisePremiumDuel").onclick = function() {
    window.open("https://play.google.com/store/apps/details?id=TON_APP_ID", "_blank");
  };
  document.getElementById("btnReprisePubDuel").onclick = function() {
    popup.classList.add("hidden");
    popup.classList.remove("show");
    onPub && onPub();
  };
  document.getElementById("btnAnnulerRepriseDuel").onclick = function() {
    popup.classList.add("hidden");
    popup.classList.remove("show");
  };
}
window.ouvrirPopupRepriseDuel = ouvrirPopupRepriseDuel;

// ========== PRISE PHOTO : GESTION PREMIUM/PUB ==========
async function gererPrisePhotoDuel(idx, cadreId = null) {
  let duelId = currentRoomId || window.currentRoomId || roomId;
  if (!duelId) {
    alert("Erreur critique : identifiant duel introuvable.");
    return;
  }
  if (!cadreId) cadreId = getCadreDuel(duelId, idx);

  // Vérifie si une photo existe déjà (donc demande de reprise)
  const cacheKey = `${duelId}_${isPlayer1 ? 'photosa' : 'photosb'}_${idx}`;
  const dejaPhoto = await VFindDuelDB.get(cacheKey);

  const premium = await window.isPremium();
  const repriseKey = `reprise_duel_${duelId}_${idx}`;
  let reprises = parseInt(localStorage.getItem(repriseKey) || "0");

  // Première photo : OK, aucune restriction
  if (!dejaPhoto) {
    localStorage.setItem(repriseKey, "0");
    window.cameraOuvrirCameraPourDuel && window.cameraOuvrirCameraPourDuel(idx, duelId, cadreId);
    return;
  }

  // PREMIUM : illimité
  if (premium) {
    window.cameraOuvrirCameraPourDuel && window.cameraOuvrirCameraPourDuel(idx, duelId, cadreId);
    return;
  }

  // NON PREMIUM : max 1 pub possible par photo
  if (reprises === 0) {
    ouvrirPopupRepriseDuel(() => {
      localStorage.setItem(repriseKey, "1");
      window.cameraOuvrirCameraPourDuel && window.cameraOuvrirCameraPourDuel(idx, duelId, cadreId);
      window.pubAfterPhoto = true;
    });
    return;
  } else {
    alert("Pour reprendre encore la photo, passe en Premium !");
    return;
  }
}
window.gererPrisePhotoDuel = gererPrisePhotoDuel;

// ========== POPUP JETON (pour valider avec jeton) ==========
window.ouvrirPopupValiderJeton = function(idx) {
  window._idxJetonToValidate = idx;
  document.getElementById("popup-jeton-valider").classList.remove("hidden");
};

// Handler bouton valider jeton
document.addEventListener("DOMContentLoaded", () => {
  const btnValider = document.getElementById("btn-confirm-jeton");
  const btnCancel = document.getElementById("btn-cancel-jeton");
  if(btnValider) btnValider.onclick = async function() {
    const idx = window._idxJetonToValidate;
    if(typeof ouvrirPopupJeton === "function") await ouvrirPopupJeton(idx);
    document.getElementById("popup-jeton-valider").classList.add("hidden");
    window._idxJetonToValidate = null;
    await afficherSolde();
  };
  if(btnCancel) btnCancel.onclick = function() {
    document.getElementById("popup-jeton-valider").classList.add("hidden");
    window._idxJetonToValidate = null;
  };
});

// ========== POPUP CHOIX CADRE ==========
window.ouvrirPopupChoixCadre = async function(duelId, idx, champ) {
  let cadres = [];
  try {
    cadres = window.getCadresPossedes ? await window.getCadresPossedes() : ["polaroid_01"];
  } catch(e) { cadres = ["polaroid_01"]; }

  const actuel = getCadreDuel(duelId, idx);
  const list = document.getElementById("list-cadres-popup");
  list.innerHTML = "";
  cadres.forEach(cadre => {
    let el = document.createElement("img");
    el.src = "./assets/cadres/" + cadre + ".webp";
    el.style.width = "72px";
    el.style.cursor = "pointer";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 0 7px #0006";
    el.style.border = cadre === actuel ? "3px solid #FFD900" : "3px solid transparent";
    el.title = cadre;
    el.onclick = async () => {
      setCadreDuel(duelId, idx, cadre);
      const { data: room } = await window.supabase.from('duels').select('*').eq('id', duelId).single();
      let photos = (room && room[champ]) ? room[champ] : {};
      if (photos[idx] && typeof photos[idx] === "object") {
        photos[idx].cadre = cadre;
      } else if (typeof photos[idx] === "string") {
        photos[idx] = { url: photos[idx], cadre: cadre };
      }
      await window.supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);
      await VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url: photos[idx].url, cadre: cadre });
      fermerPopupCadreChoix();
      location.reload();
    };
    list.appendChild(el);
  });
  document.getElementById("popup-cadre-choix").classList.remove("hidden");
};
window.fermerPopupCadreChoix = function() {
  document.getElementById("popup-cadre-choix").classList.add("hidden");
};

// ========== GESTION SIGNAL PHOTO ==========
window.fermerPopupSignal = function() {
  const popup = document.getElementById("popup-signal-photo");
  if (popup) {
    popup.classList.add("hidden");
    popup.classList.remove("show");
    popup.dataset.url = "";
    popup.dataset.idx = "";
  }
};

// Signalement : gestion du clic sur motif
document.body.addEventListener("click", async function(e) {
  const signalTypeBtn = e.target.closest(".btn-signal-type");
  if (!signalTypeBtn) return;

  const popup = document.getElementById("popup-signal-photo");
  const photoUrl = popup.dataset.url;
  const idx = popup.dataset.idx || "";
  const motif = signalTypeBtn.dataset.type;

  if (!photoUrl || !motif) {
    alert("Erreur : impossible de retrouver la photo ou le motif.");
    return;
  }

  try {
    const response = await fetch(photoUrl);
    const blob = await response.blob();

    const fileName = `defi${idx}_${motif}_${Date.now()}.webp`;

    const { error } = await window.supabase
      .storage
      .from('signalements')
      .upload(fileName, blob, { contentType: 'image/webp' });

    if (error) {
      alert("Erreur d’envoi : " + error.message);
    } else {
      alert("Signalement envoyé à la modération.");
      window.fermerPopupSignal();
    }
  } catch (err) {
    alert("Erreur lors de l'envoi : " + err.message);
  }
});

// ========== FERMER POPUP CROIX GÉNÉRAL ==========
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.close-btn, #close-popup').forEach(btn => {
    btn.onclick = function() {
      let popup = btn.closest('.popup');
      if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('show');
      }
    };
  });
});

// ========== INIT AUTO DES PAGES ==========
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}
if (window.location.pathname.includes("duel_amis_premium.html")) {
  // Ta logique premium si tu veux (non recopiée ici)
}
document.addEventListener("DOMContentLoaded", afficherSolde);
window.renderDefis = function () {
  console.log('renderDefis', window.roomData); // Ajout pour debug
  if (!window.roomData || !roomData.defis) return;

  const liste = document.getElementById("duel-defi-list");
  if (!liste) return;
  liste.innerHTML = "";

  roomData.defis.forEach((defi, idx) => {
    const li = document.createElement("li");
    li.className = "defi-item";

    li.innerHTML = `
      <div class="defi-col defi-titre">${defi}</div>
      <div class="defi-col">
        <button onclick="window.gererPrisePhotoDuel(${idx})">📷</button>
      </div>
      <div class="defi-col">
        <button onclick="window.afficherPhotoDuel(${idx})">👁️</button>
      </div>
    `;

    liste.appendChild(li);
  });
};
window.afficherPhotoDuel = async function(idx) {
  const champ = window.isPlayer1 ? 'photosa' : 'photosb';
  const photo = await window.getPhotoDuel(window.currentRoomId, champ, idx);
  if (!photo || !photo.url) {
    alert("Aucune photo trouvée pour ce défi.");
    return;
  }
  window.agrandirPhoto(photo.url, photo.cadre || "polaroid_01");
};

// ... (tout le reste inchangé : popup, gestion jeton, choix cadre, etc.)

// ========== INIT AUTO DES PAGES ==========
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}
document.addEventListener("DOMContentLoaded", afficherSolde);



// ... (tout le reste inchangé : popup, gestion jeton, choix cadre, etc.)

// ========== INIT AUTO DES PAGES ==========
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}
document.addEventListener("DOMContentLoaded", afficherSolde);
