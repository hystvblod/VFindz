// ========== PARAMS / GLOBALS ==========
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const path = window.location.pathname;
let currentRoomId = null;
let isPlayer1 = false;
let roomData = null;
let timerInterval = null;

// ========== IndexedDB cache ==========
const VFindDuelDB = {
  db: null,
  async init() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('VFindDuelPhotos', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('photos', { keyPath: 'key' });
      open.onsuccess = () => { VFindDuelDB.db = open.result; resolve(); };
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

// ========== Solde Points/Jetons ==========
window.afficherSolde = async function() {
  const points = await window.getPoints();
  const jetons = await window.getJetons();
  const pointsSpan = document.getElementById('points');
  const jetonsSpan = document.getElementById('jetons');
  if (pointsSpan) pointsSpan.textContent = points ?? 0;
  if (jetonsSpan) jetonsSpan.textContent = jetons ?? 0;
};
document.addEventListener("DOMContentLoaded", () => {
  window.afficherSolde && window.afficherSolde();
});

// ========= Fonctions coeurs locaux (photos aimées DUEL) =========
window.getPhotosAimeesDuel = function() {
  return JSON.parse(localStorage.getItem("photos_aimees_duel") || "[]");
};
window.aimerPhotoDuel = function(defiId) {
  let aimes = window.getPhotosAimeesDuel();
  if (!aimes.includes(defiId)) {
    aimes.push(defiId);
    localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
  }
};
window.retirerPhotoAimeeDuel = function(defiId) {
  let aimes = window.getPhotosAimeesDuel();
  aimes = aimes.filter(id => id !== defiId);
  localStorage.setItem("photos_aimees_duel", JSON.stringify(aimes));
};

// ========== Fonctions d'upload photo + update DB ==========
window.uploadPhotoDuelWebp = async function(dataUrl, duelId, idx, cadreId) {
  function dataURLtoBlob(dataurl) {
    var arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
      bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], {type:mime});
  }
  const userId = window.getUserId ? await window.getUserId() : (await window.getPseudo());
  const blob = dataURLtoBlob(dataUrl);
  const filePath = `duel_photos/${duelId}_${idx}_${userId}_${Date.now()}.webp`;

  // Upload photo dans le storage
  const { error: uploadError } = await window.supabase.storage
    .from('photosduel')
    .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) throw new Error("Erreur upload storage : " + uploadError.message);

  // Génère l’URL publique
  const { data: urlData } = window.supabase.storage.from('photosduel').getPublicUrl(filePath);
  const url = urlData.publicUrl;

  // Mets l’URL et le cadre dans la table duels
  const pseudo = await window.getPseudo();
  const { data: room } = await window.supabase.from('duels').select('*').eq('id', duelId).single();
  const champ = (room.player1_pseudo === pseudo) ? 'photosa' : 'photosb';
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await window.supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);

  // Mets l’URL+cadre dans le cache local
  await VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url, cadre: cadreId });

  // Mets le cadre en localStorage spécifique
  setCadreDuel(duelId, idx, cadreId);

  return url;
};
// ========== Matchmaking et création/rejoindre room ==========
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

