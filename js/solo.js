import { getJetons, addJetons, ajouterDefiHistorique, removeJeton, getCadreSelectionne, getCadresPossedes, updateUserData, getUserDataCloud, getDefisFromSupabase, isPremium } from "./userData.js";
import { ouvrirCameraPour as cameraOuvrirCameraPour } from "./camera.js";

// MIGRATION AUTO : patche les anciennes photos solo non JSON
(function corrigeAnciennesPhotosSolo() {
  Object.keys(localStorage).forEach(key => {
    if (key.startsWith("photo_defi_") && !key.endsWith("_date")) {
      let value = localStorage.getItem(key);
      if (typeof value === "string" && value.startsWith("data:image")) {
        // PATCH : convertit en nouvel objet {photo, cadre}
        const cadre = "polaroid_01";
        localStorage.setItem(key, JSON.stringify({ photo: value, cadre }));
      }
      // Patch jeton, qui peut avoir l’ancienne image string aussi
      if (typeof value === "string" && value.endsWith("jetonpp.webp")) {
        localStorage.setItem(key, JSON.stringify({ photo: value, cadre: "polaroid_01" }));
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
      return allDefis;
    }
  }
  allDefis = await getDefisFromSupabase(lang);
  localStorage.setItem(DEFIS_CACHE_KEY, JSON.stringify(allDefis));
  localStorage.setItem(DEFIS_CACHE_DATE_KEY, Date.now().toString());
  return allDefis;
}

// ---------- GESTION UTILISATEUR ----------
async function chargerUserData(forceRefresh = false) {
  if (userData && !forceRefresh) return userData;
  userData = await getUserDataCloud();
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
  }
}
function retirerPhotoAimee(defiId) {
  let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
  photosAimees = photosAimees.filter(id => id !== defiId);
  localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
}

// ----------- MAJ SOLDE POINTS/JETONS -------------
function majSolde() {
  if (document.getElementById("points")) document.getElementById("points").textContent = userData.points || 0;
  if (document.getElementById("jetons")) document.getElementById("jetons").textContent = userData.jetons || 0;
}

// ----------- LOGIQUE JEU -------------
async function init() {
  await chargerUserData(true);

  let defiActifs = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");

  // Cas : Partie en cours (défis non terminés OU terminés mais timer pas fini)
  if (
    defiActifs.length > 0 &&
    defiTimer &&
    Date.now() < defiTimer
  ) {
    showGame();
    updateTimer();
    await loadDefis();
    return;
  }

  // Cas : Timer terminé (fin de partie, popup)
  if (
    defiActifs.length > 0 &&
    defiTimer &&
    Date.now() >= defiTimer
  ) {
    await endGameAuto();
    return;
  }

  // Sinon, pas de partie active → nouvelle partie
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
}

async function startGame() {
  await chargerUserData(true);
  await chargerDefis();
  nettoyerPhotosDefisPartie();
  const newDefis = getRandomDefis(3);
  const endTime = Date.now() + 24 * 60 * 60 * 1000;
  localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(newDefis));
  localStorage.setItem(SOLO_TIMER_KEY, endTime.toString());
  showGame();
  updateTimer();
  await loadDefis();
}

function getRandomDefis(n) {
  const shuffled = [...allDefis].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, n).map(defi => ({
    ...defi,
    done: false,
    byJeton: false,
    canRetake: true,
    photoCount: 0
  }));
}

function showGame() {
  if (document.getElementById("pre-game")) document.getElementById("pre-game").remove();
  document.getElementById("end-section").classList.add("hidden");
  document.getElementById("game-section").classList.remove("hidden");
  const soldeContainer = document.getElementById("solde-container");
  if (soldeContainer) soldeContainer.style.display = "flex";
}

function updateTimer() {
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
    timerDisplay.textContent = `${h}h ${m}m ${s}s`;
  }, 1000);
}

// ----------- CHARGEMENT DES DÉFIS À AFFICHER -----------
async function loadDefis() {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  const defiList = document.getElementById("defi-list");
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
      jetonHtml = `<img src="assets/img/jeton_p.webp" alt="Jeton" class="jeton-icone" onclick="ouvrirPopupJeton(${index})" />`;
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

  // --- PATCH : forcer affichage photos après le DOM (fix tous navigateurs) ---
  setTimeout(() => {
    for (const defiId in photosMap) {
      if (photosMap[defiId]) {
        window.renderPhotoCadreSolo(defiId);
      }
    }
  }, 15);
}

