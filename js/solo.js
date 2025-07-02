// =========== SOLO.JS - VFind SOLO (Capacitor compatible, sans import/export) ===========
// !! userData.js, camera.js, pub.js DOIVENT être chargés AVANT CE FICHIER !!
// Toutes les fonctions requises de userData.js DOIVENT être exposées sur window !

// ----------- UTILS -----------
function getCadreUrl(id) {
  const local = localStorage.getItem(`cadre_${id}`);
  if (local) {
    console.log(`[SOLO] getCadreUrl (LOCAL) cadre_${id} trouvé (taille: ${local.length})`);
    return local;
  }
  const fallback = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
  console.log(`[SOLO] getCadreUrl (REMOTE) cadre_${id} manquant, fallback Supabase: ${fallback}`);
  return fallback;
}

// MIGRATION AUTO : patche les anciennes photos solo non JSON
(function corrigeAnciennesPhotosSolo() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith("photo_defi_") && !key.endsWith("_date")) {
      let value = localStorage.getItem(key);
      if (typeof value === "string" && value.startsWith("data:image")) {
        const cadre = "polaroid_01";
        localStorage.setItem(key, JSON.stringify({ photo: value, cadre }));
        console.log(`[SOLO] MIGRATION photo_defi_: Patched ${key}`);
      }
      if (typeof value === "string" && value.endsWith("jetonpp.webp")) {
        localStorage.setItem(key, JSON.stringify({ photo: value, cadre: "polaroid_01" }));
        console.log(`[SOLO] MIGRATION photo_defi_: Patched (jetonpp) ${key}`);
      }
    }
  });
})();

// Variables globales
let userData = null;
let allDefis = [];
let canRetakePhoto = false;
let retakeDefiId = null;

const DEFIS_CACHE_KEY = "vfind_defis_cache";
const DEFIS_CACHE_DATE_KEY = "vfind_defis_cache_date";
const DEFIS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const SOLO_DEFIS_KEY = "solo_defiActifs";
const SOLO_TIMER_KEY = "solo_defiTimer";

// --------- CHARGEMENT DES DEFIS ---------
async function chargerDefis(lang = "fr") {
  const lastFetch = parseInt(localStorage.getItem(DEFIS_CACHE_DATE_KEY) || "0");
  if (Date.now() - lastFetch < DEFIS_CACHE_TTL) {
    const defisCache = localStorage.getItem(DEFIS_CACHE_KEY);
    if (defisCache) {
      allDefis = JSON.parse(defisCache);
      console.log("[SOLO] Defis chargés depuis cache local", allDefis.length);
      return allDefis;
    }
  }
  allDefis = await window.getDefisFromSupabase(lang);
  localStorage.setItem(DEFIS_CACHE_KEY, JSON.stringify(allDefis));
  localStorage.setItem(DEFIS_CACHE_DATE_KEY, Date.now().toString());
  console.log("[SOLO] Defis téléchargés depuis Supabase", allDefis.length);
  return allDefis;
}

// ---------- GESTION UTILISATEUR ----------
async function chargerUserData(forceRefresh = false) {
  if (userData && !forceRefresh) return userData;
  userData = await window.getUserDataCloud();
  console.log("[SOLO] User data chargé", userData);
  return userData;
}

// ----------- NETTOYAGE PHOTOS EXPIREES -------------
function nettoyerPhotosDefis() {
  const now = Date.now();
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith("photo_defi_")) {
      const dateKey = key + "_date";
      const time = parseInt(localStorage.getItem(dateKey) || "0");
      if (time && now - time > DEFIS_CACHE_TTL) {
        const photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
        const photoId = key.replace("photo_defi_", "");
        if (!photosAimees.includes(photoId)) {
          console.log(`[SOLO] Nettoyage photo_defi_ expirée: ${key}`);
          localStorage.removeItem(key);
          localStorage.removeItem(dateKey);
        }
      }
    }
  });
}

