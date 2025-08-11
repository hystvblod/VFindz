// ====== DEPENDANCES GLOBALES SUPABASE & UTILS ======
// On suppose que supabase est sur window.supabase, et toutes les fonctions userData sont sur window aussi (voir userData.js).
// Pour showAd, assure-toi que window.showAd est bien défini dans pub.js !

window.setColTitlePremium = async function(element, pseudo) {
  if (!pseudo) { element.classList.remove('premium'); return; }
  const { data } = await window.supabase.from('users').select('premium').eq('pseudo', pseudo).single();
  if (data && data.premium) {
    element.classList.add('premium');
  } else {
    element.classList.remove('premium');
  }
};

window.VFindDuelDB = {
  db: null,
  async init() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('VFindDuelPhotos', 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('photos', { keyPath: 'key' });
      };
      open.onsuccess = () => {
        window.VFindDuelDB.db = open.result;
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

window.getCadreDuel = function(duelId, idx) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (data[duelId] && data[duelId][idx]) return data[duelId][idx];
  return window.getCadreSelectionneCached ? window.getCadreSelectionneCached() : "polaroid_01";
};
window.setCadreDuel = function(duelId, idx, cadreId) {
  const data = JSON.parse(localStorage.getItem("duel_cadres_specifiques") || "{}");
  if (!data[duelId]) data[duelId] = {};
  data[duelId][idx] = cadreId;
  localStorage.setItem("duel_cadres_specifiques", JSON.stringify(data));
};

window.uploadPhotoDuelWebp = async function(dataUrl, duelId, idx, cadreId) {
  function dataURLtoBlob(dataurl) {
    if (!dataurl || typeof dataurl !== "string" || !dataurl.includes(",")) {
      const canvas = document.createElement("canvas");
      canvas.width = 32; canvas.height = 32;
      canvas.getContext("2d").fillStyle = "#fff";
      canvas.getContext("2d").fillRect(0,0,32,32);
      return new Promise(res => canvas.toBlob(b=>res(b),"image/webp"));
    }
    var arr = dataurl.split(','), match = arr[0].match(/:(.*?);/);
    var mime = match && match[1] ? match[1] : "image/webp";
    var bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--) u8arr[n] = bstr.charCodeAt(n);
    return new Blob([u8arr], {type:mime});
  }

  const userId = window.getUserId ? window.getUserId() : (await window.getPseudo());
  const blob = await dataURLtoBlob(dataUrl);

  const filePath = `duel_photos/${duelId}_${idx}_${userId}_${Date.now()}.webp`;

  const { error: uploadError } = await window.supabase.storage
    .from('photosduel')
    .upload(filePath, blob, { upsert: true, contentType: "image/webp" });
  if (uploadError) throw new Error("Erreur upload storage : " + uploadError.message);

  const { data: urlData } = window.supabase.storage.from('photosduel').getPublicUrl(filePath);
  const url = urlData.publicUrl;

  const { data: room, error: roomError } = await window.supabase.from('duels').select('*').eq('id', duelId).single();

  if (roomError) {
    console.error("❌ Erreur lecture room :", roomError);
  }
  if (!room) {
    console.error("❌ Room null !");
    throw new Error("Room introuvable");
  }
  const champ = (room.player1_id === userId) ? 'photosa' : 'photosb';
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await window.supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);

  await window.VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url, cadre: cadreId });
  window.setCadreDuel(duelId, idx, cadreId);

  return url;
};

