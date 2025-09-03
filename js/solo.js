// =========== SOLO.JS - VFind SOLO (Capacitor compatible, sans import/export) ===========
// !! userData.js, camera.js, pub.js DOIVENT être chargés AVANT CE FICHIER !!
// Toutes les fonctions requises de userData.js DOIVENT être exposées sur window !

/* ===== Helpers langues & defis (same as duel.js) ===== */
function _normLang(code) {
  const raw = (code || '').toLowerCase().replace('_','-');
  if (raw.startsWith('pt-br')) return 'ptbr';
  const m = { fr:'fr', en:'en', es:'es', de:'de', it:'it', nl:'nl', pt:'pt', ar:'ar', ja:'ja', ko:'ko', id:'idn' };
  return m[(raw || 'fr').slice(0,2)] || 'fr';
}
function getLangParam() {
  const raw = (window.getCurrentLang ? window.getCurrentLang() : null)
           || localStorage.getItem('langue')
           || (navigator.language || 'fr');
  return _normLang(raw);
}
// cache par langue
const DEFIS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
const DEFIS_CACHE_KEY = (lang) => `vfind_defis_cache_${lang}`;
const DEFIS_CACHE_DATE_KEY = (lang) => `vfind_defis_cache_date_${lang}`;

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

const SOLO_DEFIS_KEY = "solo_defiActifs";
const SOLO_TIMER_KEY = "solo_defiTimer";

// --------- CHARGEMENT DES DEFIS ---------
async function chargerDefis(lang = null) {
  const L = _normLang(lang || getLangParam());
  const lastFetch = parseInt(localStorage.getItem(DEFIS_CACHE_DATE_KEY(L)) || "0");
  if (Date.now() - lastFetch < DEFIS_CACHE_TTL) {
    const defisCache = localStorage.getItem(DEFIS_CACHE_KEY(L));
    if (defisCache) {
      allDefis = JSON.parse(defisCache);
      console.log("[SOLO] Defis chargés depuis cache local", L, allDefis.length);
      return allDefis;
    }
  }

  // priorité BDD
  let arr = [];
  try {
    if (typeof window.getDefisFromSupabase === "function") {
      const defs = await window.getDefisFromSupabase(L); // [{id, texte}]
      arr = defs || [];
    }
  } catch (e) { console.warn("[SOLO] getDefisFromSupabase KO:", e?.message || e); }

  // fallback local
  if (!arr || !arr.length) {
    try {
      const rep = await fetch('data/defis.json');
      const json = await rep.json();
      const base = json.defis || json;
      arr = (base || []).map((d, i) => ({
        id: d.id ?? i,
        texte: d[L] ?? d['fr'] ?? Object.values(d)[0]
      })).filter(x => !!x.texte);
      console.log("[SOLO] Defis téléchargés depuis defis.json", L, arr.length);
    } catch (e) {
      console.error("[SOLO] fallback local defis.json KO:", e);
      arr = [];
    }
  }

  allDefis = arr;
  localStorage.setItem(DEFIS_CACHE_KEY(L), JSON.stringify(allDefis));
  localStorage.setItem(DEFIS_CACHE_DATE_KEY(L), Date.now().toString());
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
document.addEventListener("DOMContentLoaded", () => {
  const heartBtn = document.getElementById("btn-aimer-photo");
  const photoAffichee = document.getElementById("photo-affichee");
  if (!heartBtn || !photoAffichee) return;

  heartBtn.addEventListener("click", () => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]"); } catch {}
    // évite les doublons : ici on n’a pas le defiId, donc on déduplique par URL
    if (!list.some(x => x.imageDataUrl === photoAffichee.src)) {
      if (list.length >= 30) list.shift();
      list.push({ imageDataUrl: photoAffichee.src, cadre: "polaroid_01", date: Date.now(), mode: "solo" });
      localStorage.setItem("photos_aimees_obj", JSON.stringify(list));
    }
  });
});


// ----------- STOCKAGE PHOTO AIMEE -------------
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


