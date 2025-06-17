import { supabase, getJetons, getPoints, getPseudo as getCurrentUser, getUserId, getCadreSelectionne, ajouterDefiHistorique, addJetons, removeJeton, addPoints, removePoints, isPremium } from './userData.js';

// ========== IndexedDB cache ==========
async function setColTitlePremium(element, pseudo) {
  // Vérifie premium dans Supabase par pseudo
  if (!pseudo) { element.classList.remove('premium'); return; }
  const { data } = await supabase.from('users').select('premium').eq('pseudo', pseudo).single();
  if (data && data.premium) {
    element.classList.add('premium');
  } else {
    element.classList.remove('premium');
  }
}

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

// Cadre spécifique pour chaque photo (stocké en localStorage : duel_cadres_specifiques)
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

// ========= UPLOAD PRO : PHOTO → SUPABASE STORAGE + URL+CADRE DANS LA TABLE =========
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

  // Upload photo dans le storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('photosduel')
    .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) throw new Error("Erreur upload storage : " + uploadError.message);

  // Génère l’URL publique
  const { data: urlData } = supabase.storage.from('photosduel').getPublicUrl(filePath);
  const url = urlData.publicUrl;

  // Mets l’URL et le cadre dans la table duels
  const { data: room, error: roomError } = await supabase.from('duels').select('*').eq('id', duelId).single();
  if (roomError || !room) throw new Error("Room introuvable");
  const pseudo = await getCurrentUser();
  const champ = (room.player1 === pseudo) ? 'photosa' : 'photosb';
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);

  // Mets l’URL+cadre dans le cache local
  await VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url, cadre: cadreId });

  // Mets le cadre en localStorage spécifique
  setCadreDuel(duelId, idx, cadreId);

  return url;
}

// --------- Fonctions COEURS LOCAUX (photos aimées DUEL) ---------
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

// --------- Variables globales ---------
export let currentRoomId = null;
export let isPlayer1 = false;
export let roomData = null;
let timerInterval = null;

// --------- Utilitaires ---------
function $(id) { return document.getElementById(id); }

// --------- Matchmaking Duel ---------
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const path = window.location.pathname;

// PATCH : REPRISE DE PARTIE EN COURS SI EXISTE
if (path.includes("duel_random.html")) {
  const existingRoomId = localStorage.getItem("duel_random_room");
  if (existingRoomId) {
    supabase
      .from('duels')
      .select('id, status')
      .eq('id', existingRoomId)
      .single()
      .then(({ data }) => {
        if (data && data.status && data.status !== 'finished') {
          setTimeout(() => {
            window.location.href = `duel_game.html?room=${existingRoomId}`;
          }, 200);
        } else {
          localStorage.removeItem("duel_random_room");
          localStorage.removeItem("duel_is_player1");
          findOrCreateRoom();
        }
      });
  } else {
    findOrCreateRoom();
  }
}

