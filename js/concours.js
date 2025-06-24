// ========= DÉBUT : Variables et Protection globales ===========

// Sécurise les variables globales pour éviter undefined
window.showAd = window.showAd || (() => Promise.resolve());
window.userIsPremium = window.userIsPremium || false;
window.userId = window.userId || null;

const URL_CONCOURS = "https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/concours//concours.json";
const PAGE_SIZE = 30;

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
  if (!timerElt) {
    timerElt = document.createElement("div");
    timerElt.id = "timer-concours";
    timerElt.style = "text-align:center;font-size:1.13em;color:#fff;padding:7px 0;font-weight:600;";
    const main = document.querySelector("main");
    main.insertBefore(timerElt, main.children[2]);
  }
  function update() {
    const now = new Date();
    const fin = new Date(finIso);
    let diff = Math.floor((fin - now) / 1000);
    if (diff < 0) {
      timerElt.textContent = "Concours terminé !";
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

// ----------- PHOTOS CONCOURS, TRI ET PAGINATION + CACHE -----------
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

// ----------- GÉNÉRATION PAGINATION -----------
function getPagePhotos(orderedPhotos, page = 1, pageSize = PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return orderedPhotos.slice(start, start + pageSize);
}

// ----------- FILTRAGE RECHERCHE PSEUDO -----------
function filtrerPhotosParPseudo(photos, search, pseudoMap = {}) {
  if (!search) return photos;
  const query = search.trim().toLowerCase();
  return photos.filter(p => (pseudoMap[p.user_id] || p.pseudo || p.user || "").toLowerCase().includes(query));
}

let currentPage = 1;

// ============ AFFICHAGE PRINCIPAL =============
window.afficherGalerieConcours = async function(forceReload = false) {
  // Protection : ACCES seulement si pub reward faite ce jour
  if (!isRewardDone()) {
    await showConcoursRewardPopup();
    return;
  }
  const galerie = document.getElementById("galerie-concours");
  galerie.innerHTML = "<div style='text-align:center;color:#888;'>Chargement...</div>";
  galerie.classList.add("grid-cadres");

  let { allPhotos, orderedPhotos } = await getPhotosAPaginer(forceReload);

  // Votes
  const concoursId = getConcoursId();
  const votesData = await getVotesConcoursFromCacheOrDB(concoursId);
  const votesMap = {};
  votesData.forEach(v => votesMap[v.id] = v.votes_total);

  // Pseudos dynamiques (toujours à jour)
  const pseudoMap = await getPseudoMapFromPhotos(orderedPhotos);

  // Recherche dynamique avec pseudoMap
  const inputSearch = document.getElementById('recherche-pseudo-concours');
  const resultatsElt = document.getElementById('resultats-recherche-concours');
  let search = (inputSearch && inputSearch.value) || "";
  let filteredOrderedPhotos = filtrerPhotosParPseudo(orderedPhotos, search, pseudoMap);

  // Pagination
  const paginatedPhotos = getPagePhotos(filteredOrderedPhotos, currentPage, PAGE_SIZE);

  // Affichage grille
  let html = `<div class="grid-photos-concours">`;
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id;
  for (const photo of paginatedPhotos) {
    html += creerCartePhotoHTML(photo, pseudoMap[photo.user_id] || "?", photo.user_id === userId, votesMap[photo.id] ?? photo.votes_total);
  }
  html += `</div>`;

  // Pagination
  const totalPages = Math.ceil(filteredOrderedPhotos.length / PAGE_SIZE);
  html += `<div style="text-align:center;margin-bottom:20px;">`;
  if (currentPage > 1)
    html += `<button id="btn-prev" class="main-button" style="margin-right:16px;">&larr; Précédent</button>`;
  html += `<span style="font-size:1.02em;">Page ${currentPage} / ${totalPages}</span>`;
  if (currentPage < totalPages)
    html += `<button id="btn-next" class="main-button" style="margin-left:16px;">Suivant &rarr;</button>`;
  html += `</div>`;

  // Bloc recharge votes
  const votesLeft = getVotesLeft();
  html += `
    <div style="text-align:center;margin:16px 0;">
      <span style="font-size:1.04em;color:#444;font-weight:500;">
        Votes restants : <b>${votesLeft}</b> / ${VOTES_PAR_REWARD()}
      </span>
      <br>
      <button id="btn-recharge-votes" class="main-button" style="margin-top:10px;${(votesLeft>0||isRechargeDone())?"display:none;":""}">
        <img src="assets/icons/reward.svg" style="height: 22px; margin-right: 7px;">
        Regarder une pub pour recharger les votes
      </button>
    </div>
  `;

  if (resultatsElt)
    resultatsElt.textContent = `(${filteredOrderedPhotos.length} résultat${filteredOrderedPhotos.length > 1 ? 's' : ''})`;

  galerie.innerHTML = html;

  majVotesConcoursAffichage(votesData);

  // Pagination events
  if (document.getElementById('btn-prev'))
    document.getElementById('btn-prev').onclick = () => { currentPage--; window.afficherGalerieConcours(); }
  if (document.getElementById('btn-next'))
    document.getElementById('btn-next').onclick = () => { currentPage++; window.afficherGalerieConcours(); }

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

  // Events zoom/vote popup (photo-cadre clique)
  Array.from(document.querySelectorAll('.photo-concours-img-wrapper')).forEach(div => {
    div.onclick = function() {
      const photoId = this.dataset.photoid;
      const photo = allPhotos.find(p => p.id == photoId);
      if (photo) ouvrirPopupZoomConcours(photo, pseudoMap[photo.user_id] || "?", votesMap[photo.id] ?? photo.votes_total);
    };
  });
};

// ----------- GÉNÈRE UNE CARTE HTML (polaroïd, pseudo dynamique) -----------
function creerCartePhotoHTML(photo, pseudo, isPlayer, nbVotes) {
  return `
    <div class="cadre-item${isPlayer ? ' joueur-photo' : ''}">
      <div class="photo-concours-img-wrapper" data-photoid="${photo.id}" style="position:relative;cursor:pointer;">
        <img src="${photo.photo_url}" class="photo-concours-img" style="width:100%;border-radius:10px;background:#f9f9fa;">
        <div class="photo-concours-coeur" style="position:absolute;right:7px;top:7px;">
          <img src="assets/icons/coeur.svg" alt="Vote" style="width:22px;height:22px;vertical-align:middle;opacity:1;">
          <span class="nbvotes" style="margin-left:5px;color:#ffe04a;font-weight:bold;">${typeof nbVotes !== "undefined" ? nbVotes : photo.votes_total}</span>
        </div>
      </div>
      <div class="cadre-item">${pseudo || "?"}</div>
    </div>
  `;
}

// ----------- POPUP ZOOM STYLE DUEL, pseudo dynamique -----------
async function ouvrirPopupZoomConcours(photo, pseudo, votesTotal = 0) {
  let old = document.getElementById("popup-photo-zoom");
  if (old) old.remove();
  const cadreId = photo.cadre_id || "polaroid_01";
  let cadreUrl = cadreId.startsWith("http")
    ? cadreId
    : (await window.getCadreUrl
        ? await window.getCadreUrl(cadreId)
        : `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadreId}.webp`);
  const votesLeft = getVotesLeft();

  const popup = document.createElement("div");
  popup.id = "popup-photo-zoom";
  popup.className = "popup show";

  popup.innerHTML = `
    <div class="popup-inner">
      <button id="close-popup-zoom" class="close-btn" style="position:absolute;top:10px;right:14px;">
        <img src="assets/icons/close.svg" style="width:24px;" />
      </button>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="cadre-preview cadre-popup" style="margin-bottom:18px;position:relative;">
          <img class="photo-cadre" src="${cadreUrl}">
          <img class="photo-user" src="${photo.photo_url}">
        </div>
        <div class="pseudo-solo">${pseudo}</div>
        <button class="vote-coeur-btn"
                style="margin:22px auto 0 auto;display:flex;align-items:center;background:none;border:none;"
                ${votesLeft <= 0 ? "disabled" : ""} data-photoid="${photo.id}">
          <img src="assets/icons/coeur.svg"
               style="width:38px;vertical-align:middle;cursor:pointer;" alt="Voter"/>
          <span style="margin-left:8px;color:#ffe04a;font-weight:bold;font-size:1.13em;">Voter</span>
          <span class="nbvotes"
                style="margin-left:12px;color:#ffe04a;font-weight:bold;font-size:1.03em;">${votesTotal}</span>
        </button>
        <div style="margin-top:7px;color:#aaa;font-size:0.97em;">
          Votes restants aujourd'hui&nbsp;: <b>${votesLeft}</b> / ${VOTES_PAR_REWARD()}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Fermer la popup sur croix
  popup.querySelector("#close-popup-zoom").onclick = () => popup.remove();

  // Gérer le vote
  if (votesLeft > 0) {
    popup.querySelector(".vote-coeur-btn").onclick = async function() {
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
  // Exécute la procédure stockée sécurisée (exemple : concours_vote)
  const { error } = await window.supabase.rpc("concours_vote", {
    p_user_id: window.userId,
    p_photo_id: photoId,
    p_cycle: 1 // ou autre si besoin : pour support recharge, voir plus bas
  });
  if (error) {
    alert("Erreur lors du vote");
    return;
  }
  left -= 1;
  setVotesLeft(left);
  setConcoursPhotosCache(getConcoursId(), []); // Vide le cache photos pour forcer reload avec votes à jour
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
        <img src="assets/icons/gift.svg" style="width:62px;margin-bottom:18px;" />
        <div style="font-size:1.23em;font-weight:bold;margin-bottom:16px;">Concours Photo</div>
        <div style="color:#555;margin-bottom:19px;">
          Pour accéder au concours, merci de regarder une pub. Ça finance le lot et te donne <span style="color:#f90">${VOTES_PAR_REWARD()} votes</span> à utiliser aujourd’hui${window.userIsPremium ? " (x2 si premium)" : ""}.
        </div>
        <button id="btnRewardConcours" class="main-button" style="margin-top:12px;">Regarder une pub</button>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector("#btnRewardConcours").onclick = async () => {
      await window.showAd(); // Reward pub
      resetVotesCycle();
      popup.remove();
      resolve();
    };
  });
}

// ----------- INITIALISATION : set userId/premium -----------

document.addEventListener("DOMContentLoaded", async () => {
  await chargerInfosConcours();

  // Récupération de l'utilisateur connecté dès le début (pour sécurité RPC)
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
      currentPage = 1;
      window.afficherGalerieConcours(true);
    });
  }

  const inputSearch = document.getElementById("recherche-pseudo-concours");
  if (inputSearch) {
    inputSearch.addEventListener("input", () => {
      currentPage = 1;
      window.afficherGalerieConcours();
    });
  }

  window.afficherGalerieConcours();
});
