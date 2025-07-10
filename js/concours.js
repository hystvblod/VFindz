// ========= DÉBUT : Variables et Protection globales ===========
window.showAd = window.showAd || (() => Promise.resolve());
window.userIsPremium = window.userIsPremium || false;
window.userId = window.userId || null;

const URL_CONCOURS = "https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/concours//concours.json";
const PAGE_SIZE = 30;

let loadedCount = 0;
let loadingMore = false;
let endOfPhotos = false;
let scrollPhotos = []; // Liste filtrée pour scroll infini

// ----------- SYSTEME ACCES/REWARD/VOTES -----------
const VOTES_PAR_REWARD = () => (window.userIsPremium ? 6 : 3);
function getVotesCycleKey() { return 'concours_vote_cycle_' + getConcoursDateStr(); }
function getVotesLeft() {
  const d = JSON.parse(localStorage.getItem(getVotesCycleKey()) || '{}');
  return d?.left ?? 0;
}
function setVotesLeft(left) {
  localStorage.setItem(getVotesCycleKey(), JSON.stringify({ left }));
}
function resetVotesCycle() {
  setVotesLeft(VOTES_PAR_REWARD());
  localStorage.setItem('concours_reward_done_' + getConcoursDateStr(), '1');
  localStorage.setItem('concours_recharge_done_' + getConcoursDateStr(), '0');
}
function isRewardDone() {
  return localStorage.getItem('concours_reward_done_' + getConcoursDateStr()) === '1';
}
function isRechargeDone() {
  return localStorage.getItem('concours_recharge_done_' + getConcoursDateStr()) === '1';
}
function setRechargeDone() {
  localStorage.setItem('concours_recharge_done_' + getConcoursDateStr(), '1');
}

// ----------- UTILS DATE/TOP 6 LOCAL -----------
function getConcoursDateStr() {
  return new Date().toISOString().slice(0, 10);
}
function getTop6CacheKey() {
  return 'top6_concours_' + getConcoursDateStr();
}

// ----------- CACHE LOCAL DES PHOTOS -----------
function getConcoursPhotosCacheKey(concoursId) {
  return `concours_photos_cache_${concoursId}`;
}
function getConcoursPhotosCache(concoursId) {
  const data = localStorage.getItem(getConcoursPhotosCacheKey(concoursId));
  return data ? JSON.parse(data) : null;
}
function setConcoursPhotosCache(concoursId, data) {
  localStorage.setItem(getConcoursPhotosCacheKey(concoursId), JSON.stringify(data));
}

// ----------- TOP 6 STOCKAGE LOCAL -----------
async function fetchAndCacheTop6() {
  const concoursId = getConcoursId();
  const { data, error } = await window.supabase
    .from('photosconcours')
    .select('id, votes_total')
    .eq('concours_id', concoursId);
  if (error || !data) return [];
  data.sort((a, b) => b.votes_total - a.votes_total);
  const top6 = data.slice(0, 6).map(d => d.id);
  localStorage.setItem(getTop6CacheKey(), JSON.stringify(top6));
  return top6;
}
function getCachedTop6() {
  return JSON.parse(localStorage.getItem(getTop6CacheKey()) || "[]");
}

// ----------- VOTES & PHOTOS VOTEES LOCAL -----------
const VOTES_CONCOURS_CACHE_KEY = "votes_concours_cache";
const VOTES_CONCOURS_CACHE_TIME_KEY = "votes_concours_cache_time";
const VOTES_CONCOURS_CACHE_DURATION = 60 * 1000;

