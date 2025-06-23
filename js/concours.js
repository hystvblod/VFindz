// concours.js

// Nécessite que userData.js et camera.js soient chargés avant ce fichier !

const URL_CONCOURS = "https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/concours//concours.json";
const PAGE_SIZE = 30;

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

function getVotedPhotoIdsToday() {
  const key = 'photos_votees_' + getConcoursDateStr();
  return JSON.parse(localStorage.getItem(key) || "[]");
}
function addVotedPhotoIdToday(photoId) {
  const key = 'photos_votees_' + getConcoursDateStr();
  let arr = JSON.parse(localStorage.getItem(key) || "[]");
  if (!arr.includes(photoId)) arr.push(photoId);
  localStorage.setItem(key, JSON.stringify(arr));
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
  // 1. Utilise le cache si possible
  if (!forceReload) {
    allPhotos = getConcoursPhotosCache(concoursId);
    if (!allPhotos) forceReload = true;
  }
  // 2. Si pas de cache ou forcer, reload
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

  // Respect "joueur en premier"
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

// ----------- GÉNÉRATION PAGINATION -----------
function getPagePhotos(orderedPhotos, page = 1, pageSize = PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  return orderedPhotos.slice(start, start + pageSize);
}

// ----------- FILTRAGE RECHERCHE PSEUDO -----------
function filtrerPhotosParPseudo(photos, search) {
  if (!search) return photos;
  const query = search.trim().toLowerCase();
  return photos.filter(p => (p.pseudo || p.user || "").toLowerCase().includes(query));
}

let currentPage = 1;

window.afficherGalerieConcours = async function(forceReload = false) {
  const galerie = document.getElementById("galerie-concours");
  galerie.innerHTML = "<div style='text-align:center;color:#888;'>Chargement...</div>";

  let { allPhotos, orderedPhotos } = await getPhotosAPaginer(forceReload);

  // ➡️ Ajout : récupération votes optimisés
  const concoursId = getConcoursId();
  const votesData = await getVotesConcoursFromCacheOrDB(concoursId);
  const votesMap = {};
  votesData.forEach(v => votesMap[v.id] = v.votes_total);

  // Recherche
  const inputSearch = document.getElementById('recherche-pseudo-concours');
  const resultatsElt = document.getElementById('resultats-recherche-concours');
  let search = (inputSearch && inputSearch.value) || "";
  let filteredOrderedPhotos = filtrerPhotosParPseudo(orderedPhotos, search);

  // Grille style boutique (max 30)
  const paginatedPhotos = getPagePhotos(filteredOrderedPhotos, currentPage, PAGE_SIZE);

  let html = `<div class="grid-photos-concours">`;
  for (const photo of paginatedPhotos) {
    html += creerCartePhotoHTML(photo, photo.user_id === (await window.supabase.auth.getUser()).data?.user?.id, votesMap[photo.id] ?? photo.votes_total);
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

  if (resultatsElt)
    resultatsElt.textContent = `(${filteredOrderedPhotos.length} résultat${filteredOrderedPhotos.length > 1 ? 's' : ''})`;

  galerie.innerHTML = html;

  majVotesConcoursAffichage(votesData);

  // Pagination events
  if (document.getElementById('btn-prev'))
    document.getElementById('btn-prev').onclick = () => { currentPage--; window.afficherGalerieConcours(); }
  if (document.getElementById('btn-next'))
    document.getElementById('btn-next').onclick = () => { currentPage++; window.afficherGalerieConcours(); }

  // Events zoom/vote popup (photo-cadre clique)
  Array.from(document.querySelectorAll('.photo-concours-img-wrapper')).forEach(div => {
    div.onclick = function() {
      const photoId = this.dataset.photoid;
      const photo = allPhotos.find(p => p.id == photoId);
      if (photo) ouvrirPopupZoomConcours(photo, votesMap[photo.id] ?? photo.votes_total);
    };
  });
};

// ----------- GÉNÈRE UNE CARTE HTML (boutique/polaroïd) -----------
function creerCartePhotoHTML(photo, isPlayer, nbVotes) {
  const dejaVotees = getVotedPhotoIdsToday();
  let coeurOpacity = dejaVotees.includes(photo.id) ? "0.43" : "1";
  return `
    <div class="photo-concours-item${isPlayer ? ' joueur-photo' : ''}">
      <div class="photo-concours-img-wrapper" data-photoid="${photo.id}" style="position:relative;cursor:pointer;">
        <img src="${photo.photo_url}" class="photo-concours-img" style="width:100%;border-radius:10px;background:#f9f9fa;">
        <div class="photo-concours-coeur" style="position:absolute;right:7px;top:7px;">
          <img src="assets/icons/coeur.svg" alt="Vote" style="width:22px;height:22px;vertical-align:middle;opacity:${coeurOpacity};">
          <span class="nbvotes" style="margin-left:5px;color:#ffe04a;font-weight:bold;">${typeof nbVotes !== "undefined" ? nbVotes : photo.votes_total}</span>
        </div>
      </div>
      <div class="photo-concours-user">${photo.pseudo || photo.user || "?"}</div>
    </div>
  `;
}

// ----------- POPUP ZOOM STYLE DUEL ----------- //
async function ouvrirPopupZoomConcours(photo, votesTotal = 0) {
  let old = document.getElementById("popup-photo-zoom");
  if (old) old.remove();
  const cadreId = photo.cadre_id || "polaroid_01";
  let cadreUrl = cadreId.startsWith("http") ? cadreId : (await window.getCadreUrl ? await window.getCadreUrl(cadreId) : `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadreId}.webp`);
  const dejaVote = getVotedPhotoIdsToday().includes(photo.id);
  const coeurSVG = dejaVote
    ? `<img src="assets/icons/coeur_rouge.svg" style="width:38px;vertical-align:middle;opacity:0.75;" alt="Déjà voté"/>`
    : `<img src="assets/icons/coeur.svg" style="width:38px;vertical-align:middle;cursor:pointer;" alt="Voter"/>`;

  const popup = document.createElement("div");
  popup.id = "popup-photo-zoom";
  popup.className = "popup show";
  popup.style = "z-index:10002;background:rgba(30,30,40,0.82);";
  popup.innerHTML = `
    <div class="popup-inner" style="max-width:350px;margin:auto;background:#181829;border-radius:24px;padding:22px 16px;position:relative;">
      <button id="close-popup-zoom" class="close-btn" style="position:absolute;top:10px;right:14px;font-size:1.4em;background:none;border:none;">
        <img src="assets/icons/close.svg" style="width:24px;" />
      </button>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="cadre-preview cadre-popup" style="margin-bottom:18px;position:relative;">
          <img class="photo-cadre" src="${cadreUrl}" style="max-width:240px;max-height:240px;">
          <img class="photo-user" src="${photo.photo_url}" style="max-width:200px;max-height:200px;position:absolute;top:28px;left:50%;transform:translateX(-50%);" />
        </div>
        <div style="margin-top:10px;display:flex;align-items:center;gap:20px;">
          <span style="color:#ffe04a;font-weight:bold;font-size:1.1em;">${photo.pseudo || photo.user || "?"}</span>
          <span style="color:#bbb;font-size:0.95em;">ID: ${photo.id}</span>
        </div>
        <button class="vote-coeur-btn" style="margin:22px auto 0 auto;display:flex;align-items:center;background:none;border:none;" ${dejaVote ? "disabled" : ""} data-photoid="${photo.id}">
          ${coeurSVG}
          <span style="margin-left:8px;color:#ffe04a;font-weight:bold;font-size:1.13em;">Voter</span>
          <span class="nbvotes" style="margin-left:12px;color:#ffe04a;font-weight:bold;font-size:1.03em;">${votesTotal}</span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(popup);
  popup.querySelector("#close-popup-zoom").onclick = () => popup.remove();

  // Vote si pas déjà voté
  if (!dejaVote) {
    popup.querySelector(".vote-coeur-btn").onclick = async function() {
      await votePourPhoto(photo.id);
      popup.remove();
      window.afficherGalerieConcours(true); // force reload pour vote instantané
    };
  }
}

// ----------- VOTE POURPHOTO (un vote par jour) ----------- //
async function votePourPhoto(photoId) {
  if (getVotedPhotoIdsToday().includes(photoId)) return;

  const { data, error } = await window.supabase
    .from('photosconcours')
    .select('votes_total')
    .eq('id', photoId)
    .single();
  if (!data) return;
  const nouveauTotal = (data.votes_total || 0) + 1;
  const { error: errUpdate } = await window.supabase
    .from('photosconcours')
    .update({ votes_total: nouveauTotal })
    .eq('id', photoId);
  if (errUpdate) return;

  addVotedPhotoIdToday(photoId);
  // Vide le cache photos pour forcer reload avec votes à jour
  setConcoursPhotosCache(getConcoursId(), []);
}

// ----------- PARTICIPATION PHOTO ----------- //
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
    // Vide cache photos pour rechargement
    setConcoursPhotosCache(concoursId, []);
  } catch (e) {
    alert("Erreur lors de l'ajout de la photo au concours.");
    console.error(e);
  }
}

// ----------- INITIALISATION ----------- //
document.addEventListener("DOMContentLoaded", async () => {
  await chargerInfosConcours();

  // Mise à jour automatique du TOP 6 à minuit
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