// DUEL RANDOM MATCHMAKING PATCH
export async function findOrCreateRoom() {
  localStorage.removeItem("duel_random_room");
  localStorage.removeItem("duel_is_player1");
  const pseudo = await getCurrentUser();

  for (let i = 0; i < 5; i++) {
    let { data: rooms } = await supabase
      .from('duels')
      .select('*')
      .eq('status', 'waiting')
      .neq('player1', pseudo);

    if (rooms && rooms.length > 0) {
      const room = rooms[0];
      await supabase.from('duels').update({
        player2: pseudo,
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

  const defis = await getDefisDuelFromSupabase(3);
  const roomObj = {
    player1: pseudo,
    player2: null,
    score1: 0,
    score2: 0,
    status: 'waiting',
    createdat: Date.now(),
    defis: defis,
    starttime: null,
    photosa: {},
    photosb: {}
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

// =============== GAME DUEL INITIALISATION (APPELER DEPUIS LA PAGE) ==============
export async function initDuelGame() {
  if (!(path.includes("duel_game.html") && roomId)) return;
  currentRoomId = roomId;
  window.currentRoomId = currentRoomId;

  const pseudo = await getCurrentUser();
  const room = await getRoom(roomId);
  isPlayer1 = (room.player1 === pseudo);

  subscribeRoom(roomId, (data) => {
    roomData = data;
    updateDuelUI();
    checkFinDuel();
  });
  roomData = await getRoom(roomId);
  updateDuelUI();
  await checkFinDuel();

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

    let advID = isPlayer1 ? roomData.player2 : roomData.player1;
    let myID = isPlayer1 ? roomData.player1 : roomData.player2;
    let headerLabel = advID ? advID : "Adversaire";

    if ($("nom-adversaire")) $("nom-adversaire").textContent = headerLabel;
    if ($("pseudo-moi")) $("pseudo-moi").textContent = myID ? myID : "Moi";
    if ($("pseudo-adv")) $("pseudo-adv").textContent = advID ? advID : "Adversaire";
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

// ===========================
// !!!!! CORRECTION RENDU ICI
// ===========================
// Fonction pour ouvrir la popup de signalement
function ouvrirPopupSignal(photoUrl, idxStr) {
  const popup = document.getElementById("popup-signal-photo");
  if (!popup) {
    alert("Erreur : popup de signalement introuvable !");
    return;
  }
  popup.dataset.url = photoUrl;
  popup.dataset.idx = idxStr;
  popup.classList.remove("hidden");
  popup.classList.add("show");
}
window.ouvrirPopupSignal = ouvrirPopupSignal; // optionnel, mais utile pour accès global

async function renderDefis({ myID, advID }) {
  const ul = $("duel-defi-list");
  if (!ul || !roomData || !roomData.defis || roomData.defis.length === 0) {
    if (ul) ul.innerHTML = `<li>Aucun défi.</li>`;
    return;
  }

  const myChamp = isPlayer1 ? 'photosa' : 'photosb';
  const advChamp = isPlayer1 ? 'photosb' : 'photosa';
  const photosAimees = getPhotosAimeesDuel();

  ul.innerHTML = '';
  for (let idx = 0; idx < roomData.defis.length; idx++) {
    const defi = roomData.defis[idx];
    const idxStr = String(idx);
    const li = document.createElement('li');
    li.className = 'defi-item';

    // Cartouche défi
    const cartouche = document.createElement('div');
    cartouche.className = 'defi-cartouche-center';
    cartouche.textContent = defi;
    li.appendChild(cartouche);

    // Ligne deux colonnes
    const row = document.createElement('div');
    row.className = 'duel-defi-row';

    // --- Colonne Joueur (gauche) ---
    const colJoueur = document.createElement('div');
    colJoueur.className = 'joueur-col';

    const titreJoueur = document.createElement('div');
    titreJoueur.className = 'col-title';
    titreJoueur.textContent = myID ? myID : "Moi";
    colJoueur.appendChild(titreJoueur);
    setColTitlePremium(titreJoueur, myID);

    // Photo joueur (cache optimisé)
    const myPhotoObj = await getPhotoDuel(roomId, myChamp, idxStr);
    const myPhoto = myPhotoObj ? myPhotoObj.url : null;
    const myCadre = myPhotoObj && myPhotoObj.cadre ? myPhotoObj.cadre : getCadreDuel(roomId, idxStr);

    if (myPhoto) {
      const cadreDiv = document.createElement("div");
      cadreDiv.className = "cadre-item cadre-duel-mini";
      const preview = document.createElement("div");
      preview.className = "cadre-preview";
      const cadreImg = document.createElement("img");
      cadreImg.className = "photo-cadre";
      cadreImg.src = "./assets/cadres/" + myCadre + ".webp";
      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = myPhoto;
      photoImg.onclick = () => agrandirPhoto(myPhoto, myCadre);
      // --- Appui long/chgt cadre ---
      photoImg.oncontextmenu = (e) => { e.preventDefault(); ouvrirPopupChoixCadre(roomId, idxStr, myChamp); };
      photoImg.ontouchstart = function(e) {
        this._touchTimer = setTimeout(() => { ouvrirPopupChoixCadre(roomId, idxStr, myChamp); }, 500);
      };
      photoImg.ontouchend = function() { clearTimeout(this._touchTimer); };

      preview.appendChild(cadreImg);
      preview.appendChild(photoImg);

      // --- Bouton coeur pour aimer la photo ---
      const coeurBtn = document.createElement("img");
      coeurBtn.src = photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`) ? "assets/icons/coeur_plein.svg" : "assets/icons/coeur.svg";
      coeurBtn.alt = "Aimer";
      coeurBtn.style.width = "2em";
      coeurBtn.style.cursor = "pointer";
      coeurBtn.style.marginLeft = "0.6em";
      coeurBtn.title = photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`) ? "Retirer des photos aimées" : "Ajouter aux photos aimées";
      coeurBtn.onclick = () => {
        if (photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`)) {
          retirerPhotoAimeeDuel(`${roomId}_${myChamp}_${idxStr}`);
        } else {
          aimerPhotoDuel(`${roomId}_${myChamp}_${idxStr}`);
        }
        renderDefis({ myID, advID });
      };
      preview.appendChild(coeurBtn);
      cadreDiv.appendChild(preview);
      colJoueur.appendChild(cadreDiv);
    }

    // ========== BOUTON PHOTO UNIQUEMENT ==========
const btnRow = document.createElement('div');
btnRow.className = "duel-btnrow-joueur";
btnRow.style.display = "flex";
btnRow.style.justifyContent = "center";
btnRow.style.marginTop = "10px";

// --- PHOTO (dans un <button>)
const btnPhoto = document.createElement('button');
btnPhoto.className = "btn-photo";
btnPhoto.title = myPhoto ? "Reprendre la photo" : "Prendre une photo";
btnPhoto.style.background = "none";
btnPhoto.style.border = "none";
btnPhoto.style.padding = "0";
btnPhoto.style.cursor = "pointer";
btnPhoto.style.display = "flex";
btnPhoto.style.alignItems = "center";

// Image de l'appareil photo dans le bouton
const imgPhoto = document.createElement('img');
imgPhoto.src = "assets/icons/photo.svg";
imgPhoto.alt = "Prendre une photo";
imgPhoto.style.width = "2.8em";
imgPhoto.style.display = "block";
imgPhoto.style.margin = "0 auto";

btnPhoto.appendChild(imgPhoto);

btnPhoto.onclick = () => gererPrisePhotoDuel(idxStr, myCadre);
// Appui long/clic droit → popup jeton
btnPhoto.oncontextmenu = (e) => { e.preventDefault(); ouvrirPopupValiderJeton(idxStr); };
btnPhoto.ontouchstart = function(e) {
  this._touchTimer = setTimeout(() => { ouvrirPopupValiderJeton(idxStr); }, 500);
};
btnPhoto.ontouchend = function() { clearTimeout(this._touchTimer); };

btnRow.appendChild(btnPhoto);

colJoueur.appendChild(btnRow);


    // --- Colonne Adversaire (droite) ---
    const colAdv = document.createElement('div');
    colAdv.className = 'adversaire-col';
    const titreAdv = document.createElement('div');
    titreAdv.className = 'col-title';
    titreAdv.textContent = advID ? advID : "Adversaire";
    colAdv.appendChild(titreAdv);
    setColTitlePremium(titreAdv, advID);

    // Photo adversaire (cache optimisé)
    const advPhotoObj = await getPhotoDuel(roomId, advChamp, idxStr);
    // On force la mise à jour du cache si cadre changé côté serveur
    if (roomData && roomData[advChamp] && roomData[advChamp][idxStr]) {
      let obj = roomData[advChamp][idxStr];
      let url, cadre;
      if (typeof obj === "object") {
        url = obj.url;
        cadre = obj.cadre;
      } else {
        url = obj;
        cadre = "polaroid_01";
      }
      // On rafraîchit l'entrée cache même si déjà présente
      await VFindDuelDB.set(`${roomId}_${advChamp}_${idxStr}`, { url, cadre });
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
  cadreImg.src = "./assets/cadres/" + advCadre + ".webp";

  const photoImg = document.createElement("img");
  photoImg.className = "photo-user";
  photoImg.src = advPhoto;
  photoImg.onclick = () => agrandirPhoto(advPhoto, advCadre);

  preview.appendChild(cadreImg);
  preview.appendChild(photoImg);
  cadreDiv.appendChild(preview);

  // --- BOUTON SIGNALER SOUS LA PHOTO ---
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

  colAdv.appendChild(cadreDiv);    // ✅ cadre seul
  colAdv.appendChild(signalDiv);   // ✅ bouton en-dessous

}

    row.appendChild(colJoueur);
    row.appendChild(colAdv);

    li.appendChild(row);
    ul.appendChild(li);
  }
}
// ===========================
// FIN correction
// ===========================

}

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
    await addPoints(gain);
    localStorage.setItem(gainFlag, "1");
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

// HANDLER : Quand tu retires un jeton (ex : valider défi)
export async function validerDefiAvecJeton(idx) {
  await removeJeton();
  await afficherSolde();
}

// HANDLER : Ajoute un jeton (récompense/pub)
export async function gagnerJeton() {
  await addJetons(1);
  await afficherSolde();
}
export async function retirerPoints(montant) {
  await removePoints(montant);
  await afficherSolde();
}
export async function gagnerPoints(montant) {
  await addPoints(montant);
  await afficherSolde();
}

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
    .order('random()')
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