// ----------- STOCKAGE PHOTO AIMEE -------------
function aimerPhoto(defiId) {
  let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
  if (!photosAimees.includes(defiId)) {
    photosAimees.push(defiId);
    localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
    console.log("[SOLO] Photo aimée ajoutée", defiId);
  }
}
function retirerPhotoAimee(defiId) {
  let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
  photosAimees = photosAimees.filter(id => id !== defiId);
  localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
  console.log("[SOLO] Photo aimée retirée", defiId);
}

// ----------- MAJ SOLDE POINTS/JETONS -------------
function majSolde() {
  const pts = document.getElementById("points");
  const jts = document.getElementById("jetons");
  if (pts) pts.textContent = userData?.points || 0;
  if (jts) jts.textContent = userData?.jetons || 0;
  console.log("[SOLO] MAJ solde :", userData?.points, userData?.jetons);
}

// ----------- LOGIQUE JEU -------------
async function initSoloGame() {
  await chargerUserData(true);
  let defiActifs = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");

  console.log(`[SOLO] initSoloGame - nbDefis: ${defiActifs.length}, timer: ${defiTimer}, now: ${Date.now()}`);

  if (defiActifs.length > 0 && defiTimer && Date.now() < defiTimer) {
    showGame();
    updateTimer();
    await loadDefis();
    return;
  }
  if (defiActifs.length > 0 && defiTimer && Date.now() >= defiTimer) {
    await endGameAuto();
    return;
  }
  await startGame();
}

function tousDefisFaits(defis) {
  if (!defis || !defis.length) return false;
  return defis.every(d => d.done);
}

function nettoyerPhotosDefisPartie() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith("photo_defi_")) {
      localStorage.removeItem(key);
      localStorage.removeItem(key + "_date");
    }
  });
  console.log("[SOLO] Photos de la partie nettoyées");
}

async function startGame() {
  await chargerUserData(true);
  await chargerDefis();
  nettoyerPhotosDefisPartie();
  const newDefis = getRandomDefis(3);
  const endTime = Date.now() + 24 * 60 * 60 * 1000;
  localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(newDefis));
  localStorage.setItem(SOLO_TIMER_KEY, endTime.toString());
  console.log("[SOLO] Nouvelle partie solo démarrée", newDefis);
  showGame();
  updateTimer();
  await loadDefis();
}

function getRandomDefis(n) {
  const shuffled = [...allDefis].sort(() => 0.5 - Math.random());
  const out = shuffled.slice(0, n).map(defi => ({
    ...defi,
    done: false,
    byJeton: false,
    canRetake: true,
    photoCount: 0
  }));
  console.log(`[SOLO] Tirage ${n} défis`, out.map(x=>x.id));
  return out;
}

function showGame() {
  const pre = document.getElementById("pre-game");
  if (pre) pre.remove();
  const end = document.getElementById("end-section");
  if (end) end.classList.add("hidden");
  const game = document.getElementById("game-section");
  if (game) game.classList.remove("hidden");
  const soldeContainer = document.getElementById("solde-container");
  if (soldeContainer) soldeContainer.style.display = "flex";
  console.log("[SOLO] showGame: interface affichée");
}

function updateTimer() {
  try {
    console.log('[SOLO] updateTimer called');
    const timerDisplay = document.getElementById("timer");
    if (!timerDisplay) console.log("[SOLO] Alerte : #timer absent du DOM !");
  } catch (e) {
    console.log("[SOLO] Erreur dans updateTimer", e);
  }
  const timerDisplay = document.getElementById("timer");
  let defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");
  const interval = setInterval(() => {
    defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");
    const now = Date.now();
    const diff = defiTimer - now;
    if (diff <= 0) {
      clearInterval(interval);
      endGameAuto();
      return;
    }
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    if (timerDisplay) timerDisplay.textContent = `${h}h ${m}m ${s}s`;
  }, 1000);
}