// ----------- MAJ SOLDE POINTS/JETONS -------------
function majSolde() {
  const pts = document.getElementById("points");
  const jts = document.getElementById("jetons");
  if (pts) pts.textContent = userData?.points || 0;
  if (jts) jts.textContent = userData?.jetons || 0;
  console.log("[SOLO] MAJ solde :", userData?.points, userData?.jetons);
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
  await chargerDefis(getLangParam());
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
  console.log('[SOLO] updateTimer called');
  const timerDisplay = document.getElementById("timer");
  if (!timerDisplay) {
    console.warn("[SOLO] #timer manquant, pas de timer lancé !");
    return;
  }

  let defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");

  if (window.soloTimerInterval) clearInterval(window.soloTimerInterval);

  window.soloTimerInterval = setInterval(() => {
    defiTimer = parseInt(localStorage.getItem(SOLO_TIMER_KEY) || "0");
    const now = Date.now();
    const diff = defiTimer - now;
    if (diff <= 0) {
      clearInterval(window.soloTimerInterval);
      endGameAuto();
      return;
    }
    const h = Math.floor(diff / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const s = Math.floor((diff % (1000 * 60)) / 1000);
    timerDisplay.textContent = `${h}h ${m}m ${s}s`;
    console.log(`[SOLO] Tick timer: ${h}h ${m}m ${s}s`);
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
    try { photoData = JSON.parse(localStorage.getItem(`photo_defi_${defi.id}`)); } catch (e) {}
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
  console.log("[SOLO] loadDefis affiché:", defis.map(d => ({ id: d.id, done: d.done, hasPhoto: !!photosMap[d.id] })));
}

// ----------- FONCTION CLE SOLO : VALIDATION AVEC JETON -----------
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
window.gererPrisePhoto = async function(defiId, index) {
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

  // Premium = reprises illimitées (pas de pub)
  let premium = false;
  try { premium = await (window.hasNoAds?.() || window.isPremium?.()); } catch (_) {}
  if (premium) {
    canRetakePhoto = true;
    retakeDefiId = defiId;
    console.log(`[SOLO] Prise photo (premium retake) pour defi ${defiId}`);
    window.ouvrirCameraPour(defiId);
    return;
  }

  // NON-premium : 1 reprise via popup pub (si tu gères une limite)
  if (defi.photoCount >= 1) {
    console.log(`[SOLO] Popup retake demandé (déjà 1 photo) pour defi ${defiId}`);
    const popup = document.getElementById("popup-premium-photo");
    if (popup) {
      popup.classList.remove("hidden");
      popup.classList.add("show");
      // tes handlers boutons existent déjà côté HTML
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
    alert("Impossible d’associer la photo à ce défi (id : " + defiId + "). Partie corrompue ou reset. Lance une nouvelle partie !");
    console.warn(`[SOLO] ERREUR: defis.indexOf(${defiId}) == -1`);
    return;
  }
  let defi = defis[index];
  defi.photoCount = (defi.photoCount || 0) + 1;

  const cadreGlobal = await window.getCadreSelectionne();
  const oldData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`) || "{}");
  const cadreId = oldData.cadre || cadreGlobal || "polaroid_01";
  console.log(`[SOLO] Cadre utilisé pour defi ${defiId}:`, cadreId);

  try {
    const photoNormalisee = await window.genererImageConcoursAvecCadre(dataUrl);
    console.log(`[SOLO] Photo normalisée OK (taille base64: ${photoNormalisee?.length || 0})`);
    const data = { photo: photoNormalisee, cadre: cadreId };
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

  if (window.pubAfterPhoto) {
    window.pubAfterPhoto = false;
    // affiche une rewarded si NON premium (bloqué automatiquement pour premium via pub.js)
    await window.showRewardedAd();
  }

  await loadDefis();
  window.location.reload();
};

// ----------- RENDU MINIATURES + CHANGEMENT DE CADRE SOLO -----------
window.renderPhotoCadreSolo = async function(defiId) {
  const container = document.getElementById(`photo-defi-container-${defiId}`);
  if (!container) return;
  let photoData = {};
  try { photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`)); } catch (e) {}
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
  try { photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`)); } catch (e) {}
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
// ----------- ZOOM PHOTO / POPUP -----------
window.agrandirPhoto = async function(dataUrl, defiId) {
  const cadreImg = document.getElementById("cadre-affiche");
  const photoImg = document.getElementById("photo-affichee");
  if (!cadreImg || !photoImg) return;

  let obj = null;
  try { obj = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`)); } catch {}
  const cadreActuel = obj?.cadre || (await window.getCadreSelectionne()) || "polaroid_01";

  // l’image stockée est déjà la version "photo + cadre" normalisée
  photoImg.src = obj?.photo || dataUrl;
  cadreImg.src = (typeof getCadreUrl === "function") ? getCadreUrl(cadreActuel) : "";

  const popup = document.getElementById("popup-photo");
  if (popup) { popup.classList.remove("hidden"); popup.classList.add("show"); }

  const btnAimer = document.getElementById("btn-aimer-photo");
  if (!btnAimer) return;

  const isLiked = (list, id) => list.findIndex(x => x.defiId === id) !== -1;

  // état initial
  let aimes = [];
  try { aimes = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]"); } catch {}
  btnAimer.classList.toggle("active", isLiked(aimes, defiId));

  // toggle
  btnAimer.onclick = () => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]"); } catch {}

    const i = list.findIndex(x => x.defiId === defiId);
    if (i === -1) {
      if (!obj?.photo) return alert("Photo introuvable pour ce défi.");
      list.push({
        defiId,
        imageDataUrl: obj.photo,              // image finale (déjà collée)
        cadre: obj.cadre || cadreActuel,
        date: Date.now(),
        mode: "solo"
      });
      btnAimer.classList.add("active");
    } else {
      list.splice(i, 1);
      btnAimer.classList.remove("active");
    }
    localStorage.setItem("photos_aimees_obj", JSON.stringify(list));
  };
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
  // Premium : pas de pub reward (bloquée) — on propose juste l’achat ou rien
  const noAds = await (window.hasNoAds?.() || window.isPremium?.());
  const jetons = await window.getJetons();
  if (jetons > 0) {
    if (confirm("Valider ce défi avec 1 jeton ?")) {
      // ⚠️ SÉCURISÉ : décrémente via RPC server-side
      const { data, error } = await window.supabase.rpc('secure_remove_jeton', { nb: 1 });
      if (error || !data || data.success !== true) {
        alert("Erreur lors de la soustraction du jeton ou plus de jetons dispo !");
        return;
      }
      // Marque le défi comme validé
      await validerDefiAvecJeton(index);
      // Recharge le profil pour afficher le solde à jour
      await chargerUserData(true);
      majSolde?.();
      window.location.reload();
    }
  } else {
    if (noAds) {
      alert("Tu es en Premium (pas de pub). Obtiens des jetons via la boutique.");
      return;
    }
    if (confirm("Plus de jeton. Regarder une pub pour gagner 1 jeton ?")) {
      const ok = await window.showRewardedAd(); // bloquée automatiquement si Premium
      if (ok !== false) {
        try {
          // ⚠️ SÉCURISÉ : crédite via RPC server-side
          const { data, error } = await window.supabase.rpc('secure_add_jetons', { nb: 1 });
          if (error || !data || data.success !== true) throw error || new Error('secure_add_jetons a échoué');
          // refresh profil + UI
          await chargerUserData(true);
          majSolde?.();
          alert("1 jeton crédité !");
        } catch (e) {
          alert("Erreur lors du crédit de jeton: " + (e?.message || e));
        }
      }
    }
  }
};


