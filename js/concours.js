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
let concoursIdGlobal = null; // ID unique du concours

// ----------- SYSTEME ACCES/REWARD/VOTES -----------
const VOTES_PAR_REWARD = () => (window.userIsPremium ? 6 : 3);
function getVotesCycleKey() { return 'concours_vote_cycle_' + (concoursIdGlobal || ""); }
function getVotesLeft() {
  const d = JSON.parse(localStorage.getItem(getVotesCycleKey()) || '{}');
  return d?.left ?? 0;
}
function setVotesLeft(left) {
  localStorage.setItem(getVotesCycleKey(), JSON.stringify({ left }));
}
function resetVotesCycle() {
  setVotesLeft(VOTES_PAR_REWARD());
  localStorage.setItem('concours_reward_done_' + (concoursIdGlobal || ""), '1');
  localStorage.setItem('concours_recharge_done_' + (concoursIdGlobal || ""), '0');
}
function isRewardDone() {
  return localStorage.getItem('concours_reward_done_' + (concoursIdGlobal || "")) === '1';
}
function isRechargeDone() {
  return localStorage.getItem('concours_recharge_done_' + (concoursIdGlobal || "")) === '1';
}
function setRechargeDone() {
  localStorage.setItem('concours_recharge_done_' + (concoursIdGlobal || ""), '1');
}

// ----------- UTILS DATE/TOP 6 LOCAL -----------
function getConcoursDateStr() {
  return new Date().toISOString().slice(0, 10);
}
function getTop6CacheKey() {
  return 'top6_concours_' + (concoursIdGlobal || "");
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
  const concoursId = concoursIdGlobal;
  const { data, error } = await window.supabase
    .from('photosconcours')
    .select('id')
    .eq('concours_id', concoursId);
  if (error || !data) return [];
  const votesCountMap = await getVotesCountMapFromCacheOrDB(concoursId);
  data.sort((a, b) => (votesCountMap[b.id] || 0) - (votesCountMap[a.id] || 0));
  const top6 = data.slice(0, 6).map(d => d.id);
  localStorage.setItem(getTop6CacheKey(), JSON.stringify(top6));
  return top6;
}
function getCachedTop6() {
  return JSON.parse(localStorage.getItem(getTop6CacheKey()) || "[]");
}

// ----------- VOTES LIVE & CACHE LOCAL -----------
const VOTES_COUNT_CACHE_KEY = "votes_count_cache";
const VOTES_COUNT_CACHE_TIME_KEY = "votes_count_cache_time";
const VOTES_COUNT_CACHE_DURATION = 60 * 1000; // 1 min

async function getVotesCountMapFromCacheOrDB(concoursId, force = false) {
  const now = Date.now();
  const cacheData = localStorage.getItem(VOTES_COUNT_CACHE_KEY);
  const cacheTime = localStorage.getItem(VOTES_COUNT_CACHE_TIME_KEY);

  if (!force && cacheData && cacheTime && now - cacheTime < VOTES_COUNT_CACHE_DURATION) {
    return JSON.parse(cacheData);
  }
  const { data: allVotes, error } = await window.supabase
    .from('concours_votes')
    .select('photo_id')
    .eq('concours_id', concoursId);

  if (error) {
    console.error("Erreur récupération votes", error);
    return {};
  }

  const voteCountMap = {};
  (allVotes || []).forEach(v => {
    voteCountMap[v.photo_id] = (voteCountMap[v.photo_id] || 0) + 1;
  });

  localStorage.setItem(VOTES_COUNT_CACHE_KEY, JSON.stringify(voteCountMap));
  localStorage.setItem(VOTES_COUNT_CACHE_TIME_KEY, now.toString());
  return voteCountMap;
}

// ----------- INFOS CONCOURS DYNAMIQUES -----------
async function chargerInfosConcours() {
  try {
    const res = await fetch(URL_CONCOURS + "?t=" + Date.now());
    const data = await res.json();
    concoursIdGlobal = data.id; // <-- ID du concours actif (champ id dans le JSON)
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
      timerElt.textContent = window.t('concours.termine');
      votesElt.textContent = "";
      clearInterval(timerElt._timer);
      return;
    }
    const jours = Math.floor(diff / 86400); diff -= jours * 86400;
    const heures = Math.floor(diff / 3600); diff -= heures * 3600;
    const minutes = Math.floor(diff / 60);
    const secondes = diff % 60;

    // Affiche la durée avec clés i18n (avec ou sans jours)
    if (jours > 0) {
      timerElt.textContent = window.t('concours.fin_dans_jours', {
        jours,
        heures: heures.toString().padStart(2, "0"),
        minutes: minutes.toString().padStart(2, "0"),
        secondes: secondes.toString().padStart(2, "0")
      });
    } else {
      timerElt.textContent = window.t('concours.fin_dans_sans_jours', {
        heures: heures.toString().padStart(2, "0"),
        minutes: minutes.toString().padStart(2, "0"),
        secondes: secondes.toString().padStart(2, "0")
      });
    }

    // ➡️ Affiche les votes restants, clé i18n variable
    const votesLeft = getVotesLeft();
    votesElt.textContent = window.t('concours.votes_restants', {
      current: votesLeft,
      max: VOTES_PAR_REWARD()
    });
  }
  update();
  timerElt._timer && clearInterval(timerElt._timer);
  timerElt._timer = setInterval(update, 1000);
}