window.findOrCreateRoom = async function() {
  if (await checkAlreadyInDuel()) return;
  localStorage.removeItem("duel_random_room");
  localStorage.removeItem("duel_is_player1");
  const pseudo = await window.getPseudo();

  for (let i = 0; i < 5; i++) {
    let { data: rooms } = await window.supabase
      .from('duels')
      .select('*')
      .eq('status', 'waiting')
      .neq('player1_pseudo', pseudo);

    if (rooms && rooms.length > 0) {
      const room = rooms[0];
      const player2_id = await window.getUserId();
      await window.supabase.from('duels').update({
        player2_id: player2_id,
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

  const player1Id = await window.getUserId();
  const player1Pseudo = await window.getPseudo();
  const defis = await getDefisDuelFromSupabase(3);

  const roomObj = {
    player1_id: player1Id,
    player2_id: null,
    player1_pseudo: player1Pseudo,
    player2_pseudo: null,
    score1: 0,
    score2: 0,
    status: 'waiting',
    createdat: Date.now(),
    defis: defis,
    starttime: null,
    photosa: {},
    photosb: {},
    type: 'random'
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

// Patch reprise de room en cours
if (path.includes("duel_random.html")) {
  const existingRoomId = localStorage.getItem("duel_random_room");
  if (existingRoomId) {
    window.supabase
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
          window.findOrCreateRoom();
        }
      });
  } else {
    window.findOrCreateRoom();
  }
}

// =================== HELPERS UTILS ===================
function $(id) { return document.getElementById(id); }

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

async function getRoom(roomId) {
  const { data } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
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

// =================== Suite à venir : rendering, UI, signalement, popups, tout le visuel ===================
// =============== RENDERING DEFI LIST + COLONNES UI DUEL =================
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

    // Titre défi au centre
    const cartouche = document.createElement('div');
    cartouche.className = 'defi-cartouche-center';
    cartouche.textContent = defi;
    li.appendChild(cartouche);

    const row = document.createElement('div');
    row.className = 'duel-defi-row';

    // ========== Colonne joueur ==========
    const colJoueur = document.createElement('div');
    colJoueur.className = 'joueur-col';

    const titreJoueur = document.createElement('div');
    titreJoueur.className = 'col-title';
    titreJoueur.textContent = myID ? myID : "Moi";
    colJoueur.appendChild(titreJoueur);
    setColTitlePremium(titreJoueur, myID);

    const myPhotoObj = await getPhotoDuel(roomId, myChamp, idxStr);
    const myPhoto = myPhotoObj ? myPhotoObj.url : null;
    const myCadre = myPhotoObj && myPhotoObj.cadre ? myPhotoObj.cadre : getCadreDuel(roomId, idxStr);

    if (myPhoto) {
      // Cadre visuel
      const cadreDiv = document.createElement("div");
      cadreDiv.className = "cadre-item cadre-duel-mini";
      const preview = document.createElement("div");
      preview.className = "cadre-preview";
      // SVG/Cadre
      const cadreImg = document.createElement("img");
      cadreImg.className = "photo-cadre";
      cadreImg.src = window.getCadreUrl ? window.getCadreUrl(myCadre) : `assets/cadres/${myCadre}.webp`;
      // Photo joueur
      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = myPhoto;
      photoImg.onclick = () => agrandirPhoto(myPhoto, myCadre);
      photoImg.oncontextmenu = (e) => { e.preventDefault(); ouvrirPopupChoixCadre(roomId, idxStr, myChamp); };
      photoImg.ontouchstart = function(e) {
        this._touchTimer = setTimeout(() => { ouvrirPopupChoixCadre(roomId, idxStr, myChamp); }, 500);
      };
      photoImg.ontouchend = function() { clearTimeout(this._touchTimer); };

      preview.appendChild(cadreImg);
      preview.appendChild(photoImg);

      // Cœur "aimer photo"
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

    // Bouton appareil photo SVG (prendre ou reprendre)
    const btnRow = document.createElement('div');
    btnRow.className = "duel-btnrow-joueur";
    btnRow.style.display = "flex";
    btnRow.style.justifyContent = "center";
    btnRow.style.marginTop = "10px";

    const btnPhoto = document.createElement('button');
    btnPhoto.className = "btn-photo";
    btnPhoto.title = myPhoto ? "Reprendre la photo" : "Prendre une photo";
    btnPhoto.style.background = "none";
    btnPhoto.style.border = "none";
    btnPhoto.style.padding = "0";
    btnPhoto.style.cursor = "pointer";
    btnPhoto.style.display = "flex";
    btnPhoto.style.alignItems = "center";

    // Appareil photo SVG/icon
    const imgPhoto = document.createElement('img');
    imgPhoto.src = "assets/icons/photo.svg";
    imgPhoto.alt = "Prendre une photo";
    imgPhoto.style.width = "2.8em";
    imgPhoto.style.display = "block";
    imgPhoto.style.margin = "0 auto";

    btnPhoto.appendChild(imgPhoto);

    btnPhoto.onclick = () => gererPrisePhotoDuel(idxStr, myCadre);
    btnPhoto.oncontextmenu = (e) => { e.preventDefault(); ouvrirPopupValiderJeton(idxStr); };
    btnPhoto.ontouchstart = function(e) {
      this._touchTimer = setTimeout(() => { ouvrirPopupValiderJeton(idxStr); }, 500);
    };
    btnPhoto.ontouchend = function() { clearTimeout(this._touchTimer); };

    btnRow.appendChild(btnPhoto);
    colJoueur.appendChild(btnRow);

    // ========== Colonne adversaire ==========
    const colAdv = document.createElement('div');
    colAdv.className = 'adversaire-col';
    const titreAdv = document.createElement('div');
    titreAdv.className = 'col-title';
    titreAdv.textContent = advID ? advID : "Adversaire";
    colAdv.appendChild(titreAdv);
    setColTitlePremium(titreAdv, advID);

    // Chargement photo adv (si existe)
    const advPhotoObj = await getPhotoDuel(roomId, advChamp, idxStr);
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
      cadreImg.src = window.getCadreUrl ? window.getCadreUrl(advCadre) : `assets/cadres/${advCadre}.webp`;

      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = advPhoto;
      photoImg.onclick = () => agrandirPhoto(advPhoto, advCadre);

      preview.appendChild(cadreImg);
      preview.appendChild(photoImg);
      cadreDiv.appendChild(preview);

      // Bouton signaler la photo
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
  }
}
// =================== PREMIUM DUEL AMIS ===================
// (Cette partie n’est utile que si tu as la page duel_amis_premium.html)
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
// Init auto
if (window.location.pathname.includes("duel_amis_premium.html")) {
  mainPremiumDuelDefis();
}

// =============== HANDLERS GÉNÉRAUX ===============
document.addEventListener("DOMContentLoaded", afficherSolde);
document.addEventListener("DOMContentLoaded", () => {
  // Ferme toutes les popups sur .close-btn ou #close-popup
  document.querySelectorAll('.close-btn, #close-popup').forEach(btn => {
    btn.onclick = function() {
      let popup = btn.closest('.popup');
      if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('show');
      }
    };
  });
  // Maj solde points/jetons sur page load
  afficherSolde();
});
// Ferme popup signalement
window.fermerPopupSignal = function() {
  const popup = document.getElementById("popup-signal-photo");
  if (popup) {
    popup.classList.add("hidden");
    popup.classList.remove("show");
    popup.dataset.url = "";
    popup.dataset.idx = "";
  }
};
// Ferme popup choix cadre
window.fermerPopupCadreChoix = function() {
  document.getElementById("popup-cadre-choix").classList.add("hidden");
};

// =============== INIT AUTO DUEL GAME ===============
if (window.location.pathname.includes("duel_game.html")) {
  initDuelGame();
}

// =============== UTILS ===============
function $(id) { return document.getElementById(id); }