// ----------- FIN DE PARTIE AUTOMATIQUE -----------
window.endGameAuto = async function() {
  let defis = JSON.parse(localStorage.getItem(SOLO_DEFIS_KEY) || "[]");
  if (!defis.length) return;

  // x2 pièces par défi si Premium
  let premium = false;
  try { premium = await (window.isPremium?.() || window.hasNoAds?.()); } catch (_) {}
  const perDefi = premium ? 20 : 10;

  let nbFaits = defis.filter(d => d.done).length;
  let gain = nbFaits * perDefi;
  if (nbFaits === 3) gain += 10; // bonus final inchangé

  // -------- SECURE CREDIT POINTS --------
  await chargerUserData(true);
  try {
    const { data, error } = await window.supabase.rpc('secure_add_points', { nb: gain });
    if (error || !data || data.success !== true) {
      console.error("[SOLO] secure_add_points KO:", error || data);
      // on continue sans throw pour au moins nettoyer la partie et afficher la popup
    }
  } catch (e) {
    console.error("[SOLO] secure_add_points exception:", e);
  }

  // Historique uniquement (pas d'écriture directe sur points/jetons)
  const date = new Date().toISOString().slice(0, 10);
  let historique = Array.isArray(userData?.historique) ? [...userData.historique] : [];
  historique.push({ date, defi: defis.map(d => d.id) });
  try {
    await window.updateUserData({ historique });
  } catch (e) {
    console.warn("[SOLO] updateUserData(historique) KO:", e?.message || e);
  }

  // Nettoyage partie locale
  localStorage.removeItem(SOLO_DEFIS_KEY);
  localStorage.removeItem(SOLO_TIMER_KEY);

  // UI popup fin de partie
  const endMsg = document.getElementById("end-message");
  if (endMsg) endMsg.textContent = `Partie terminée ! Tu as validé ${nbFaits}/3 défis.`;

  const gainMsg = document.getElementById("gain-message");
  if (gainMsg) gainMsg.textContent = `+${gain} pièces (${nbFaits} défi${nbFaits>1?"s":""} x${perDefi}${nbFaits===3?" +10 bonus":""})`;

  const popupEnd = document.getElementById("popup-end");
  if (popupEnd) {
    popupEnd.classList.remove("hidden");
    popupEnd.classList.add("show");
  }
  console.log(`[SOLO] Fin de partie auto. nb faits: ${nbFaits} / gain: ${gain}`);

  // Refresh solde affiché
  await chargerUserData(true);
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

  // ----------- BONUS : BOUTONS POPUP REPRISE SOLO -----------
  const btnPubRepriseSolo = document.getElementById("btnReprisePubSolo");
  const btnAnnulerRepriseSolo = document.getElementById("btnAnnulerRepriseSolo");
  const btnPremiumSolo = document.getElementById("btnReprisePremiumSolo");
  const popupRepriseSolo = document.getElementById("popup-reprise-photo-solo");

  if (btnPubRepriseSolo && btnAnnulerRepriseSolo && btnPremiumSolo && popupRepriseSolo) {
    btnPubRepriseSolo.addEventListener("click", async () => {
      await window.showRewardedAd(); // bloqué pour Premium
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

// ----------- SIMULATION/WRAP PUB REWARDED (utilise pub.js) -----------
window.showRewardedAd = async function() {
  return new Promise((resolve) => {
    if (typeof window.showRewarded === 'function') {
      window.showRewarded((ok) => resolve(!!ok));
      return;
    }
    // Fallback dev
    alert("SIMULATION PUB : regarde ta vidéo ici…");
    setTimeout(() => { resolve(true); }, 1800);
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
    try { photoData = JSON.parse(localStorage.getItem(`photo_defi_${defiId}`)); } catch (e) {}

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

// ----------- Changement de langue (solo) -----------
// Variante "ne change PAS les défis en cours" (seulement le cache pour les prochaines parties)
window.refreshDefisLangueSolo = async function() {
  const L = getLangParam();
  await chargerDefis(L);  // met à jour le cache
  // si tu veux aussi rafraîchir l’UI globale de l’app : window.setLang?.(L);
};