// ----------- PHOTOS CONCOURS, TRI ET CACHE -----------
async function getPhotosAPaginer(forceReload = false) {
  const concoursId = concoursIdGlobal;
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
  // Correction : si concours terminé, on n'affiche plus rien
  const concoursId = concoursIdGlobal;
  const timerElt = document.getElementById("timer-concours");
  if (timerElt && timerElt.textContent && timerElt.textContent.includes(window.t('concours.termine'))) {
    localStorage.removeItem(getConcoursPhotosCacheKey(concoursId));
    const galerie = document.getElementById("galerie-concours");
    if (galerie) {
      galerie.innerHTML = "<div style='text-align:center;color:#888;'>" + window.t('concours.termine') + "</div>";
    }
    return;
  }

  if (!isRewardDone()) {
    await showConcoursRewardPopup();
    return;
  }
  const galerie = document.getElementById("galerie-concours");
  galerie.innerHTML = "<div style='text-align:center;color:#888;'>Chargement...</div>";


  let { allPhotos, orderedPhotos } = await getPhotosAPaginer(forceReload);

  const votesCountMap = await getVotesCountMapFromCacheOrDB(concoursId, forceReload);
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
  await renderConcoursPhotosPage(votesCountMap, pseudoMap);

  // Scroll infini (une seule fois)
  const grid = galerie.querySelector('.grid-photos-concours');
  if (!galerie._scrollListenerAdded) {
    galerie.addEventListener('scroll', async function() {
      if (endOfPhotos || loadingMore) return;
      if (galerie.scrollTop + galerie.clientHeight >= galerie.scrollHeight - 40) {
        await renderConcoursPhotosPage(votesCountMap, pseudoMap);
      }
    });
    galerie._scrollListenerAdded = true;
  }

  // Résultats recherche
  if (resultatsElt)
    resultatsElt.textContent = window.t('concours.resultats', { n: filteredOrderedPhotos.length });

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
async function renderConcoursPhotosPage(votesCountMap, pseudoMap) {
  const grid = document.querySelector("#galerie-concours .grid-photos-concours");
  if (!grid) return;
  loadingMore = true;
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id;
  const start = loadedCount;
  const end = Math.min(start + PAGE_SIZE, scrollPhotos.length);

  for (let i = start; i < end; i++) {
    const photo = scrollPhotos[i];
    const nbVotes = votesCountMap[photo.id] || 0;
    const html = creerCartePhotoHTML(
      photo,
      pseudoMap[photo.user_id] || "?",
      photo.user_id === userId,
      nbVotes
    );
    const div = document.createElement('div');
    div.innerHTML = html;
    div.firstElementChild.onclick = function() {
      ouvrirPopupZoomConcours(photo, pseudoMap[photo.user_id] || "?", nbVotes);
    }
    grid.appendChild(div.firstElementChild);
  }
  loadedCount = end;
  if (loadedCount >= scrollPhotos.length) endOfPhotos = true;
  loadingMore = false;
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
          <span class="nbvotes" style="margin-left:4px;color:#ffe04a;font-weight:bold;font-size:1.01em;">${nbVotes}</span>
        </div>
      </div>
      <div class="pseudo-miniature" style="color:#fff;text-align:center;font-size:1.08em;font-weight:500;margin-bottom:2px;margin-top:5px;letter-spacing:.04em;opacity:.94;">${pseudo || "?"}</div>
    </div>
  `;
}

// ----------- POPUP ZOOM STYLE DUEL, pseudo dynamique -----------
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
    alert(window.t('concours.plus_de_votes'));
    return;
  }

  const concoursId = concoursIdGlobal;
  const today = new Date().toISOString().slice(0, 10);

  // Vérifie si déjà voté aujourd'hui pour cette photo
  const { data: dejaVote, error } = await window.supabase
    .from('concours_votes')
    .select('id, created_at')
    .eq('user_id', window.userId)
    .eq('photo_id', photoId)
    .eq('concours_id', concoursId)
    .gte('vote_date', today);

  if (!isRechargeDone() && dejaVote && dejaVote.length > 0) {
    alert(window.t('concours.deja_vote_auj'));
    return;
  }

  const res = await window.supabase.rpc("concours_vote", {
    p_user_id: window.userId,
    p_photo_id: photoId,
    p_cycle: 1
  });

  if (res.error) {
    alert(window.t('concours.erreur_vote'));
    return;
  }

  left -= 1;
  setVotesLeft(left);
  setConcoursPhotosCache(concoursId, []);
  localStorage.removeItem(VOTES_COUNT_CACHE_KEY);
  localStorage.removeItem(VOTES_COUNT_CACHE_TIME_KEY);
  window.afficherGalerieConcours(true); // Refresh!
}

// ----------- PARTICIPATION PHOTO (1 par concours, premium remplace) -----------
window.ajouterPhotoConcours = async function() {
  const concoursId = concoursIdGlobal;
  const user = await window.supabase.auth.getUser();
  const userId = user.data?.user?.id || "Inconnu";
  const pseudo = user.data?.user?.user_metadata?.pseudo || userId;
  const premium = user.data?.user?.user_metadata?.premium || false;
  const cadre_id = await window.getCadreSelectionne ? await window.getCadreSelectionne() : "polaroid_01";

  // Vérifie si déjà une photo pour ce concours et cet utilisateur
  const { data: dejaPhoto, error: errCheck } = await window.supabase
    .from('photosconcours')
    .select('*')
    .eq('concours_id', concoursId)
    .eq('user_id', userId);

  if (dejaPhoto && dejaPhoto.length > 0) {
    if (!premium) {
      alert(window.t('concours.participation_une_fois'));
      return;
    } else {
      if (!confirm(window.t('concours.popup_replace_photo'))) {
        return;
      }
      // Supprime ancienne photo du bucket Supabase
      const oldPhoto = dejaPhoto[0];
      if (oldPhoto.photo_url && oldPhoto.photo_url.includes("/storage/v1/object/public/")) {
        const path = oldPhoto.photo_url.split("/storage/v1/object/public/")[1];
        try {
          await window.supabase.storage.from('photosconcours').remove([path]);
        } catch (err) {
          console.warn("Suppression bucket échouée :", err);
        }
      }
      await window.supabase.from('photosconcours').delete().eq('id', oldPhoto.id);
    }
  }

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
    alert(window.t('concours.erreur_ajout_photo'));
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
          ${window.t('concours.popup_pub')} <span style="color:#f90">${VOTES_PAR_REWARD()} votes</span> ${window.t('concours.popup_aujourdhui')}${window.userIsPremium ? " (x2 si premium)" : ""}.
        </div>
        <button id="btnRewardConcours" class="main-button" style="margin-top:12px;">${window.t('concours.btn_regarder_pub')}</button>
      </div>
    `;
    document.body.appendChild(popup);
    popup.querySelector("#btnRewardConcours").onclick = async () => {
      await window.showAd();
      resetVotesCycle();
      popup.remove();
      resolve();
    };
  });
}