// ----------- PRISE/REPRISE PHOTO CENTRALISÉE -----------
window.gererPrisePhoto = function(defiId, index) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defi = defis[index];
  defi.photoCount = defi.photoCount || 0;

  if (!localStorage.getItem(`photo_defi_${defiId}`)) {
    canRetakePhoto = false;
    retakeDefiId = null;
    window.ouvrirCameraPour(defiId);
    return;
  }

  if (isPremium()) {
    canRetakePhoto = true;
    retakeDefiId = defiId;
    window.ouvrirCameraPour(defiId);
    return;
  }

  if (defi.photoCount >= 1) {
    const popup = document.getElementById("popup-premium-photo");
    popup.classList.remove("hidden");
    popup.classList.add("show");

    document.getElementById("btnPubReprise").onclick = function() {
      popup.classList.add("hidden");
      popup.classList.remove("show");
      canRetakePhoto = true;
      retakeDefiId = defiId;
      window.ouvrirCameraPour(defiId);
      window.pubAfterPhoto = true;
    };
    document.getElementById("btnAnnulerReprise").onclick = function() {
      popup.classList.add("hidden");
      popup.classList.remove("show");
    };
    return;
  } else {
    canRetakePhoto = false;
    retakeDefiId = null;
    window.ouvrirCameraPour(defiId);
  }
};