async function getVotesConcoursFromCacheOrDB(concoursId, force = false) {
  const now = Date.now();
  const cacheData = localStorage.getItem(VOTES_CONCOURS_CACHE_KEY);
  const cacheTime = localStorage.getItem(VOTES_CONCOURS_CACHE_TIME_KEY);

  if (!force && cacheData && cacheTime && now - cacheTime < VOTES_CONCOURS_CACHE_DURATION) {
    return JSON.parse(cacheData);
  }
  const { data, error } = await window.supabase
    .from('photosconcours')
    .select('id, votes_total')
    .eq('concours_id', concoursId);
  if (!error && data) {
    localStorage.setItem(VOTES_CONCOURS_CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(VOTES_CONCOURS_CACHE_TIME_KEY, now.toString());
    return data;
  }
  return [];
}
function majVotesConcoursAffichage(votesData) {
  votesData.forEach(vote => {
    document.querySelectorAll(`[data-photoid="${vote.id}"] .nbvotes`).forEach(el => {
      el.textContent = vote.votes_total;
    });
  });
}

// ----------- INFOS CONCOURS DYNAMIQUES -----------
async function chargerInfosConcours() {
  try {
    const res = await fetch(URL_CONCOURS + "?t=" + Date.now());
    const data = await res.json();
    const titreElt = document.querySelector('.titre-concours');
    if (titreElt && data.titre) titreElt.textContent = data.titre;
    const lotElt = document.getElementById('lot-concours');
    if (lotElt && data.lot) lotElt.textContent = data.lot;
    if (data.timer_fin) majTimerConcours(data.timer_fin);
  } catch (e) {
    console.error("Erreur chargement infos concours", e);
  }
}
function majTimerConcours(finIso) {
  let timerElt = document.getElementById("timer-concours");
  let votesElt = document.getElementById("votes-restants");
  if (!timerElt || !votesElt) return;

  function update() {
    const now = new Date();
    const fin = new Date(finIso);
    let diff = Math.floor((fin - now) / 1000);
    if (diff < 0) {
      timerElt.textContent = "Concours terminé !";
      votesElt.textContent = "";
      clearInterval(timerElt._timer);
      return;
    }
    const jours = Math.floor(diff / 86400); diff -= jours * 86400;
    const heures = Math.floor(diff / 3600); diff -= heures * 3600;
    const minutes = Math.floor(diff / 60);
    const secondes = diff % 60;
    timerElt.textContent =
      "Fin dans " + (jours > 0 ? jours + "j " : "") +
      (heures < 10 ? "0" : "") + heures + "h " +
      (minutes < 10 ? "0" : "") + minutes + "m " +
      (secondes < 10 ? "0" : "") + secondes + "s";
    // ➡️ Affiche les votes restants
    const votesLeft = getVotesLeft();
    votesElt.textContent = `Votes restants : ${votesLeft} / ${VOTES_PAR_REWARD()}`;
  }
  update();
  timerElt._timer && clearInterval(timerElt._timer);
  timerElt._timer = setInterval(update, 1000);
}

// ----------- ID DE CONCOURS (par semaine) -----------
function getConcoursId() {
  const now = new Date();
  const year = now.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const days = Math.floor((now - firstJan) / 86400000);
  const week = Math.ceil((days + firstJan.getDay() + 1) / 7);
  return `${week}-${year}`;
}

// ----------- PHOTOS CONCOURS, TRI ET CACHE -----------
async function getPhotosAPaginer(forceReload = false) {
  const concoursId = getConcoursId();
  let allPhotos;
  if (!forceReload) {
    allPhotos = getConcoursPhotosCache(concoursId);
    if (!allPhotos) forceReload = true;
  }
  if (forceReload) {
    const { data } = await window.supabase
      .from('photosconcours')
      .select('*')
      .eq('concours_id', concoursId);
    allPhotos = data || [];
    setConcoursPhotosCache(concoursId, allPhotos);
  }
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id;
  const photoJoueur = allPhotos.find(p => p.user_id === userId);

  let uniqueSet = new Set();
  let orderedPhotos = [];
  if (photoJoueur && !uniqueSet.has(photoJoueur.id)) {
    orderedPhotos.push(photoJoueur);
    uniqueSet.add(photoJoueur.id);
  }
  for (const p of allPhotos) {
    if (!uniqueSet.has(p.id)) {
      orderedPhotos.push(p);
      uniqueSet.add(p.id);
    }
  }
  return { allPhotos, orderedPhotos };
}

// ----------- MAPPING USER_ID -> PSEUDO -----------
async function getPseudoMapFromPhotos(photos) {
  const userIds = [...new Set(photos.map(p => p.user_id).filter(Boolean))];
  if (!userIds.length) return {};
  const { data, error } = await window.supabase
    .from('users')
    .select('id, pseudo')
    .in('id', userIds);
  if (error || !data) return {};
  const map = {};
  data.forEach(u => { map[u.id] = u.pseudo; });
  return map;
}

// ----------- FILTRAGE RECHERCHE PSEUDO -----------
function filtrerPhotosParPseudo(photos, search, pseudoMap = {}) {
  if (!search) return photos;
  const query = search.trim().toLowerCase();
  return photos.filter(p => (pseudoMap[p.user_id] || p.pseudo || p.user || "").toLowerCase().includes(query));
}

// ============ AFFICHAGE PRINCIPAL =============
window.afficherGalerieConcours = async function(forceReload = false) {
  if (!isRewardDone()) {
    await showConcoursRewardPopup();
    return;
  }
  const galerie = document.getElementById("galerie-concours");
  galerie.innerHTML = "<div style='text-align:center;color:#888;'>Chargement...</div>";
  galerie.classList.add("grid-cadres");

  let { allPhotos, orderedPhotos } = await getPhotosAPaginer(forceReload);

  const concoursId = getConcoursId();
  const votesData = await getVotesConcoursFromCacheOrDB(concoursId);
  const votesMap = {};
  votesData.forEach(v => votesMap[v.id] = v.votes_total);

  const pseudoMap = await getPseudoMapFromPhotos(orderedPhotos);

  // Recherche dynamique avec pseudoMap
  const inputSearch = document.getElementById('recherche-pseudo-concours');
  const resultatsElt = document.getElementById('resultats-recherche-concours');
  let search = (inputSearch && inputSearch.value) || "";
  let filteredOrderedPhotos = filtrerPhotosParPseudo(orderedPhotos, search, pseudoMap);

  // ----------- INIT SCROLL INFINI -----------
  loadedCount = 0;
  endOfPhotos = false;
  scrollPhotos = filteredOrderedPhotos;

  // Vide la galerie et ajoute la grille
  galerie.innerHTML = `<div class="grid-photos-concours"></div>`;

  // Charge la première "page"
  await renderConcoursPhotosPage(votesMap, pseudoMap);

  // Scroll infini (une seule fois)
  const grid = galerie.querySelector('.grid-photos-concours');
  if (!galerie._scrollListenerAdded) {
    galerie.addEventListener('scroll', async function() {
      if (endOfPhotos || loadingMore) return;
      if (galerie.scrollTop + galerie.clientHeight >= galerie.scrollHeight - 40) {
        await renderConcoursPhotosPage(votesMap, pseudoMap);
      }
    });
    galerie._scrollListenerAdded = true;
  }

  // ======= ANCIEN BLOC VOTES RESTANTS SUPPRIMÉ ICI =======

  // Résultats recherche
  if (resultatsElt)
    resultatsElt.textContent = `(${filteredOrderedPhotos.length} résultat${filteredOrderedPhotos.length > 1 ? 's' : ''})`;

  // Recharge votes event
  const btnRecharge = document.getElementById('btn-recharge-votes');
  if (btnRecharge) {
    btnRecharge.onclick = async () => {
      if (!isRechargeDone()) {
        await window.showAd();
        resetVotesCycle();
        setRechargeDone();
        window.afficherGalerieConcours(true);
      }
    }
  }
}

// ----------- Affiche 30 photos de plus à chaque appel -----------
async function renderConcoursPhotosPage(votesMap, pseudoMap) {
  const grid = document.querySelector("#galerie-concours .grid-photos-concours");
  if (!grid) return;
  loadingMore = true;
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id;
  const start = loadedCount;
  const end = Math.min(start + PAGE_SIZE, scrollPhotos.length);

  for (let i = start; i < end; i++) {
    const photo = scrollPhotos[i];
    const html = creerCartePhotoHTML(
      photo,
      pseudoMap[photo.user_id] || "?",
      photo.user_id === userId,
      votesMap[photo.id] ?? photo.votes_total
    );
    const div = document.createElement('div');
    div.innerHTML = html;
    div.firstElementChild.onclick = function() {
      ouvrirPopupZoomConcours(photo, pseudoMap[photo.user_id] || "?", votesMap[photo.id] ?? photo.votes_total);
    }
    grid.appendChild(div.firstElementChild);
  }
  loadedCount = end;
  if (loadedCount >= scrollPhotos.length) endOfPhotos = true;
  loadingMore = false;

  // Rafraîchit le nombre de votes affiché (si nouveaux votes)
  majVotesConcoursAffichage(Object.values(votesMap));
}

// ----------- GÉNÈRE UNE CARTE HTML (polaroïd, pseudo dynamique) -----------
function creerCartePhotoHTML(photo, pseudo, isPlayer, nbVotes) {
  const cadreId = photo.cadre_id || "polaroid_01";
  let cadreUrl = cadreId.startsWith("http")
    ? cadreId
    : `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadreId}.webp`;

  return `
    <div class="cadre-item${isPlayer ? ' joueur-photo' : ''}" data-photoid="${photo.id}">
      <div class="cadre-preview">
        <img class="photo-cadre" src="${cadreUrl}">
        <img class="photo-user" src="${photo.photo_url}">
        <div class="photo-concours-coeur" style="position:absolute;right:7px;top:7px;z-index:10;">
          <img src="assets/icons/coeur.svg" alt="Vote" style="width:19px;height:19px;vertical-align:middle;">
          <span class="nbvotes" style="margin-left:4px;color:#ffe04a;font-weight:bold;font-size:1.01em;">${typeof nbVotes !== "undefined" ? nbVotes : photo.votes_total}</span>
        </div>
      </div>
      <div class="pseudo-miniature" style="color:#fff;text-align:center;font-size:1.08em;font-weight:500;margin-bottom:2px;margin-top:5px;letter-spacing:.04em;opacity:.94;">${pseudo || "?"}</div>
    </div>
  `;
}

// ----------- POPUP ZOOM STYLE DUEL, pseudo dynamique -----------
// Signature adaptée pour recevoir le pseudo (nickel pour tout afficher propre)
async function ouvrirPopupZoomConcours(photo, pseudo = "?", votesTotal = 0) {
  let old = document.getElementById("popup-photo");
  if (old) old.remove();

  const cadreId = photo.cadre_id || "polaroid_01";
  let cadreUrl = cadreId.startsWith("http")
    ? cadreId
    : (await window.getCadreUrl
        ? await window.getCadreUrl(cadreId)
        : `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadreId}.webp`);
  const votesLeft = getVotesLeft();

  const popup = document.createElement("div");
  popup.id = "popup-photo";
  popup.className = "popup show";
  popup.innerHTML = `
    <div class="popup-inner">
      <div class="photo-popup-buttons" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; position: absolute; top: 0; left: 0; right: 0; z-index: 10;">
        <button id="btn-voter-photo" style="background: none; border: none; padding: 0;" ${votesLeft <= 0 ? "disabled" : ""}>
          <img src="assets/icons/coeur.svg" style="width:32px; height:32px;" />
        </button>
        <button id="close-popup" style="background: none; border: none; padding: 0;">
          <img src="assets/icons/croix.svg" alt="Fermer" data-i18n-alt="button.close" style="width: 32px; height: 32px;margin-top:-5px;" />
        </button>
      </div>
      <div class="cadre-preview cadre-popup boutique-style" data-photoid="...">
        <img class="photo-cadre" src="${cadreUrl}">
        <img class="photo-user" src="${photo.photo_url}">
      </div>
      <div style="margin:18px 0 2px 0; color:#ffe04a; font-size:1.09em; font-weight:500; text-align:center; display:flex; justify-content:center; align-items:center; gap:12px;">
        <span class="pseudo-solo">${pseudo}</span>
        <span class="nbvotes" style="color:#ffe04a; font-weight:700; font-size:1em; background:#48307033; border-radius:7px; padding:2px 9px 2px 7px; margin-left:4px; display:flex; align-items:center;">
          <img src="assets/icons/coeur.svg" style="width:16px;height:16px;margin-right:4px;vertical-align:middle;" />
          ${votesTotal}
        </span>
      </div>
      <div style="margin-top:7px;color:#aaa;font-size:0.97em;text-align:center;">
        Votes restants aujourd'hui&nbsp;: <b>${votesLeft}</b> / ${VOTES_PAR_REWARD()}
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  popup.querySelector("#close-popup").onclick = () => popup.remove();
  if (votesLeft > 0) {
    popup.querySelector("#btn-voter-photo").onclick = async function() {
      await votePourPhoto(photo.id);
      popup.remove();
      window.afficherGalerieConcours(true);
    };
  }
}


// ----------- VOTE POUR PHOTO (max votes par cycle, sécurisé RPC) -----------
async function votePourPhoto(photoId) {
  let left = getVotesLeft();
  if (left <= 0) {
    alert("Plus de votes aujourd'hui. Recharge pour en avoir d'autres !");
    return;
  }

  // LOG AVANT L'APPEL
  console.log("DEBUG VOTE", {
    userId: window.userId,
    photoId: photoId,
    cycle: 1
  });

  // STOCKE LE RESULTAT DANS UNE VARIABLE POUR LE LOG
  const res = await window.supabase.rpc("concours_vote", {
    p_user_id: window.userId,
    p_photo_id: photoId,
    p_cycle: 1
  });

  // LOG LE RESULTAT COMPLET
  console.log("ERREUR VOTE", res.error, res.data);

  if (res.error) {
    alert("Erreur lors du vote");
    return;
  }

  left -= 1;
  setVotesLeft(left);
  setConcoursPhotosCache(getConcoursId(), []);
}

// ----------- PARTICIPATION PHOTO -----------
window.ajouterPhotoConcours = async function() {
  const concoursId = getConcoursId();
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id || "Inconnu";
  const pseudo = user.data?.user?.user_metadata?.pseudo || userId;
  const premium = user.data?.user?.user_metadata?.premium || false;
  const cadre_id = await window.getCadreSelectionne ? await window.getCadreSelectionne() : "polaroid_01";

  const photo_url = await window.ouvrirCameraPour(concoursId, "concours");
  if (!photo_url) return;

  try {
    const { error } = await window.supabase
      .from('photosconcours')
      .insert([{
        concours_id: concoursId,
        photo_url,
        user_id: userId,
        pseudo,
        votes_total: 0,
        premium: !!premium,
        cadre_id
      }]);
    if (error) throw error;
    setConcoursPhotosCache(concoursId, []);
  } catch (e) {
    alert("Erreur lors de l'ajout de la photo au concours.");
    console.error(e);
  }
}

// ----------- POPUP REWARD A L’OUVERTURE -----------
async function showConcoursRewardPopup() {
  return new Promise(resolve => {
    const popup = document.createElement("div");
    popup.className = "popup show";
popup.innerHTML = `
  <div style="background:#fff;border-radius:18px;padding:36px 24px 32px 24px;max-width:340px;margin:auto;text-align:center;">
    <div style="font-size:1.23em;font-weight:bold;margin-bottom:16px;">Concours Photo</div>
    <div style="color:#555;margin-bottom:19px;">
      Pour accéder au concours, regarde une pub pour débloquer <span style="color:#f90">${VOTES_PAR_REWARD()} votes</span> aujourd’hui${window.userIsPremium ? " (x2 si premium)" : ""}.
    </div>
    <button id="btnRewardConcours" class="main-button" style="margin-top:12px;">Regarder une pub</button>
  </div>
`;
    document.body.appendChild(popup);
    popup.querySelector("#btnRewardConcours").onclick = async () => {
      await window.showAd();       // ← affiche la pub rewarded (branché sur AppLovin via pub.js)
      resetVotesCycle();           // ← débloque les votes
      popup.remove();
      resolve();
    };
  });
}

// ----------- INITIALISATION : set userId/premium -----------
document.addEventListener("DOMContentLoaded", async () => {
  await chargerInfosConcours();

  const user = await window.supabase.auth.getUser();
  window.userId = user.data?.user?.id || null;
  window.userIsPremium = !!user.data?.user?.user_metadata?.premium;

  async function checkTop6Minuit() {
    const lastTop6 = localStorage.getItem(getTop6CacheKey() + "_date");
    const today = getConcoursDateStr();
    if (lastTop6 !== today) {
      await fetchAndCacheTop6();
      localStorage.setItem(getTop6CacheKey() + "_date", today);
    }
  }
  await checkTop6Minuit();

  const participerBtn = document.getElementById("participerBtn");
  if (participerBtn) {
    participerBtn.addEventListener("click", async () => {
      await window.ajouterPhotoConcours();
      window.afficherGalerieConcours(true);
    });
  }

  const inputSearch = document.getElementById("recherche-pseudo-concours");
  if (inputSearch) {
    inputSearch.addEventListener("input", () => {
      window.afficherGalerieConcours();
    });
  }

  window.afficherGalerieConcours();
});