// ----------- CHARGEMENT DES DÉFIS À AFFICHER -----------
async function loadDefis() {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  const defiList = document.getElementById("defi-list");
  if (!defiList) return;
  if (!defis || !Array.isArray(defis) || defis.length === 0) {
    defiList.innerHTML = '<li class="defi-vide">Aucun défi en cours.</li>';
    return;
  }
  defiList.innerHTML = '';
  let photosMap = {};
  for (let index = 0; index < defis.length; index++) {
    const defi = defis[index];
    const li = document.createElement("li");
    li.className = "defi-item";
    if (defi.done) li.classList.add("done");
    li.setAttribute("data-defi-id", defi.id);

    let photoData = null;
    try {
      photoData = JSON.parse(localStorage.getItem(`photo_defi_${defi.id}`));
    } catch (e) {}
    photosMap[defi.id] = photoData || null;

    const boutonPhoto = `
      <img
        src="assets/icons/photo.svg"
        alt="Prendre une photo"
        style="width:2.2em;cursor:pointer;display:block;margin:0 auto;"
        onclick="window.gererPrisePhoto('${defi.id}', ${index})"
      >
    `;

    let jetonHtml = '';
    if (!photoData && !defi.done) {
      jetonHtml = `<img src="assets/img/jeton_p.webp" alt="Jeton" class="jeton-icone" onclick="window.ouvrirPopupJeton(${index})" />`;
    }

    li.innerHTML = `
      <div class="defi-content">
        <div class="defi-texte">
          <p>${defi.texte}</p>
          ${boutonPhoto}
        </div>
        <div class="defi-photo-container" data-photo-id="${defi.id}" id="photo-defi-container-${defi.id}"></div>
      </div>
      ${jetonHtml}
    `;

    defiList.appendChild(li);
  }

  setTimeout(() => {
    for (const defiId in photosMap) {
      if (photosMap[defiId]) {
        window.renderPhotoCadreSolo(defiId);
      }
    }
  }, 15);
  console.log("[SOLO] loadDefis affiché:", defis.map(d => ({
    id: d.id,
    done: d.done,
    hasPhoto: !!photosMap[d.id]
  })));
}

// ----------- FONCTION CLE SOLO : VALIDATION AVEC JETON -----------
async function validerDefiAvecJeton(index) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defi = defis[index];
  if (!defi) return;
  defi.done = true;
  defis[index] = defi;
  localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(defis));
  await loadDefis?.();
  if (typeof majSolde === "function") majSolde();
}
window.validerDefiAvecJeton = validerDefiAvecJeton;

// ----------- PRISE/REPRISE PHOTO CENTRALISÉE -----------
window.gererPrisePhoto = function(defiId, index) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defi = defis[index];
  defi.photoCount = defi.photoCount || 0;

  if (!localStorage.getItem(`photo_defi_${defiId}`)) {
    canRetakePhoto = false;
    retakeDefiId = null;
    console.log(`[SOLO] Prise photo (1ere fois) pour defi ${defiId}`);
    window.ouvrirCameraPour(defiId);
    return;
  }

  if (window.isPremium && window.isPremium()) {
    canRetakePhoto = true;
    retakeDefiId = defiId;
    console.log(`[SOLO] Prise photo (premium retake) pour defi ${defiId}`);
    window.ouvrirCameraPour(defiId);
    return;
  }

  if (defi.photoCount >= 1) {
    console.log(`[SOLO] Popup retake demandé (déjà 1 photo) pour defi ${defiId}`);
    const popup = document.getElementById("popup-premium-photo");
    if (popup) {
      popup.classList.remove("hidden");
      popup.classList.add("show");
      // ... gestion boutons
    }
    return;
  } else {
    canRetakePhoto = false;
    retakeDefiId = null;
    console.log(`[SOLO] Prise photo (par défaut) pour defi ${defiId}`);
    window.ouvrirCameraPour(defiId);
  }
};

