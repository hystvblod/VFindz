import { supabase } from './userData.js';
import { ouvrirCameraPour } from "./camera.js";

const URL_CONCOURS = "https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/concours//concours.json";
const PAGE_SIZE = 30;

// ----------- UTILS DATE/TOP 6 LOCAL -----------
function getConcoursDateStr() {
  return new Date().toISOString().slice(0, 10);
}
function getTop6CacheKey() {
  return 'top6_concours_' + getConcoursDateStr();
}

// ----------- TOP 6 STOCKAGE LOCAL -----------
async function fetchAndCacheTop6() {
  const concoursId = getConcoursId();
  const { data, error } = await supabase
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
  const { data, error } = await supabase
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

// ----------- PHOTOS CONCOURS, TRI ET PAGINATION -----------
async function getPhotosAPaginer() {
  const concoursId = getConcoursId();
  const { data: allPhotos } = await supabase
    .from('photosconcours')
    .select('*')
    .eq('concours_id', concoursId);

  const top6Ids = getCachedTop6();

  const user = await supabase.auth.getUser();
  const userName = user.data?.user?.user_metadata?.pseudo || user.data?.user?.id;
  const photoJoueur = allPhotos.find(p => p.user === userName);

  const votedIds = getVotedPhotoIdsToday();
  let photosVotees = votedIds
    .map(id => allPhotos.find(p => p.id === id))
    .filter(Boolean);

  let uniqueSet = new Set();
  let orderedPhotos = [];
  if (photoJoueur && !uniqueSet.has(photoJoueur.id)) {
    orderedPhotos.push(photoJoueur);
    uniqueSet.add(photoJoueur.id);
  }
  for (const p of photosVotees) {
    if (!uniqueSet.has(p.id)) {
      orderedPhotos.push(p);
      uniqueSet.add(p.id);
    }
  }
  for (const p of allPhotos) {
    if (!uniqueSet.has(p.id)) {
      orderedPhotos.push(p);
      uniqueSet.add(p.id);
    }
  }
  return { allPhotos, top6Ids, orderedPhotos };
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
  return photos.filter(p => (p.user || "").toLowerCase().includes(query));
}

let currentPage = 1;

export async function afficherGalerieConcours() {
  const galerie = document.getElementById("galerie-concours");
  galerie.innerHTML = "<div style='text-align:center;color:#888;'>Chargement...</div>";

  let { allPhotos, top6Ids, orderedPhotos } = await getPhotosAPaginer();

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

  // TOP 6
  const top6Photos = top6Ids.map(id => allPhotos.find(p => p.id === id)).filter(Boolean);
  let html = "";
  if (top6Photos.length > 0) {
    html += `<div style="text-align:left;margin-bottom:6px;font-weight:bold;font-size:1.08em;color:#ffe04a;">🏆 TOP 6</div>`;
    html += `<div class="galerie-concours" style="margin-bottom:30px;display:flex;gap:10px;flex-wrap:wrap;">`;
    for (const photo of top6Photos) {
      html += creerCartePhotoHTML(photo, true, votesMap[photo.id] ?? photo.votes_total);
    }
    html += `</div>`;
  }

  // Grille 3 colonnes
  const paginatedPhotos = getPagePhotos(filteredOrderedPhotos, currentPage, PAGE_SIZE);
  if (paginatedPhotos.length > 0) {
    html += `<div style="text-align:left;margin:16px 0 6px 0;font-weight:bold;font-size:1.06em;">Toutes les photos</div>`;
    html += `<div class="grid-photos-concours">`;
    for (const photo of paginatedPhotos) {
      html += creerCartePhotoHTML(photo, false, votesMap[photo.id] ?? photo.votes_total);
    }
    html += `</div>`;

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
  } else {
    html += `<div style="text-align:center;color:#e44;margin:22px;">Aucune photo trouvée pour ce pseudo.</div>`;
    if (resultatsElt) resultatsElt.textContent = "(0 résultat)";
  }
  galerie.innerHTML = html;

  majVotesConcoursAffichage(votesData);

  // Pagination events
  if (document.getElementById('btn-prev'))
    document.getElementById('btn-prev').onclick = () => { currentPage--; afficherGalerieConcours(); }
  if (document.getElementById('btn-next'))
    document.getElementById('btn-next').onclick = () => { currentPage++; afficherGalerieConcours(); }

  // Events cœur et zoom
  Array.from(document.querySelectorAll('.btn-coeur-concours')).forEach(btn => {
    btn.onclick = async function(e) {
      e.stopPropagation();
      const photoId = this.dataset.photoid;
      await votePourPhoto(photoId);
    };
  });
  Array.from(document.querySelectorAll('.photo-concours-img-wrapper')).forEach(div => {
    div.onclick = function() {
      const photoId = this.dataset.photoid;
      const photo = allPhotos.find(p => p.id == photoId);
      if (photo) ouvrirPopupZoom(photo);
    };
  });
}

// ----------- GÉNÈRE UNE CARTE HTML (top6 ou autre) -----------
function creerCartePhotoHTML(photo, isTop, nbVotes) {
  const dejaVotees = getVotedPhotoIdsToday();
  let coeurDisabled = dejaVotees.includes(photo.id) ? "disabled" : "";
  let coeurOpacity = dejaVotees.includes(photo.id) ? "0.43" : "1";
  // ⚡️ On affiche depuis la colonne photo_url !
  return `
    <div class="photo-concours-item${isTop ? ' top6-photo' : ''}">
      <div class="photo-concours-img-wrapper" data-photoid="${photo.id}" style="position:relative;cursor:pointer;">
        <img src="${photo.photo_url}" class="photo-concours-img" />
        <button class="btn-coeur-concours" data-photoid="${photo.id}" ${coeurDisabled} 
          style="position:absolute;right:7px;top:7px;background:rgba(30,30,30,0.87);border:none;border-radius:16px;padding:4px 10px;cursor:pointer;">
          <img src="assets/icons/coeur.svg" alt="Vote" style="width:22px;height:22px;vertical-align:middle;opacity:${coeurOpacity};">
          <span class="nbvotes" style="margin-left:5px;color:#ffe04a;font-weight:bold;">${typeof nbVotes !== "undefined" ? nbVotes : photo.votes_total}</span>
        </button>
      </div>
      <div class="photo-concours-user">${photo.user || "?"}</div>
    </div>
  `;
}

// ----------- VOTE POUR PHOTO -----------
async function votePourPhoto(photoId) {
  const dejaVotees = getVotedPhotoIdsToday();
  if (dejaVotees.includes(photoId)) return;
  const { data, error } = await supabase
    .from('photosconcours')
    .select('votes_total')
    .eq('id', photoId)
    .single();
  if (!data) return;
  let votesTotal = (data.votes_total || 0) + 1;
  let { error: errUpdate } = await supabase
    .from('photosconcours')
    .update({ votes_total: votesTotal })
    .eq('id', photoId);
  if (errUpdate) return;
  addVotedPhotoIdToday(photoId);

  // ➡️ On force le rechargement des votes (refresh cache)
  await getVotesConcoursFromCacheOrDB(getConcoursId(), true);

  afficherGalerieConcours();
}

// ----------- POPUP ZOOM -----------
function ouvrirPopupZoom(photo) {
  let old = document.getElementById("popup-photo-zoom");
  if (old) old.remove();
  const popup = document.createElement("div");
  popup.id = "popup-photo-zoom";
  popup.className = "popup show";
  popup.style = "z-index:10002;background:rgba(30,30,40,0.82);";
  popup.innerHTML = `
    <div class="popup-inner" style="max-width:350px;margin:auto;background:#181829;border-radius:24px;padding:22px 16px;position:relative;">
      <button id="close-popup-zoom" class="close-btn" style="position:absolute;top:10px;right:14px;font-size:1.4em;">✖</button>
      <div style="display:flex;flex-direction:column;align-items:center;">
        <div class="cadre-preview cadre-popup" style="margin-bottom:18px;">
          <img class="photo-cadre" src="assets/cadres/polaroid_01.webp" />
          <img class="photo-user" src="${photo.photo_url}" style="max-width:230px;max-height:230px;" />
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
          <span style="color:#ffe04a;font-weight:bold;font-size:1.1em;letter-spacing:1px;">${photo.user || "?"}</span>
          <span style="color:#bbb;font-size:0.92em;">ID: ${photo.id}</span>
        </div>
      </div>
    </div>`;
  document.body.appendChild(popup);
  popup.querySelector("#close-popup-zoom").onclick = () => popup.remove();
}

// ----------- PARTICIPATION PHOTO -----------
export async function ajouterPhotoConcours() {
  const concoursId = getConcoursId();
  const user = await supabase.auth.getUser();
  const userId = user.data?.user?.id || "Inconnu";
  const userName = user.data?.user?.user_metadata?.pseudo || userId;

  // Ouvre la caméra et upload automatiquement avec le bon mode
  const photo_url = await ouvrirCameraPour(concoursId, "concours");
  if (!photo_url) return;
  try {
    let { error } = await supabase
      .from('photosconcours')
      .insert([
        {
          concours_id: concoursId,
          photo_url,
          user: userName,
          votes_total: 0
        }
      ]);
    if (error) throw error;
  } catch (e) {
    alert("Erreur lors de l'ajout de la photo au concours.");
    console.error(e);
  }
}

// ----------- INITIALISATION -----------
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
      await ajouterPhotoConcours();
      afficherGalerieConcours();
    });
  }

  // Barre recherche instantanée
  const inputSearch = document.getElementById("recherche-pseudo-concours");
  if (inputSearch) {
    inputSearch.addEventListener('input', () => {
      currentPage = 1;
      afficherGalerieConcours();
    });
  }

  await afficherGalerieConcours();
});