// ----------- PHOTO DANS CADRE & LOGIQUE PUB/PREMIUM -----------
window.afficherPhotoDansCadreSolo = async function(defiId, dataUrl) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let index = defis.findIndex(d => d.id == defiId);
  if (index === -1) {
    alert("Impossible d’associer la photo à ce défi (id : " + defiId + "). Partie corrompue ou reset. Lance une nouvelle partie !");
    return;
  }
  let defi = defis[index];
  defi.photoCount = (defi.photoCount || 0) + 1;

  const cadreGlobal = await getCadreSelectionne();
  const oldData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`) || "{}");
  const cadreId = oldData.cadre || cadreGlobal || "polaroid_01";
  const data = {
    photo: dataUrl,
    cadre: cadreId
  };
  localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(data));
  localStorage.setItem(`photo_defi_${defiId}_date`, Date.now().toString());

  canRetakePhoto = false;
  retakeDefiId = null;

  // ------ Ajout automatique de la validation ------
  if (!defi.done) {
    defi.done = true;
    defis[index] = defi;
    localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(defis));
  }
  // ------------------------------------------------

  await loadDefis();

  // PAS de fin de partie ici : le timer gère la fin !

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
  const cadreId = photoData?.cadre || (await getCadreSelectionne()) || "polaroid_01";
  const photoUrl = photoData?.photo || "";

  if (photoUrl) {
    container.innerHTML = `
      <div class="cadre-item cadre-duel-mini">
        <div class="cadre-preview">
          <img class="photo-cadre" src="./assets/cadres/${cadreId}.webp">
          <img class="photo-user" src="${photoUrl}">
        </div>
      </div>
    `;
    const photoImg = container.querySelector('.photo-user');
    photoImg.oncontextmenu = (e) => { e.preventDefault(); ouvrirPopupChoixCadreSolo(defiId); };
    photoImg.ontouchstart = function() {
      this._touchTimer = setTimeout(() => { ouvrirPopupChoixCadreSolo(defiId); }, 500);
    };
    photoImg.ontouchend = function() { clearTimeout(this._touchTimer); };
    photoImg.onclick = () => agrandirPhoto(photoUrl, defiId);
  } else {
    container.innerHTML = "";
  }
};

// ----------- CHANGEMENT DE CADRE SOLO (POPUP OU PROMPT) -----------
window.ouvrirPopupChoixCadreSolo = async function(defiId) {
  let cadres = [];
  try {
    cadres = await getCadresPossedes();
  } catch { cadres = ["polaroid_01"]; }
  let photoData = {};
  try {
    photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
  } catch (e) {}
  const actuel = photoData?.cadre || (await getCadreSelectionne()) || "polaroid_01";
  const photoUrl = photoData?.photo || "";

  const list = document.getElementById("list-cadres-popup-solo");
  if (!list) return;

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
    el.onclick = () => {
      photoData.cadre = cadre;
      localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(photoData));
      fermerPopupCadreSolo();
      window.renderPhotoCadreSolo(defiId);
    };
    list.appendChild(el);
  });

  document.getElementById("popup-cadre-solo").classList.remove("hidden");
};

window.fermerPopupCadreSolo = function() {
  document.getElementById("popup-cadre-solo").classList.add("hidden");
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

  const cadreActuel = photoData?.cadre || (await getCadreSelectionne());
  cadre.src = `./assets/cadres/${cadreActuel}.webp`;
  photo.src = dataUrl;

  const popup = document.getElementById("popup-photo");
  if (popup) {
    popup.classList.remove("hidden");
    popup.classList.add("show");
  }

  // === BOUTON CŒUR ===
  const btnAimer = document.getElementById("btn-aimer-photo");
  if (btnAimer) {
    btnAimer.onclick = () => {
      let photosAimees = JSON.parse(localStorage.getItem("photos_aimees") || "[]");
      if (!photosAimees.includes(defiId)) {
        photosAimees.push(defiId);
        localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
        btnAimer.classList.add("active");
      } else {
        photosAimees = photosAimees.filter(id => id !== defiId);
        localStorage.setItem("photos_aimees", JSON.stringify(photosAimees));
        btnAimer.classList.remove("active");
      }
    };

    // Affiche l’état aimé
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
  const jetons = await getJetons();
  if (jetons > 0) {
    if (confirm("Valider ce défi avec un jeton ?")) {
      const success = await removeJeton();
      if (success) {
        await validerDefiAvecJeton(index);
        majSolde();
      } else {
        alert("Erreur lors de la soustraction du jeton.");
      }
    }
  } else {
    if (confirm("Plus de jeton disponible. Regarder une pub pour gagner 3 jetons ?")) {
      await showRewardedAd();
      await addJetons(3);
      majSolde();
      alert("3 jetons crédités !");
    }
  }
};

async function validerDefiAvecJeton(index) {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  let defi = defis[index];
  if (!defi.done) {
    defi.done = true;
    defi.byJeton = true;
    defis[index] = defi;
    localStorage.setItem(`photo_defi_${defi.id}`, JSON.stringify({ photo: "assets/img/jetonpp.webp", cadre: "polaroid_01" }));
    localStorage.setItem(SOLO_DEFIS_KEY, JSON.stringify(defis));
    await loadDefis();
 
  }
}


// ----------- FIN DE PARTIE AUTOMATIQUE -----------
async function endGameAuto() {
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
  await updateUserData({ points: newPoints, historique });

  // Nettoie la partie solo
  localStorage.removeItem(SOLO_DEFIS_KEY);
  localStorage.removeItem(SOLO_TIMER_KEY);

  // Popup fin de partie
  document.getElementById("end-message").textContent =
    `Partie terminée ! Tu as validé ${nbFaits}/3 défis.`;
  document.getElementById("gain-message").textContent =
    `+${gain} pièces (${nbFaits} défi${nbFaits>1?"s":""} x10${nbFaits===3?" +10 bonus":""})`;

  document.getElementById("popup-end").classList.remove("hidden");
  document.getElementById("popup-end").classList.add("show");
  majSolde();
  document.getElementById("replayBtnEnd").onclick = async function() {
    document.getElementById("popup-end").classList.add("hidden");
    document.getElementById("popup-end").classList.remove("show");
    await startGame();
  };
  document.getElementById("returnBtnEnd").onclick = function() {
    window.location.href = "index.html";
  };
}

// === Ajout : fermeture croix popup + nettoyage du bouton cœur ===
document.addEventListener("DOMContentLoaded", () => {
  nettoyerPhotosDefis();
  chargerUserData(true).then(majSolde);
  // Lancement direct sans pré-game
  init();

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

// ----------- EXEMPLE : fonction reward à compléter selon ta régie pub -----------
async function showRewardedAd() {
  return new Promise((resolve) => {
    alert("SIMULATION PUB : regarde ta vidéo ici…");
    setTimeout(() => { resolve(); }, 3200);
  });
}

// Affiche toutes les photos aimées dans le container #photos-aimees-list
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
    // Essaie de trouver la photo en solo
    let photoData = null;
    try {
      photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`));
    } catch (e) {}

    // Ajoute une miniature seulement si elle existe
    if (photoData && photoData.photo) {
      let cadre = photoData.cadre || "polaroid_01";
      let el = document.createElement("div");
      el.className = "cadre-item cadre-duel-mini";
      el.innerHTML = `
        <div class="cadre-preview">
          <img class="photo-cadre" src="./assets/cadres/${cadre}.webp">
          <img class="photo-user" src="${photoData.photo}">
        </div>
      `;
      // Au clic, on peut agrandir (si tu veux)
      el.onclick = () => window.agrandirPhoto(photoData.photo, defiId);
      container.appendChild(el);
    }
  }
};