// Fonctions photos aimées solo (inchangé, peu importe le mode)
function aimerPhoto(defiId) {
  let obj = {};
  try { obj = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`) || "{}"); } catch {}
  if (!obj.photo) return alert("Photo introuvable pour ce défi.");
  let photosAimees = [];
  try { photosAimees = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]"); } catch {}
  if (photosAimees.some(x => x.defiId === defiId)) return;
  photosAimees.push({
    defiId,
    imageDataUrl: obj.photo,
    cadre: obj.cadre || "polaroid_01",
    date: Date.now()
  });
  localStorage.setItem("photos_aimees_obj", JSON.stringify(photosAimees));
  console.log("[SOLO] Photo aimée sauvegardée offline (img + cadre) :", defiId);
}
function retirerPhotoAimee(defiId) {
  let photosAimees = [];
  try { photosAimees = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]"); } catch {}
  photosAimees = photosAimees.filter(obj => obj.defiId !== defiId);
  localStorage.setItem("photos_aimees_obj", JSON.stringify(photosAimees));
  console.log("[SOLO] Photo aimée retirée :", defiId);
}
window.aimerPhoto = aimerPhoto;
window.retirerPhotoAimee = retirerPhotoAimee;

// --------- Variables globales ---------
window.currentRoomId = null;
window.isPlayer1 = false;
window.roomData = null;
let timerInterval = null;

window.$ = function(id) { return document.getElementById(id); };
const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");
const path = window.location.pathname;

// ==================== PATCH ANTI-MULTI =====================
window.checkAlreadyInDuel = async function() {
  const userId = window.getUserId();
  const { data: duelsEnCours, error } = await window.supabase
    .from('duels')
    .select('id, status, player1_id, player2_id')
    .in('status', ['waiting', 'playing'])
    .or(`player1_id.eq.${userId},player2_id.eq.${userId}`);

  if (error) {
    console.error("[Duel] Erreur requête checkAlreadyInDuel :", error);
    return false;
  }
  let room = duelsEnCours.find(d =>
    (d.player1_id === userId || d.player2_id === userId) && d.status === "playing"
  );
  if (room) {
    localStorage.setItem("duel_random_room", room.id);
    const isP1 = (room.player1_id === userId);
    localStorage.setItem("duel_is_player1", isP1 ? "1" : "0");
    setTimeout(() => {
      window.location.href = `duel_game.html?room=${room.id}`;
    }, 200);
    return true;
  }
  room = duelsEnCours.find(d =>
    d.player1_id === userId && d.status === "waiting"
  );
  if (room) {
    localStorage.setItem("duel_random_room", room.id);
    localStorage.setItem("duel_is_player1", "1");
    setTimeout(() => {
      window.location.href = `duel_game.html?room=${room.id}`;
    }, 200);
    return true;
  }
  room = duelsEnCours.find(d =>
    d.player2_id === userId && d.status === "waiting"
  );
  if (room) {
    localStorage.setItem("duel_random_room", room.id);
    localStorage.setItem("duel_is_player1", "0");
    setTimeout(() => {
      window.location.href = `duel_game.html?room=${room.id}`;
    }, 200);
    return true;
  }
  return false;
};
// ================= FIN PATCH ANTI-MULTI ===================

window._allDefis = null;
window._langDefi = (navigator.language || 'fr').slice(0,2);

window.chargerDefisLocal = async function() {
  if (window._allDefis) return window._allDefis;
  const rep = await fetch('data/defis.json');
  const json = await rep.json();
  window._allDefis = json.defis;
  return window._allDefis;
};
window.getDefisLocal = async function(n = 3, forceLang = null) {
  const defis = await window.chargerDefisLocal();
  const lang = forceLang || window._langDefi || 'fr';
  const shuffled = defis.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n).map(d => d[lang] || d["fr"] || Object.values(d)[1]);
};
window.findOrCreateRoom = async function() {
  if (await window.checkAlreadyInDuel()) return;
  localStorage.removeItem("duel_random_room");
  localStorage.removeItem("duel_is_player1");
  const userId = window.getUserId();
  const userPseudo = await window.getPseudo();

  for (let i = 0; i < 5; i++) {
    let { data: rooms } = await window.supabase
      .from('duels')
      .select('*')
      .eq('status', 'waiting')
      .neq('player1_id', userId)
      .order('createdat', { ascending: true })
      .limit(1);

    if (rooms && rooms.length > 0) {
      const room = rooms[0];
      const { data: updated, error: updError } = await window.supabase.from('duels').update({
        player2_id: userId,
        player2_pseudo: userPseudo,
        status: 'playing',
        starttime: Date.now()
      })
        .eq('id', room.id)
        .eq('status', 'waiting')
        .select();
      if (updError || !updated || updated.length === 0) continue;
      localStorage.setItem("duel_random_room", room.id);
      localStorage.setItem("duel_is_player1", "0");
      setTimeout(() => {
        window.location.href = `duel_game.html?room=${room.id}`;
      }, 200);
      return;
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  if (await window.checkAlreadyInDuel()) return;
  const defis = await window.getDefisDuelFromSupabase(3);
  const roomObj = {
    player1_id: userId,
    player2_id: null,
    player1_pseudo: userPseudo,
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
};
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

// =================== INIT GAME AVEC PREMIUM ===================
window.initDuelGame = async function() {
  if (!(path.includes("duel_game.html") && roomId)) return;
  window.currentRoomId = roomId;
  const pseudo = await window.getPseudo();
  const userId = window.getUserId();
  let room = await window.getRoom(roomId);
  window.isPlayer1 = (room.player1_id === userId);

  // PREMIUM - SI AMIS PREMIUM, DEFI FINAL À SAISIR AVANT DE JOUER
  if (room.type === "amis_premium" && !room.defis_final) {
    await window.gestionDefisPremium(room, pseudo, userId);
    room = await window.getRoom(roomId);
  }

  subscribeRoom(roomId, (data) => {
    window.roomData = data;
    updateDuelUI();
    checkFinDuel();
  });
  window.roomData = await window.getRoom(roomId);
  updateDuelUI();
  await checkFinDuel();

  function subscribeRoom(roomId, callback) {
    window.supabase
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
    if (!window.roomData) return;
    const pseudo = await window.getPseudo();

    let advID = window.isPlayer1 ? window.roomData.player2_pseudo : window.roomData.player1_pseudo;
    let myID = window.isPlayer1 ? window.roomData.player1_pseudo : window.roomData.player2_pseudo;
    let headerLabel = advID ? advID : "Adversaire";
    if ($("nom-adversaire")) $("nom-adversaire").textContent = headerLabel;
    if ($("pseudo-moi")) $("pseudo-moi").textContent = myID ? myID : "Moi";
    if ($("pseudo-adv")) $("pseudo-adv").textContent = advID ? advID : "Adversaire";
    if (window.roomData.starttime && $("timer")) startGlobalTimer(window.roomData.starttime);
    else if ($("timer")) $("timer").textContent = "--:--:--";
    // PREMIUM - forçage defis sur defis_final
    if (window.roomData.type === "amis_premium" && window.roomData.defis_final) {
      window.roomData.defis = window.roomData.defis_final;
    }
    window.renderDefis({ myID, advID });
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
};

// =================== BLOCS PREMIUM - Défis personnalisés ===================
window.gestionDefisPremium = async function(room, pseudo, userId) {
  let { data: p1 } = await window.supabase.from("users").select("premium").eq("id", room.player1_id).single();
  let { data: p2 } = await window.supabase.from("users").select("premium").eq("id", room.player2_id).single();
  let isP1Premium = p1 && p1.premium;
  let isP2Premium = p2 && p2.premium;
  let isPlayer1 = (room.player1_id === userId);
  let role = "";
  if ((isP1Premium && !isP2Premium) || (!isP1Premium && isP2Premium)) {
    if ((isP1Premium && isPlayer1) || (isP2Premium && !isPlayer1)) role = "full";
  } else if (isP1Premium && isP2Premium) {
    if (isPlayer1) role = "1_3";
    else role = "2_3";
  }
  await new Promise((resolve) => {
    if (!document.getElementById("popup-premium-defis")) {
      let popup = document.createElement("div");
      popup.id = "popup-premium-defis";
      popup.className = "popup premium-popup";
      popup.innerHTML = `
        <div class="popup-content" style="background:#252739;border-radius:16px;padding:2.2em 1.2em 1.7em 1.2em;max-width:370px;margin:7vh auto;box-shadow:0 8px 32px #0007;">
          <h2 style="font-size:1.35em;margin-bottom:1.5em;color:#ffe04a;text-align:center;">Saisis tes défis</h2>
          <form id="form-defis-premium" autocomplete="off">
            <div id="fields-premium-defis"></div>
            <button type="submit" class="btn-primary" style="margin-top:1.7em;width:100%;">Valider</button>
          </form>
        </div>
      `;
      document.body.appendChild(popup);
      popup.style.position = "fixed";
      popup.style.top = "0"; popup.style.left = "0";
      popup.style.width = "100vw";
      popup.style.height = "100vh";
      popup.style.background = "rgba(12,14,22,0.83)";
      popup.style.zIndex = "99999";
      popup.style.display = "none";
    }
    let htmlFields = "";
    if (role === "full") {
      htmlFields += `<label>Défi 1<br><input type="text" name="defi1" required placeholder="Défi 1" class="champ-premium-defi"></label><br>`;
      htmlFields += `<label>Défi 2<br><input type="text" name="defi2" required placeholder="Défi 2" class="champ-premium-defi"></label><br>`;
      htmlFields += `<label>Défi 3<br><input type="text" name="defi3" required placeholder="Défi 3" class="champ-premium-defi"></label>`;
    } else if (role === "1_3") {
      htmlFields += `<label>Défi 1 (tu le choisis)<br><input type="text" name="defi1" required placeholder="Défi 1" class="champ-premium-defi"></label><br>`;
      htmlFields += `<label>Défi 3 (propose-le, peut-être choisi)<br><input type="text" name="defi3" required placeholder="Défi 3" class="champ-premium-defi"></label>`;
    } else if (role === "2_3") {
      htmlFields += `<label>Défi 2 (tu le choisis)<br><input type="text" name="defi2" required placeholder="Défi 2" class="champ-premium-defi"></label><br>`;
      htmlFields += `<label>Défi 3 (propose-le, peut-être choisi)<br><input type="text" name="defi3" required placeholder="Défi 3" class="champ-premium-defi"></label>`;
    } else {
      htmlFields = `<div style="text-align:center;margin-top:2em;color:#ffe04a;">En attente que l’adversaire saisisse les défis…</div>`;
    }
    document.getElementById("fields-premium-defis").innerHTML = htmlFields;
    document.getElementById("popup-premium-defis").style.display = "block";
    document.getElementById("form-defis-premium").onsubmit = async function(e) {
      e.preventDefault();
      let d1 = this.defi1 ? this.defi1.value.trim() : "";
      let d2 = this.defi2 ? this.defi2.value.trim() : "";
      let d3 = this.defi3 ? this.defi3.value.trim() : "";
      let dataToSave = {};
      if (role === "full") {
        dataToSave = { defis_final: [d1, d2, d3] };
      }
      else if (role === "1_3") {
        await window.supabase.from("duels").update({
          defis1: d1,
          defis3a: d3
        }).eq("id", room.id);
        dataToSave = null;
      }
      else if (role === "2_3") {
        await window.supabase.from("duels").update({
          defis2: d2,
          defis3b: d3
        }).eq("id", room.id);
        dataToSave = null;
      }
      document.getElementById("popup-premium-defis").style.display = "none";
      if (role === "1_3" || role === "2_3") {
        let checkDefis = async () => {
          let checkRoom = await window.getRoom(room.id);
          if (checkRoom.defis1 && checkRoom.defis2 && checkRoom.defis3a && checkRoom.defis3b) {
            let choix = Math.random() < 0.5 ? checkRoom.defis3a : checkRoom.defis3b;
            let defisFinal = [checkRoom.defis1, checkRoom.defis2, choix];
            await window.supabase.from("duels").update({
              defis_final: defisFinal
            }).eq("id", room.id);
            resolve();
          } else {
            setTimeout(checkDefis, 850);
          }
        };
        checkDefis();
        return;
      }
      if (dataToSave) {
        await window.supabase.from("duels").update(dataToSave).eq("id", room.id);
        resolve();
      }
    };
  });
};
// =================== FIN BLOCS PREMIUM ===================


// Fonction pour ouvrir la popup de signalement
window.ouvrirPopupSignal = function(photoUrl, idxStr) {
  const popup = document.getElementById("popup-signal-photo");
  if (!popup) {
    alert("Erreur : popup de signalement introuvable !");
    return;
  }
  popup.dataset.url = photoUrl;
  popup.dataset.idx = idxStr;
  popup.classList.remove("hidden");
  popup.classList.add("show");
};

window.renderDefis = async function({ myID, advID }) {
  const ul = $("duel-defi-list");
  if (!ul || !window.roomData || !window.roomData.defis || window.roomData.defis.length === 0) {
    if (ul) ul.innerHTML = `<li>Aucun défi.</li>`;
    return;
  }

  const myChamp = window.isPlayer1 ? 'photosa' : 'photosb';
  const advChamp = window.isPlayer1 ? 'photosb' : 'photosa';
  const photosAimees = window.getPhotosAimeesDuel();

  ul.innerHTML = '';
  for (let idx = 0; idx < window.roomData.defis.length; idx++) {
    const defi = window.roomData.defis[idx];
    const idxStr = String(idx);
    const li = document.createElement('li');
    li.className = 'defi-item';

    const cartouche = document.createElement('div');
    cartouche.className = 'defi-cartouche-center';
    cartouche.textContent = defi;
    li.appendChild(cartouche);

    const row = document.createElement('div');
    row.className = 'duel-defi-row';

    // ----------- COL JOUEUR ------------
    const colJoueur = document.createElement('div');
    colJoueur.className = 'joueur-col';

    const titreJoueur = document.createElement('div');
    titreJoueur.className = 'col-title';
    titreJoueur.textContent = myID ? myID : "Moi";
    colJoueur.appendChild(titreJoueur);
    window.setColTitlePremium(titreJoueur, myID);

    const myPhotoObj = await window.getPhotoDuel(roomId, myChamp, idxStr);
    const myPhoto = myPhotoObj ? myPhotoObj.url : null;
    const myCadre = myPhotoObj && myPhotoObj.cadre ? myPhotoObj.cadre : window.getCadreDuel(roomId, idxStr);

    if (myPhoto) {
      const cadreDiv = document.createElement("div");
      cadreDiv.className = "cadre-item cadre-duel-mini";
      const preview = document.createElement("div");
      preview.className = "cadre-preview";
      const cadreImg = document.createElement("img");
      cadreImg.className = "photo-cadre";
      const cadreImgUrl = await window.getCadreUrl(myCadre);
      cadreImg.src = cadreImgUrl; // ✅ await

      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = myPhoto;
      photoImg.onclick = () => window.agrandirPhoto(myPhoto, myCadre);
      photoImg.oncontextmenu = (e) => { e.preventDefault(); window.ouvrirPopupChoixCadre(roomId, idxStr, myChamp); };
      photoImg.ontouchstart = function() {
        this._touchTimer = setTimeout(() => { window.ouvrirPopupChoixCadre(roomId, idxStr, myChamp); }, 500);
      };
      photoImg.ontouchend = function() { clearTimeout(this._touchTimer); };

      preview.appendChild(cadreImg);
      preview.appendChild(photoImg);

      const coeurBtn = document.createElement("img");
      coeurBtn.src = photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`) ? "assets/icons/coeur_rouge.svg" : "assets/icons/coeur.svg";
      coeurBtn.alt = "Aimer";
      coeurBtn.style.width = "2em";
      coeurBtn.style.cursor = "pointer";
      coeurBtn.style.marginLeft = "0.6em";
      coeurBtn.title = photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`) ? "Retirer des photos aimées" : "Ajouter aux photos aimées";
      coeurBtn.onclick = () => {
        if (photosAimees.includes(`${roomId}_${myChamp}_${idxStr}`)) {
          window.retirerPhotoAimeeDuel(`${roomId}_${myChamp}_${idxStr}`);
        } else {
          window.aimerPhotoDuel(`${roomId}_${myChamp}_${idxStr}`);
        }
        window.renderDefis({ myID, advID });
      };
      preview.appendChild(coeurBtn);
      cadreDiv.appendChild(preview);
      colJoueur.appendChild(cadreDiv);
    }

    // bouton prendre/valider photo
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

    const imgPhoto = document.createElement('img');
    imgPhoto.src = "assets/icons/photo.svg";
    imgPhoto.alt = "Prendre une photo";
    imgPhoto.style.width = "2.8em";
    imgPhoto.style.display = "block";
    imgPhoto.style.margin = "0 auto";

    btnPhoto.appendChild(imgPhoto);

    btnPhoto.onclick = () => window.gererPrisePhotoDuel(idxStr, myCadre);
    btnPhoto.oncontextmenu = (e) => { e.preventDefault(); window.ouvrirPopupValiderJeton(idxStr); };
    btnPhoto.ontouchstart = function() {
      this._touchTimer = setTimeout(() => { window.ouvrirPopupValiderJeton(idxStr); }, 500);
    };
    btnPhoto.ontouchend = function() { clearTimeout(this._touchTimer); };

    btnRow.appendChild(btnPhoto);
    colJoueur.appendChild(btnRow);

    // ----------- COL ADVERSAIRE ------------
    const colAdv = document.createElement('div');
    colAdv.className = 'adversaire-col';
    const titreAdv = document.createElement('div');
    titreAdv.className = 'col-title';
    titreAdv.textContent = advID ? advID : "Adversaire";
    colAdv.appendChild(titreAdv);
    window.setColTitlePremium(titreAdv, advID);

    const advPhotoObj = await window.getPhotoDuel(roomId, advChamp, idxStr);
    if (window.roomData && window.roomData[advChamp] && window.roomData[advChamp][idxStr]) {
      let obj = window.roomData[advChamp][idxStr];
      let url, cadre;
      if (typeof obj === "object") {
        url = obj.url;
        cadre = obj.cadre;
      } else {
        url = obj;
        cadre = "polaroid_01";
      }
      await window.VFindDuelDB.set(`${roomId}_${advChamp}_${idxStr}`, { url, cadre });
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
      const advCadreUrl = await window.getCadreUrl(advCadre);
      cadreImg.src = advCadreUrl; // ✅ await

      const photoImg = document.createElement("img");
      photoImg.className = "photo-user";
      photoImg.src = advPhoto;
      photoImg.onclick = () => window.agrandirPhoto(advPhoto, advCadre);

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
        window.ouvrirPopupSignal(advPhoto, idxStr);
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
};

// ===========================
// FIN correction
// ===========================


// =================== POPUP FIN DE DUEL ===================
window.afficherPopupFinDuel = async function(room) {
  const pseudo = await window.getPseudo();
  const userId = window.getUserId(); // correction sécurisée
  const isP1 = room.player1_id === userId;
  const myChamp = isP1 ? 'photosa' : 'photosb';
  const advChamp = isP1 ? 'photosb' : 'photosa';
  const myPseudo = isP1 ? room.player1_pseudo : room.player2_pseudo;
  const advPseudo = isP1 ? room.player2_pseudo : room.player1_pseudo;

  const nbDefis = (room.defis || []).length;
  const photosMy = room[myChamp] || {};
  const photosAdv = room[advChamp] || {};

  let html = '<table class="fin-defis-table"><tr><th>Défi</th><th>Moi</th><th>' + (advPseudo || "Adversaire") + '</th></tr>';
  for (let i = 0; i < nbDefis; i++) {
    const defi = room.defis[i] || "-";
    const okMe = photosMy[i] && photosMy[i].url ? "✅" : "❌";
    const okAdv = photosAdv[i] && photosAdv[i].url ? "✅" : "❌";
    html += `<tr><td>${defi}</td><td style="text-align:center">${okMe}</td><td style="text-align:center">${okAdv}</td></tr>`;
  }
  html += '</table>';

  $("fin-faceaface").innerHTML = `
    <div class="fin-faceaface-row">
      <span><b>${myPseudo || "Moi"}</b> (toi)</span>
      <span>vs</span>
      <span><b>${advPseudo || "Adversaire"}</b></span>
    </div>
  `;
  $("fin-details").innerHTML = html;

  let nbFaits = Object.values(photosMy).filter(p => p && p.url).length;
  let gain = nbFaits * 10;
  if (nbFaits === nbDefis) gain += 10;

  let gainFlag = "gain_duel_" + room.id + "_" + myPseudo;
  if (!localStorage.getItem(gainFlag)) {
    await window.supabase.rpc('secure_add_points', { nb: gain });
    localStorage.setItem(gainFlag, "1");
    await window.afficherSolde();
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
};


// ============ LOGIQUE FIN DE DUEL + POPUP ==============
window.checkFinDuel = async function() {
  if (!window.roomData) return;
  // 1. Timer fini ?
  const start = window.roomData.starttime;
  const duration = 24 * 60 * 60 * 1000;
  if (start && (Date.now() > start + duration)) {
    await window.finirDuel();
    return;
  }
};
window.finirDuel = async function() {
  if (window.roomData.status !== 'finished') {
    await window.supabase.from('duels').update({ status: 'finished' }).eq('id', window.roomData.id);
  }
  window.afficherPopupFinDuel(window.roomData);
};


// POPUP PUB/PREMIUM
window.ouvrirPopupRepriseDuel = function(onPub) {
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
};

window.gererPrisePhotoDuel = async function(idx, cadreId = null) {
  let duelId = window.currentRoomId || roomId;
  if (!duelId) {
    alert("Erreur critique : identifiant duel introuvable.");
    return;
  }
  if (!cadreId) cadreId = window.getCadreDuel(duelId, idx);

  // Vérifie si une photo existe déjà (donc demande de reprise)
  const cacheKey = `${duelId}_${window.isPlayer1 ? 'photosa' : 'photosb'}_${idx}`;
  const dejaPhoto = await window.VFindDuelDB.get(cacheKey);

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
    window.ouvrirPopupRepriseDuel(() => {
      localStorage.setItem(repriseKey, "1");
      window.cameraOuvrirCameraPourDuel && window.cameraOuvrirCameraPourDuel(idx, duelId, cadreId);
      window.pubAfterPhoto = true;
    });
    return;
  } else {
    alert("Pour reprendre encore la photo, passe en Premium !");
    return;
  }
};

// HANDLER : Ajoute un jeton (récompense/pub)
window.gagnerJeton = async function() {
  await window.addJetons(1);
  await window.afficherSolde();
};
window.retirerPoints = async function(montant) {
  await window.removePoints(montant);
  await window.afficherSolde();
};
window.gagnerPoints = async function(montant) {
  await window.addPoints(montant);
  await window.afficherSolde();
};

// Changement de cadre après la photo (popup choix)
window.ouvrirPopupChoixCadre = async function(duelId, idx, champ) {
  let cadres = [];
  try {
    cadres = window.getCadresPossedes
      ? await window.getCadresPossedes()
      : ["polaroid_01"];
  } catch(e) { cadres = ["polaroid_01"]; }

  const actuel = window.getCadreDuel(duelId, idx);
  const list = document.getElementById("list-cadres-popup");
  list.innerHTML = "";

  // BOUCLE CORRIGÉE : for...of pour await
  for (const cadre of cadres) {
    let el = document.createElement("img");
    el.src = await window.getCadreUrl(cadre); // URL Supabase
    el.style.width = "72px";
    el.style.cursor = "pointer";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 0 7px #0006";
    el.style.border = cadre === actuel ? "3px solid #FFD900" : "3px solid transparent";
    el.title = cadre;
    el.onclick = async () => {
      window.setCadreDuel(duelId, idx, cadre);
      const { data: room } = await window.supabase.from('duels').select('*').eq('id', duelId).single();
      let photos = (room && room[champ]) ? room[champ] : {};
      if (photos[idx] && typeof photos[idx] === "object") {
        photos[idx].cadre = cadre;
      } else if (typeof photos[idx] === "string") {
        photos[idx] = { url: photos[idx], cadre: cadre };
      }
      await window.supabase.from('duels').update({ [champ]: photos }).eq('id', duelId);
      await window.VFindDuelDB.set(`${duelId}_${champ}_${idx}`, { url: photos[idx].url, cadre: cadre });
      window.fermerPopupCadreChoix();
      location.reload();
    };
    list.appendChild(el);
  }

  document.getElementById("popup-cadre-choix").classList.remove("hidden");
};
window.fermerPopupCadreChoix = function() {
  document.getElementById("popup-cadre-choix").classList.add("hidden");
};

window.deleteDuelPhotosFromSupabase = async function(roomId) {
  const { data: room, error } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
  if (error || !room) return;
  const champs = ['photosa', 'photosb'];
  let filesToDelete = [];
  champs.forEach(champ => {
    const photos = room[champ] || {};
    Object.values(photos).forEach(photoObj => {
      if (photoObj && photoObj.url) {
        const parts = photoObj.url.split('/photosduel/');
        if (parts.length === 2) {
          // parts[1] est déjà "duel_photos/..."
          filesToDelete.push(parts[1]); // ✅ ne pas préfixer une 2e fois
        }
      }
    });
  });
  if (filesToDelete.length) {
    await window.supabase.storage.from('photosduel').remove(filesToDelete);
  }
};

window.getDefisDuelFromSupabase = async function(count = 3) {
  // FULL LOCAL
  return await window.getDefisLocal(count);
};

window.getRoom = async function(roomId) {
  const { data } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
  return data;
};

window.getPhotoDuel = async function(roomId, champ, idx) {
  const cacheKey = `${roomId}_${champ}_${idx}`;
  let obj = await window.VFindDuelDB.get(cacheKey);
  if (obj && obj.url) return obj;
  const room = await window.getRoom(roomId);
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
    await window.VFindDuelDB.set(cacheKey, { url, cadre });
    return { url, cadre };
  }
  return null;
};

window.savePhotoDuel = async function(idx, url, cadreId = null) {
  const champ = window.isPlayer1 ? 'photosa' : 'photosb';
  if (!cadreId) cadreId = window.getCadreDuel(roomId, idx);
  const room = await window.getRoom(roomId);
  let photos = room[champ] || {};
  photos[idx] = { url, cadre: cadreId };
  await window.supabase.from('duels').update({ [champ]: photos }).eq('id', roomId);
  await window.VFindDuelDB.set(`${roomId}_${champ}_${idx}`, { url, cadre: cadreId });
  window.setCadreDuel(roomId, idx, cadreId);
};

// Récupère l’URL du cadre (depuis Supabase ou cache local)
window.agrandirPhoto = async function(url, cadreId) {
  $("photo-affichee").src = url;
  let cadreUrl = await window.getCadreUrl(cadreId);
  $("cadre-affiche").src = cadreUrl || "";
  const popup = $("popup-photo");
  popup.classList.remove('hidden');
  popup.classList.add('show');
};

window.cleanupDuelPhotos = async function() {
  await window.VFindDuelDB.deleteAllForRoom(roomId);
};

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
  window.initDuelGame();
}

// Solde (versions Cloud)
window.afficherSolde = async function() {
  const points = await window.getPointsCloud();
  const jetons = await window.getJetonsCloud();
  const pointsSpan = document.getElementById('points');
  const jetonsSpan = document.getElementById('jetons');
  if (pointsSpan) pointsSpan.textContent = points ?? 0;
  if (jetonsSpan) jetonsSpan.textContent = jetons ?? 0;
};

// Gestion du signalement photo vers Supabase Storage
document.body.addEventListener("click", async function(e) {
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

// Patch compat duel.js (lecture cloud ONLY, anti-triche !)
window.getPoints = window.getPointsCloud;
window.getJetons = window.getJetonsCloud;

// ========== POPUP VALIDATION DE DEFI AVEC JETON ==========

// Ouvre la popup pour valider un défi avec un jeton
window.ouvrirPopupValiderJeton = function(idx) {
  const pop = document.getElementById("popup-jeton-valider");
  if (!pop) { console.warn("[duel] popup-jeton-valider introuvable"); return; }
  window._idxJetonToValidate = idx;
  pop.classList.remove("hidden");
};

// Handler pour le bouton Valider et Annuler
document.addEventListener("DOMContentLoaded", () => {
  // Bouton Valider
  const btnValider = document.getElementById("btn-confirm-jeton");
  if (btnValider) {
    btnValider.onclick = async function() {
      // Appel logique de validation avec un jeton
      await window.validerDefiAvecJeton(window._idxJetonToValidate);
      window._idxJetonToValidate = null;
      const pop = document.getElementById("popup-jeton-valider");
      if (pop) pop.classList.add("hidden");
    };
  }

  // Bouton Annuler
  const btnCancel = document.getElementById("btn-cancel-jeton");
  if (btnCancel) {
    btnCancel.onclick = function() {
      const pop = document.getElementById("popup-jeton-valider");
      if (pop) pop.classList.add("hidden");
      window._idxJetonToValidate = null;
    };
  }
});

// La logique pour valider le défi avec un jeton (VERSION UNIQUE ET CORRIGÉE)
window.validerDefiAvecJeton = async function(idx) {
  // 1. Retire un jeton (doit être définie dans userData.js)
  await window.removeJeton();
  await (window.afficherSolde && window.afficherSolde());

  // 2. Mets l'image "jeton validé" comme photo pour le défi
  const userId = window.getUserId(); // ✅ corrige la référence manquante
  let duelId = window.currentRoomId || (new URLSearchParams(window.location.search)).get("room");
  const pseudo = await window.getPseudo();
  const room = await window.getRoom(duelId);
  const myChamp = (room.player1_id === userId) ? 'photosa' : 'photosb';

  const urlJeton = "assets/img/jeton_pp.jpg"; // Mets l'image de ton jeton ici
  const cadreId = window.getCadreDuel ? window.getCadreDuel(duelId, idx) : "polaroid_01";

  let photos = room[myChamp] || {};
  photos[idx] = { url: urlJeton, cadre: cadreId };
  await window.supabase.from('duels').update({ [myChamp]: photos }).eq('id', duelId);

  // Mets à jour le cache local
  if (window.VFindDuelDB && window.VFindDuelDB.set) {
    await window.VFindDuelDB.set(`${duelId}_${myChamp}_${idx}`, { url: urlJeton, cadre: cadreId });
  }
  if (window.setCadreDuel) window.setCadreDuel(duelId, idx, cadreId);

  // Rafraîchit l'affichage (ou reload)
  if (typeof window.renderDefis === "function") {
    const advID = (room.player1_pseudo === pseudo ? room.player2_pseudo : room.player1_pseudo);
    await window.renderDefis({ myID: pseudo, advID });
  } else {
    location.reload();
  }
};

// PATCH : REPRISE DE PARTIE EN COURS SI EXISTE
if (path.includes("duel_random.html")) {
  const existingRoomId = localStorage.getItem("duel_random_room");
  if (existingRoomId) {
    console.log("[Duel] Reprise de room en cours :", existingRoomId);
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

async function updateSoldeAffichage() {
  const points = await window.getPointsCloud();
  const jetons = await window.getJetonsCloud();
  document.getElementById("points").textContent = points;
  document.getElementById("jetons").textContent = jetons;
}

window.refreshDefisLangueDuel = async function() {
  const lang = window.getCurrentLang ? window.getCurrentLang() : (localStorage.getItem("langue") || "fr");
  // Recharge le pool de défis dans la nouvelle langue pour la création des nouveaux duels
  if (window._allDefis) {
    window._allDefis = null;
  }
  // Recharge à la prochaine partie (ou force le rechargement ici si tu veux une preview en live)
  if (typeof window.chargerDefisLocal === "function") {
    await window.chargerDefisLocal(lang);
  }
  // Tu peux aussi forcer un rafraîchissement de l'UI si besoin, par exemple :
  if (typeof window.renderDefisAccueil === "function") {
    window.renderDefisAccueil();
  }
};
