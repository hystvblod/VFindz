// ===== IMPORTS =====
import {
  supabase, getJetons, getPoints, getPseudo as getCurrentUser, getUserId,
  getCadreSelectionne, ajouterDefiHistorique, addJetons, removeJeton, addPoints, removePoints, isPremium,
  getCadresPossedes, getCadreUrl
} from './userData.js';
import { showAd } from './pub.js';

// ======= PARAMS =======
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const path = window.location.pathname;

// ======= VARIABLES GLOBALES =======
export let currentRoomId = null;
export let isPlayer1 = false;
export let roomData = null;
let timerInterval = null;

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

// ====== Cadres par photo (localStorage) ======
function getCadreDuel(duelId, idx) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (data[duelId] && data[duelId][idx]) return data[duelId][idx];
  return window.getCadreSelectionneCached ? getCadreSelectionneCached() : "polaroid_01";
}
function setCadreDuel(duelId, idx, cadreId) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (!data[duelId]) data[duelId] = {};
  data[duelId][idx] = cadreId;
  localStorage.setItem("duel_cadres_specifiques", JSON.stringify(data));
}

// ===== Premium display pour le titre colonne =====
async function setColTitlePremium(element, pseudo) {
  if (!pseudo) { element.classList.remove('premium'); return; }
  const { data } = await supabase.from('users').select('premium').eq('pseudo', pseudo).single();
  if (data && data.premium) {
    element.classList.add('premium');
  } else {
    element.classList.remove('premium');
  }
}

// ======== PHOTOS AIMÉES (coeur duel) ========
export function getPhotosAimeesDuel() {
  return JSON.parse(localStorage.getItem("photos_aimees_duel") || "[]");
}
export function aimerPhotoDuel(defiId) {
  let aimes = getPhotosAimeesDuel();
  if (!aimes.includes(defiId)) {
    aimes.push(defiId);
    localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
  }
}
export function retirerPhotoAimeeDuel(defiId) {
  let aimes = getPhotosAimeesDuel();
  aimes = aimes.filter(id => id !== defiId);
  localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
}

// ======== UPLOAD PHOTO (webp, storage, DB, cache) ========
export async function uploadPhotoDuelWebp(dataUrl, duelId, idx, cadreId) {
  function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], {type:mime});
  }
  const userId = getUserId ? getUserId() : (await getCurrentUser());
  const blob = dataURLtoBlob(dataUrl);
  const filePath = `duel_photos/${duelId}_${idx}_${userId}_${Date.now()}.webp`;

  const { error: uploadError } = await supabase.storage
    .from('photosduel')
    .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) throw new Error("Erreur upload storage : " + uploadError.message);

  const { data: urlData } = supabase.storage.from('photosduel').getPublicUrl(filePath);
  const url = urlData.publicUrl;

  const pseudo = await getCurrentUser();
  const { data: room, error: roomError } = await supabase.from('duels').select('*').eq('id', duelId).single();
  if (!room) throw new Error("Room introuvable");

  const champ = (room.player1_pseudo === pseudo) ? 'photosa' : 'photosb';
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);

  await VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url, cadre: cadreId });
  setCadreDuel(duelId, idx, cadreId);

  return url;
}

// ======= HANDLERS DE SOLDE / POINTS / JETONS =======
export async function afficherSolde() {
  const points = await getPoints();
  const jetons = await getJetons();
  const pointsSpan = document.getElementById('points');
  const jetonsSpan = document.getElementById('jetons');
  if (pointsSpan) pointsSpan.textContent = points ?? 0;
  if (jetonsSpan) jetonsSpan.textContent = jetons ?? 0;
}
export async function validerDefiAvecJeton(idx) {
  // 🔒 Fonction SQL sécurisée
  const { error } = await supabase.rpc('secure_remove_jeton', { nb: 1 });
  if (error) {
    alert("Erreur lors du retrait du jeton : " + error.message);
    return;
  }
  await afficherSolde();
}