// ----------- INITIALISATION : set userId/premium -----------
document.addEventListener("DOMContentLoaded", async () => {
  // 1. Charger infos du concours = récupère le bon ID
  await window.loadI18nLang();
  await chargerInfosConcours(); // Définit concoursIdGlobal

  // 2. Charger infos user après
  const user = await window.supabase.auth.getUser();
  window.userId = user.data?.user?.id || null;
  window.userIsPremium = !!user.data?.user?.user_metadata?.premium;

  // 3. Toutes les autres initialisations
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

  // 4. C’EST SEULEMENT MAINTENANT qu’on affiche la galerie
  window.afficherGalerieConcours();
});
function fitPseudoToWidth(className = "pseudo-miniature", minSize = 0.65) {
  document.querySelectorAll(`.${className}`).forEach(el => {
    let fontSize = 1.13; // taille em de base
    el.style.fontSize = fontSize + "em";
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "hidden";
    el.style.textOverflow = "ellipsis";
    el.style.maxWidth = el.style.width || "80px"; // adapte à la même taille

    // Réduit la taille de la police jusqu'à ce que ça tienne sur 1 ligne
    while (
      el.scrollWidth > el.offsetWidth &&
      fontSize > minSize
    ) {
      fontSize -= 0.05;
      el.style.fontSize = fontSize + "em";
    }
  });
}

// Appelle la fonction après chaque rendu :
window.addEventListener("DOMContentLoaded", () => fitPseudoToWidth());
window.addEventListener("resize", () => fitPseudoToWidth());
setTimeout(() => fitPseudoToWidth(), 200);