// ----------- PHOTO DANS CADRE & LOGIQUE PUB/PREMIUM -----------
window.afficherPhotoDansCadreSolo = async function(defiId, dataUrl) {
  console.log(`[SOLO] >>> afficherPhotoDansCadreSolo(${defiId}) - dataUrl:`, dataUrl?.slice(0,80));
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let index = defis.findIndex(d => d.id == defiId);
  if (index === -1) {
    alert("Impossible d’associer la photo à ce défi (id : " + defiId + "). Partie corrompue ou reset. Lance une nouvelle partie !");
    console.warn(`[SOLO] ERREUR: defis.indexOf(${defiId}) == -1`);
    return;
  }
  let defi = defis[index];
  defi.photoCount = (defi.photoCount || 0) + 1;

  const cadreGlobal = await window.getCadreSelectionne();
  const oldData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`) || "{}");
  const cadreId = oldData.cadre || cadreGlobal || "polaroid_01";
  console.log(`[SOLO] Cadre utilisé pour defi ${defiId}:`, cadreId);

  // On normalise la photo AVANT stockage/affichage
  try {
    const photoNormalisee = await window.genererImageConcoursAvecCadre(dataUrl);
    console.log(`[SOLO] Photo normalisée OK (taille base64: ${photoNormalisee?.length || 0})`);
    const data = {
      photo: photoNormalisee,
      cadre: cadreId
    };
    localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(data));
    localStorage.setItem(`photo_defi_${defiId}_date`, Date.now().toString());
    console.log(`[SOLO] Photo enregistrée dans localStorage pour defi ${defiId}`, data);
  } catch(e) {
    console.error(`[SOLO] ERREUR NORMALISATION PHOTO/CADRE`, e);
    alert("Erreur lors du traitement de la photo. Réessaie !");
    return;
  }

  canRetakePhoto = false;
  retakeDefiId = null;

  if (!defi.done) {
    defi.done = true;
    defis[index] = defi;
    localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(defis));
    console.log(`[SOLO] Défi ${defiId} marqué comme fait`);
  }

  await loadDefis();

  if (window.pubAfterPhoto) {
    window.pubAfterPhoto = false;
    await showRewardedAd();
  }
};

// ----------- RENDU MINIATURES + CHANGEMENT DE CADRE SOLO -----------
window.renderPhotoCadreSolo = async function(defiId) {
  const container = document.getElementById(`photo-defi-container-${defiId}`);
  if (!container) return;
  let photoData = {};
  try {
    photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
  } catch (e) {}
  const cadreId = photoData?.cadre || (await window.getCadreSelectionne()) || "polaroid_01";
  const photoUrl = photoData?.photo || "";
  console.log(`[SOLO] renderPhotoCadreSolo: defiId=${defiId}, cadreId=${cadreId}, photo? ${!!photoUrl}`);

  if (photoUrl) {
    container.innerHTML = `
      <div class="cadre-item cadre-duel-mini">
        <div class="cadre-preview">
          <img class="photo-cadre" src="${getCadreUrl(cadreId)}">
          <img class="photo-user" src="${photoUrl}">
        </div>
      </div>
    `;
    const photoImg = container.querySelector('.photo-user');
    if (photoImg) {
      photoImg.oncontextmenu = (e) => { e.preventDefault(); window.ouvrirPopupChoixCadreSolo(defiId); };
      photoImg.ontouchstart = function() {
        this._touchTimer = setTimeout(() => { window.ouvrirPopupChoixCadreSolo(defiId); }, 500);
      };
      photoImg.ontouchend = function() { clearTimeout(this._touchTimer); };
      photoImg.onclick = () => window.agrandirPhoto(photoUrl, defiId);
    }
  } else {
    container.innerHTML = "<span style='color:red'>[SOLO] Aucune photo pour ce défi</span>";
    console.warn(`[SOLO] RENDU: pas de photo pour defi ${defiId}`);
  }
};

// ----------- CHANGEMENT DE CADRE SOLO (POPUP OU PROMPT) -----------
window.ouvrirPopupChoixCadreSolo = async function(defiId) {
  let cadres = [];
  try {
    cadres = await window.getCadresPossedes();
    console.log("[SOLO] ouvrirPopupChoixCadreSolo: cadres dispos:", cadres);
  } catch { cadres = ["polaroid_01"]; }
  let photoData = {};
  try {
    photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
  } catch (e) {}
  const actuel = photoData?.cadre || (await window.getCadreSelectionne()) || "polaroid_01";
  const list = document.getElementById("list-cadres-popup-solo");
  if (!list) return;

  list.innerHTML = "";
  cadres.forEach(cadre => {
    let el = document.createElement("img");
    el.src = getCadreUrl(cadre);
    el.style.width = "72px";
    el.style.cursor = "pointer";
    el.style.borderRadius = "12px";
    el.style.boxShadow = "0 0 7px #0006";
    el.style.border = cadre === actuel ? "3px solid #FFD900" : "3px solid transparent";
    el.title = cadre;
    el.onclick = () => {
      photoData.cadre = cadre;
      localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(photoData));
      window.fermerPopupCadreSolo();
      window.renderPhotoCadreSolo(defiId);
      console.log(`[SOLO] Cadre changé pour defi ${defiId} => ${cadre}`);
    };
    list.appendChild(el);
  });

  const popup = document.getElementById("popup-cadre-solo");
  if (popup) popup.classList.remove("hidden");
};

window.fermerPopupCadreSolo = function() {
  const popup = document.getElementById("popup-cadre-solo");
  if (popup) popup.classList.add("hidden");
};

// ----------- ZOOM PHOTO / POPUP -----------
window.agrandirPhoto = async function(dataUrl, defiId) {
  const cadre = document.getElementById("cadre-affiche");
  const photo = document.getElementById("photo-affichee");
  if (!cadre || !photo) return;

  let photoData = null;
  try {
    photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
  } catch (e) {}

  const cadreActuel = photoData?.cadre || (await window.getCadreSelectionne());
  cadre.src = getCadreUrl(cadreActuel);
  photo.src = dataUrl;

  const popup = document.getElementById("popup-photo");
  if (popup) {
    popup.classList.remove("hidden");
    popup.classList.add("show");
    console.log(`[SOLO] Popup zoom photo ouvert pour defi ${defiId}`);
  }

  const btnAimer = document.getElementById("btn-aimer-photo");
  if (btnAimer) {
    btnAimer.onclick = () => {
      let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
      if (!photosAimees.includes(defiId)) {
        photosAimees.push(defiId);
        localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
        btnAimer.classList.add("active");
        console.log(`[SOLO] Photo ${defiId} aimée`);
      } else {
        photosAimees = photosAimees.filter(id => id !== defiId);
        localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
        btnAimer.classList.remove("active");
        console.log(`[SOLO] Photo ${defiId} "dés-aimée"`);
      }
    };

    let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
    if (photosAimees.includes(defiId)) {
      btnAimer.classList.add("active");
    } else {
      btnAimer.classList.remove("active");
    }
  }
};

// ----------- VALIDATION DÉFI AVEC JETON OU PHOTO -----------
window.validerDefi = async function(index) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defi = defis[index];
  if (!defi.done) {
    if (localStorage.getItem(`photo_defi_${defi.id}`)) {
      defi.done = true;
      defis[index] = defi;
      localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(defis));
      await loadDefis();
      return;
    }
    await window.ouvrirPopupJeton(index);
  }
};

window.ouvrirPopupJeton = async function(index) {
  const jetons = await window.getJetons();
  if (jetons > 0) {
    if (confirm("Valider ce défi avec un jeton ?")) {
      const { data, error } = await window.supabase.rpc('secure_remove_jeton', { nb: 1 });
      if (error || !data || data.success !== true) {
        alert("Erreur lors de la soustraction du jeton ou plus de jetons dispo !");
        return;
      }
      await validerDefiAvecJeton(index);
      majSolde?.();
    }
  } else {
    if (confirm("Plus de jeton disponible. Regarder une pub pour gagner 3 jetons ?")) {
      await showRewardedAd();
      alert("3 jetons crédités !");
      majSolde();
    }
  }
};

// ----------- FIN DE PARTIE AUTOMATIQUE -----------
window.endGameAuto = async function() {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  if (!defis.length) return;
  let nbFaits = defis.filter(d => d.done).length;
  let gain = nbFaits * 10;
  if (nbFaits === 3) gain += 10;
  await chargerUserData(true);
  const oldPoints = userData.points || 0;
  const newPoints = oldPoints + gain;
  const date = new Date().toISOString().slice(0, 10);
  let historique = userData.historique || [];
  historique.push({ date, defi: defis.map(d => d.id) });
  await window.updateUserData({ points: newPoints, historique });

  localStorage.removeItem(SOLO_DEFIS_KEY);
  localStorage.removeItem(SOLO_TIMER_KEY);

  const endMsg = document.getElementById("end-message");
  if (endMsg) endMsg.textContent = `Partie terminée ! Tu as validé ${nbFaits}/3 défis.`;

  const gainMsg = document.getElementById("gain-message");
  if (gainMsg) gainMsg.textContent = `+${gain} pièces (${nbFaits} défi${nbFaits>1?"s":""} x10${nbFaits===3?" +10 bonus":""})`;

  const popupEnd = document.getElementById("popup-end");
  if (popupEnd) {
    popupEnd.classList.remove("hidden");
    popupEnd.classList.add("show");
  }
  console.log(`[SOLO] Fin de partie auto. nb faits: ${nbFaits} / gain: ${gain}`);

  majSolde();

  const replayBtnEnd = document.getElementById("replayBtnEnd");
  if (replayBtnEnd && popupEnd) {
    replayBtnEnd.onclick = async function() {
      popupEnd.classList.add("hidden");
      popupEnd.classList.remove("show");
      await startGame();
    };
  }

  const returnBtnEnd = document.getElementById("returnBtnEnd");
  if (returnBtnEnd) {
    returnBtnEnd.onclick = function() {
      window.location.href = "index.html";
    };
  }
};

// ----------- DOMContentLoaded PRINCIPAL -----------
document.addEventListener("DOMContentLoaded", () => {
  nettoyerPhotosDefis();
  chargerUserData(true).then(majSolde);
  initSoloGame();

  document.querySelectorAll('.close-btn, #close-popup').forEach(btn => {
    btn.onclick = function() {
      let popup = btn.closest('.popup');
      if (popup) {
        popup.classList.add('hidden');
        popup.classList.remove('show');
      }
    };
  });

  // ----------- BONUS : BOUTONS POPUP REPRISE SOLO -----------
  const btnPubRepriseSolo = document.getElementById("btnReprisePubSolo");
  const btnAnnulerRepriseSolo = document.getElementById("btnAnnulerRepriseSolo");
  const btnPremiumSolo = document.getElementById("btnReprisePremiumSolo");
  const popupRepriseSolo = document.getElementById("popup-reprise-photo-solo");

  if (btnPubRepriseSolo && btnAnnulerRepriseSolo && btnPremiumSolo && popupRepriseSolo) {
    btnPubRepriseSolo.addEventListener("click", async () => {
      await window.showRewardedAd("rewarded");
      popupRepriseSolo.classList.add("hidden");
    });

    btnAnnulerRepriseSolo.addEventListener("click", () => {
      popupRepriseSolo.classList.add("hidden");
    });

    btnPremiumSolo.addEventListener("click", () => {
      window.location.href = "premium.html";
    });
  }
});

// ----------- SIMULATION PUB (à remplacer par ta régie) -----------
window.showRewardedAd = async function() {
  return new Promise((resolve) => {
    alert("SIMULATION PUB : regarde ta vidéo ici…");
    setTimeout(() => { resolve(); }, 3200);
  });
};

// ----------- PHOTOS AIMÉES SOLO -----------
window.afficherPhotosAimees = async function() {
  const container = document.getElementById("photos-aimees-list");
  if (!container) return;
  container.innerHTML = "";

  let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
  if (photosAimees.length === 0) {
    container.innerHTML = "<p>Aucune photo aimée pour l’instant.</p>";
    return;
  }

  for (let defiId of photosAimees) {
    let photoData = null;
    try {
      photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
    } catch (e) {}

    if (photoData && photoData.photo) {
      let cadre = photoData.cadre || "polaroid_01";
      let el = document.createElement("div");
      el.className = "cadre-item cadre-duel-mini";
      el.innerHTML = `
        <div class="cadre-preview">
          <img class="photo-cadre" src="${getCadreUrl(cadre)}">
          <img class="photo-user" src="${photoData.photo}">
        </div>
      `;
      el.onclick = () => window.agrandirPhoto(photoData.photo, defiId);
      container.appendChild(el);
    }
  }
};