export async function gagnerJeton() {
  // 🔒 Fonction SQL sécurisée
  const { error } = await supabase.rpc('secure_add_jetons', { nb: 1 });
  if (error) {
    alert("Erreur lors de l'ajout du jeton : " + error.message);
    return;
  }
  await afficherSolde();
}


export async function retirerPoints(montant) {
  // 🔒 Fonction SQL sécurisée
  const { error } = await supabase.rpc('secure_remove_points', { nb: montant });
  if (error) {
    alert("Erreur lors du retrait des points : " + error.message);
    return;
  }
  await afficherSolde();
}

export async function gagnerPoints(montant) {
  // Appel sécurisé côté serveur
  const { error } = await supabase.rpc('secure_add_points', { nb: montant });
  if (error) {
    alert("Erreur lors de l'ajout des points : " + error.message);
    return;
  }
  await afficherSolde();
}



// ======= FONCTIONS DUEL (MATCHMAKING, INIT, GAME...) =======

export async function findOrCreateRoom() {
  // PATCH ANTI-MULTI
  if (await checkAlreadyInDuel()) return;
  localStorage.removeItem("duel_random_room");
  localStorage.removeItem("duel_is_player1");
  const pseudo = await getCurrentUser();

  for (let i = 0; i < 5; i++) {
    let { data: rooms } = await supabase
      .from('duels')
      .select('*')
      .eq('status', 'waiting')
      .neq('player1_pseudo', pseudo);
    if (rooms && rooms.length > 0) {
      const room = rooms[0];
      const player2_id = await getUserId();
      await supabase.from('duels').update({
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
    await new Promise(r => setTimeout(r, 1200));
  }
  // Nouvelle room
  const player1Id = await getUserId();
  const player1Pseudo = await getCurrentUser();
  const defis = await getDefisDuelFromSupabase(3);

  const roomObj = {
    player1_id: player1Id,
    player2_id: null,
    player1_pseudo: player1Pseudo,
    player2_pseudo: null,
    score1: 0, score2: 0, status: 'waiting',
    createdat: Date.now(), defis, starttime: null, photosa: {}, photosb: {}, type: 'random'
  };

  const { data, error } = await supabase.from('duels').insert([roomObj]).select();
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

async function checkAlreadyInDuel() {
  const pseudo = await getCurrentUser();
  const { data: duelsEnCours, error } = await supabase
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

function waitRoom(roomId) {
  const poll = async () => {
    try {
      const { data: r, error } = await supabase.from('duels').select('*').eq('id', roomId).single();
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

// =============== GAME DUEL PREMIUM AMIS (Défis personnalisés) ===============
async function mainPremiumDuelDefis() {
  if (!roomId) return;
  const pseudo = await getCurrentUser();
  const userId = await getUserId();

  // Récupère la room
  let { data: room } = await supabase.from('duels').select('*').eq('id', roomId).single();
  if (!room) {
    document.getElementById("info-premium").innerHTML = "Room introuvable.";
    return;
  }
  roomData = room;
  isPlayer1 = (room.player1_id === userId);

  // Vérifie Premium
  const premium = await isPremium();

  // Affiche la bonne UI
  if (room.type !== "amis_premium") {
    document.getElementById("info-premium").innerHTML = "Accès réservé au mode Premium.";
    return;
  }

  // Saisie des défis
  async function handleValiderDefis() {
    let d1 = document.getElementById("input-defi1").value.trim();
    let d2 = document.getElementById("input-defi2").value.trim();

    // Cas : on écrit le 3e défi
    let d1Filled = d1.length > 0, d2Filled = d2.length > 0;
    let champ = isPlayer1 ? "defis_player1" : "defis_player2";
    let existing = roomData[champ] ? JSON.parse(roomData[champ]) : [];
    // Si déjà 2 défis => il ne doit remplir que le 3e
    if (existing.length === 2) {
      if (!d2Filled) { alert("Merci d’entrer le 3e défi."); return; }
      let updateArr = [existing[0], existing[1], d2];
      let updateObj = {}; updateObj[champ] = JSON.stringify(updateArr);
      await supabase.from('duels').update(updateObj).eq('id', roomId);
      showAttente();
      return;
    }
    // Normal : 2 défis à écrire
    if (!d1Filled || !d2Filled) { alert("Merci de remplir 2 défis."); return; }
    let updateObj = {};
    updateObj[champ] = JSON.stringify([d1, d2]);
    await supabase.from('duels').update(updateObj).eq('id', roomId);
    showAttente();
  }

  // Synchro temps réel
  supabase
    .channel('duel_room_' + roomId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'duels', filter: `id=eq.${roomId}` }, payload => {
      roomData = payload.new;
      majUI();
    })
    .subscribe();

  // UI helpers
  let blocSaisie = document.getElementById("bloc-defi-saisie");
  let blocFinal = document.getElementById("bloc-defis-final");
  let blocAttente = document.getElementById("bloc-attente");

  function showAttente() {
    blocSaisie.style.display = "none";
    blocAttente.style.display = "block";
    blocFinal.style.display = "none";
  }
  function showDefisFinal(defis) {
    blocSaisie.style.display = "none";
    blocAttente.style.display = "none";
    blocFinal.style.display = "block";
    document.getElementById("liste-defis-final").innerHTML = defis.map(d => `<li>${d}</li>`).join('');
  }
  function majUI() {
    let d1 = roomData.defis_player1 ? JSON.parse(roomData.defis_player1) : [];
    let d2 = roomData.defis_player2 ? JSON.parse(roomData.defis_player2) : [];
    let final = roomData.defis_final ? JSON.parse(roomData.defis_final) : [];
    if (final.length === 3) { showDefisFinal(final); return; }
    // Deux premiums
    if (roomData.premium1 && roomData.premium2) {
      if ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2)) {
        // Saisie défis (2 à remplir)
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Propose 2 défis originaux pour ce duel :";
        document.getElementById("input-defi1").style.display = "";
        document.getElementById("input-defi2").style.display = "";
        document.getElementById("input-defi1").value = "";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if (d1.length === 2 && d2.length === 2 && final.length < 3) {
        // Les 2 ont proposé, on tire au sort pour tous
        if (isPlayer1) {
          let all = d1.concat(d2);
          shuffle(all);
          let choisis = [all[0], all[1]];
          let restant = all.filter((x, i) => i > 1);
          choisis.push(restant[Math.floor(Math.random() * restant.length)]);
          supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        }
        showAttente();
      } else {
        showAttente();
      }
    } else {
      // 1 seul premium : il écrit les 3 défis (il fait 2 champs puis 1 champ)
      if (premium && ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2))) {
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris 2 défis (tu auras un 3e champ après) :";
        document.getElementById("input-defi1").style.display = "";
        document.getElementById("input-defi2").style.display = "";
        document.getElementById("input-defi1").value = "";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if ((isPlayer1 && d1.length === 2) || (!isPlayer1 && d2.length === 2)) {
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris un 3e défi pour ce duel :";
        document.getElementById("input-defi1").style.display = "none";
        document.getElementById("input-defi2").placeholder = "Défi 3...";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if ((d1.length === 3 || d2.length === 3) && final.length < 3) {
        let choisis = isPlayer1 ? d1 : d2;
        supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        showAttente();
      } else {
        showAttente();
      }
    }
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  document.getElementById("btn-valider-defis").onclick = handleValiderDefis;
  majUI();
}
if (path.includes("duel_amis_premium.html")) mainPremiumDuelDefis();

// =============== GAME DUEL RANDOM (avec défis automatiques) ===============
export async function initDuelGame() {
  if (!(path.includes("duel_game.html") && roomId)) return;
  currentRoomId = roomId;
  window.currentRoomId = currentRoomId;
  const pseudo = await getCurrentUser();
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

  // --------- Sous-fonctions ---------
  function subscribeRoom(roomId, callback) {
    supabase
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
  }

  async function updateDuelUI() {
    if (!roomData) return;
    const pseudo = await getCurrentUser();

    let advID = isPlayer1 ? roomData.player2_pseudo : roomData.player1_pseudo;
    let myID = isPlayer1 ? roomData.player1_pseudo : roomData.player2_pseudo;
    let headerLabel = advID ? advID : "Adversaire";

    if ($("nom-adversaire")) $("nom-adversaire").textContent = headerLabel;
    if ($("pseudo-moi")) $("pseudo-moi").textContent = myID ? myID : "Moi";

    // Couleur personnalisée SEULEMENT
    if ($("pseudo-adv")) {
      if (advID) {
        const { data: advUser } = await supabase
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

    renderDefis({ myID, advID });
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

// ======= UTILS / HELPERS =======
function $(id) { return document.getElementById(id); }
async function getDefisDuelFromSupabase(count = 3) {
  let { data, error } = await supabase
    .from('defis')
    .select('intitule')
    .order('random()', { ascending: false })
    .limit(count);
  if (error || !data || data.length < count) {
    const backup = [
      "Un escargot ",
      "Photo d'un animal",
      "Photo d'une ombre"
    ];
    return backup.sort(() => 0.5 - Math.random()).slice(0, count);
  }
  return data.map(x => x.intitule);
}
async function getRoom(roomId) {
  const { data } = await supabase.from('duels').select('*').eq('id', roomId).single();
  return data;
}
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

    const advPhoto = advPhotoObj ? advPhotoObj.url : null;
    const advCadre = advPhotoObj && advPhotoObj.cadre ? advPhotoObj.cadre : "polaroid_01";

    if (advPhoto) {
      const cadreDiv = document.createElement("div");
      cadreDiv.className = "cadre-item cadre-duel-mini";
      const preview = document.createElement("div");
      preview.className = "cadre-preview";
      const cadreImg = document.createElement("img");
      cadreImg.className = "photo-cadre";
      cadreImg.src = getCadreUrl(advCadre);

      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = advPhoto;
      photoImg.onclick = () => agrandirPhoto(advPhoto, advCadre);

      preview.appendChild(cadreImg);
      preview.appendChild(photoImg);
      cadreDiv.appendChild(preview);

      const signalDiv = document.createElement("div");
      signalDiv.style.display = "flex";
      signalDiv.style.justifyContent = "center";
      signalDiv.style.marginTop = "8px";

      const signalBtn = document.createElement("button");
      signalBtn.className = "btn-signal-photo";
      signalBtn.title = "Signaler cette photo";
      signalBtn.style.background = "none";
      signalBtn.style.border = "none";
      signalBtn.style.cursor = "pointer";

      const signalImg = document.createElement("img");
      signalImg.src = "assets/icons/alert.svg";
      signalImg.alt = "Signaler";
      signalImg.style.width = "2.8em";

      signalBtn.appendChild(signalImg);
      signalBtn.dataset.idx = idxStr;
      signalBtn.onclick = function() {
        ouvrirPopupSignal(advPhoto, idxStr);
      };
      signalDiv.appendChild(signalBtn);

      colAdv.appendChild(cadreDiv);
      colAdv.appendChild(signalDiv);
    }

    row.appendChild(colJoueur);
    row.appendChild(colAdv);

    li.appendChild(row);
    ul.appendChild(li);
// ===========================
// FIN correction
// ===========================


// =================== POPUP FIN DE DUEL ===================
async function afficherPopupFinDuel(room) {
  const pseudo = await getCurrentUser();
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

  $("fin-faceaface").innerHTML = `
    <div class="fin-faceaface-row">
      <span><b>${myID || "Moi"}</b> (toi)</span>
      <span>vs</span>
      <span><b>${advID || "Adversaire"}</b></span>
    </div>
  `;
  $("fin-details").innerHTML = html;

  let nbFaits = Object.values(photosMy).filter(p => p && p.url).length;
  let gain = nbFaits * 10;
  if (nbFaits === nbDefis) gain += 10;

let gainFlag = "gain_duel_" + room.id + "_" + myID;
if (!localStorage.getItem(gainFlag)) {
  // 🔒 Gain sécurisé côté serveur via fonction Supabase
  const { error } = await supabase.rpc('secure_add_points', { nb: gain });
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

// ============ LOGIQUE FIN DE DUEL + POPUP ==============
async function checkFinDuel() {
  if (!roomData) return;
  // 1. Timer fini ?
  const start = roomData.starttime;
  const duration = 24 * 60 * 60 * 1000;
  if (start && (Date.now() > start + duration)) {
    await finirDuel();
    return;
  }
  // 2. Tous les défis faits des deux côtés
  const nbDefis = (roomData.defis || []).length;
  const okA = Object.values(roomData.photosa || {}).filter(x => x && x.url).length === nbDefis;
  const okB = Object.values(roomData.photosb || {}).filter(x => x && x.url).length === nbDefis;
  if (okA && okB) await finirDuel();
}
async function finirDuel() {
  if (roomData.status !== 'finished') {
    await supabase.from('duels').update({ status: 'finished' }).eq('id', roomData.id);
  }
  afficherPopupFinDuel(roomData);
}


// POPUP PUB/PREMIUM
function ouvrirPopupRepriseDuel(onPub) {
  const popup = document.getElementById("popup-reprise-photo-duel");
  popup.classList.remove("hidden");
  popup.classList.add("show");
  document.getElementById("btnReprisePremiumDuel").onclick = function() {
    // Lien premium, à adapter selon tes stores
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

export async function gererPrisePhotoDuel(idx, cadreId = null) {
  let duelId = currentRoomId || window.currentRoomId || roomId;
  if (!duelId) {
    alert("Erreur critique : identifiant duel introuvable.");
    return;
  }
  if (!cadreId) cadreId = getCadreDuel(duelId, idx);

  // Vérifie si une photo existe déjà (donc demande de reprise)
  const cacheKey = `${duelId}_${isPlayer1 ? 'photosa' : 'photosb'}_${idx}`;
  const dejaPhoto = await VFindDuelDB.get(cacheKey);

  const premium = await isPremium();
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

// -------- POPUP VALIDER AVEC JETON (à ajouter dans ton HTML aussi !) --------
window.ouvrirPopupValiderJeton = function(idx) {
  window._idxJetonToValidate = idx;
  document.getElementById("popup-jeton-valider").classList.remove("hidden");
};
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



// Changement de cadre après la photo (popup choix)
window.ouvrirPopupChoixCadre = async function(duelId, idx, champ) {
  let cadres = [];
  try {
    cadres = (await import('./userData.js')).getCadresPossedes
      ? await (await import('./userData.js')).getCadresPossedes()
      : ["polaroid_01"];
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
      const { data: room } = await supabase.from('duels').select('*').eq('id', duelId).single();
      let photos = (room && room[champ]) ? room[champ] : {};
      if (photos[idx] && typeof photos[idx] === "object") {
        photos[idx].cadre = cadre;
      } else if (typeof photos[idx] === "string") {
        photos[idx] = { url: photos[idx], cadre: cadre };
      }
      await supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);
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
export async function deleteDuelPhotosFromSupabase(roomId) {
  const { data: room, error } = await supabase.from('duels').select('*').eq('id', roomId).single();
  if (error || !room) return;
  const champs = ['photosa', 'photosb'];
  let filesToDelete = [];
  champs.forEach(champ => {
    const photos = room[champ] || {};
    Object.values(photos).forEach(photoObj => {
      if (photoObj && photoObj.url) {
        const parts = photoObj.url.split('/photosduel/');
        if (parts.length === 2) {
          filesToDelete.push("duel_photos/" + parts[1]);
        }
      }
    });
  });
  if (filesToDelete.length) {
    await supabase.storage.from('photosduel').remove(filesToDelete);
  }
}

async function getDefisDuelFromSupabase(count = 3) {
  let { data, error } = await supabase
    .from('defis')
.select('intitule')
.order('random()', { ascending: false })
.limit(count);


  if (error || !data || data.length < count) {
    const backup = [
      "Un escagot ",
      "Photo d'un animal",
      "Photo d'une ombre"
    ];
    return backup.sort(() => 0.5 - Math.random()).slice(0, count);
  }
  return data.map(x => x.intitule);

}

async function getRoom(roomId) {
  const { data } = await supabase.from('duels').select('*').eq('id', roomId).single();
  return data;
}

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

export async function savePhotoDuel(idx, url, cadreId = null) {
  const champ = isPlayer1 ? 'photosa' : 'photosb';
  if (!cadreId) cadreId = getCadreDuel(roomId, idx);
  const room = await getRoom(roomId);
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await supabase.from('duels').update({ [champ]: photos }).eq('id', roomId);
  await VFindDuelDB.set(`${roomId}_${champ}_${idx}`, { url, cadre: cadreId });
  setCadreDuel(roomId, idx, cadreId);
}

export function agrandirPhoto(url, cadre) {
  $("photo-affichee").src = url;
  $("cadre-affiche").src = `./assets/cadres/${cadre}.webp`;
  const popup = $("popup-photo");
  popup.classList.remove('hidden');
  popup.classList.add('show');
}

export async function cleanupDuelPhotos() {
  await VFindDuelDB.deleteAllForRoom(roomId);
}

// Fermer la popup (bouton croix, général)
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
window.fermerPopupSignal = function() {
  const popup = document.getElementById("popup-signal-photo");
  if (popup) {
    popup.classList.add("hidden");
    popup.classList.remove("show");
    popup.dataset.url = "";
    popup.dataset.idx = "";
  }
};

// =========== PATCH ULTRA IMPORTANT =============
// Appelle automatiquement l'init Duel sur la bonne page
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}

export async function afficherSolde() {
  const points = await getPoints();
  const jetons = await getJetons();
  const pointsSpan = document.getElementById('points');
  const jetonsSpan = document.getElementById('jetons');
  if (pointsSpan) pointsSpan.textContent = points ?? 0;
  if (jetonsSpan) jetonsSpan.textContent = jetons ?? 0;
}

document.addEventListener("DOMContentLoaded", () => {
  afficherSolde();
});
// Handler pour valider un défi AVEC jeton (DUEL)
document.addEventListener("DOMContentLoaded", () => {
  const btnValiderJeton = document.getElementById("valider-jeton-btn");
  if (btnValiderJeton) {
    btnValiderJeton.onclick = async function() {
      await validerDefiAvecJeton(window._idxJetonToValidate);
      window._idxJetonToValidate = null;
    };
  }
});

// Gestion du signalement photo vers Supabase Storage
document.body.addEventListener("click", async function(e) {
  // Ouverture de la popup (déjà fait plus haut)
  // ...

  // Gestion du clic sur un motif de signalement
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
    // Télécharge la photo en blob
    const response = await fetch(photoUrl);
    const blob = await response.blob();

    // Crée un nom unique pour le fichier signalé
    const fileName = `defi${idx}_${motif}_${Date.now()}.webp`;

    // Envoie la photo dans le bucket "signalements"
    const { data, error } = await supabase
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

// ========== INIT AUTO PAGE ==============
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}
if (window.location.pathname.includes("duel_amis_premium.html")) {
  mainPremiumDuelDefis();
}
document.addEventListener("DOMContentLoaded", afficherSolde);