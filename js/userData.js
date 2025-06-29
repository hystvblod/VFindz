const SUPABASE_URL = 'https://swmdepiukfginzhbeccz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN3bWRlcGl1a2ZnaW56aGJlY2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg0MjEyNTksImV4cCI6MjA2Mzk5NzI1OX0.--VONIyPdx1tTi45nd4e-F-ZuKNgbDSY1pP0rXHyJgI';

// ------- PATCH SÛR POUR CAPACITOR ---------
if (!window.supabase || !window.supabase.auth) {
  // On crée le client Supabase sur window (mode CDN ou Capacitor)
  window.supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}
const supabase = window.supabase;
// ------------------------------------------


let userDataCache = null;
let userIdCache = null;


// POPUP ADMIN
async function checkAndShowPopup(userId) {
  const { data } = await supabase
    .from('messages_popup')
    .select('*')
    .eq('userId', userId)
    .eq('vue', false);
  if (data && data.length > 0) {
    popupCustom(data[0].message);
    await supabase
      .from('messages_popup')
      .update({ vue: true })
      .eq('id', data[0].id);
  }
}

// AUTH ANONYME
async function ensureAuth() {
  let session = (await supabase.auth.getSession()).data.session;
  if (!session) {
    let res = await supabase.auth.signInAnonymously();
    if (res.error) throw new Error("Erreur de connexion anonyme Supabase : " + res.error.message);
    session = (await supabase.auth.getSession()).data.session;
  }
  userIdCache = session.user.id;
  return session.user.id;
}

// CACHE CADRES
function getCachedOwnedFrames() {
  try { return JSON.parse(localStorage.getItem("ownedFrames")) || null; }
  catch(e){ return null; }
}
function setCachedOwnedFrames(frames) {
  localStorage.setItem("ownedFrames", JSON.stringify(frames));
}

// CHARGEMENT UTILISATEUR
async function loadUserData(force = false) {
  await ensureAuth();
  const isBlocked = await checkBlocageUtilisateur(userIdCache);
  if (isBlocked) throw new Error("Utilisateur bloqué temporairement.");
  if (userDataCache && !force) return userDataCache;
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userIdCache)
    .maybeSingle();
  if (error) {
    console.error("Erreur loadUserData :", error);
  }
  if (!data) {
    const randomPseudo = "VUser_" + Math.random().toString(36).slice(2, 8);
    userDataCache = {
      id: userIdCache,
      pseudo: randomPseudo,
      points: 100,
      jetons: 3,
      nbChangementsPseudo: 0,
      cadres: ["polaroid_01", "polaroid_02"],
      cadreActif: "polaroid_01",
      historique: [],
      likedPhotos: [],
      signaledPhotos: [],
      premium: false,
      votesConcours: {},
      hasDownloadedVZone: false,
      hasDownloadedVBlocks: false,
      friendsInvited: 0,
      defiActifs: [],
      defiTimer: 0,
      amis: [],
      demandesRecues: [],
      demandesEnvoyees: [],
      dateinscription: new Date().toISOString(),
      id_color: null
    };
    const { error: insertError } = await supabase.from('users').insert([userDataCache]);
    if (insertError) {
      if (insertError.code === '23505' || (insertError.message && insertError.message.includes('duplicate'))) {
        const { data: existing, error: errorExisting } = await supabase
          .from('users')
          .select('*')
          .eq('id', userIdCache)
          .maybeSingle();
        if (errorExisting) {
          console.error("Erreur recherche user existant :", errorExisting);
        }
        userDataCache = existing;
      } else {
        throw insertError;
      }
    }
  } else {
    userDataCache = {
      amis: [],
      demandesRecues: [],
      demandesEnvoyees: [],
      ...data
    };
    userDataCache.amis = Array.isArray(userDataCache.amis) ? userDataCache.amis : [];
    userDataCache.demandesRecues = Array.isArray(userDataCache.demandesRecues) ? userDataCache.demandesRecues : [];
    userDataCache.demandesEnvoyees = Array.isArray(userDataCache.demandesEnvoyees) ? userDataCache.demandesEnvoyees : [];
  }
  setCachedOwnedFrames(userDataCache.cadres || []);
  return userDataCache;
}

// COULEUR ID
async function setIdColor(color) {
  await loadUserData();
  userDataCache.id_color = color;
  await supabase.from('users').update({ id_color: color }).eq('id', userIdCache);
}
async function getIdColor() {
  await loadUserData();
  return userDataCache?.id_color ?? null;
}

// CACHE RAPIDE
function getPseudoCached()        { return userDataCache?.pseudo ?? "Toi"; }
function getCadresPossedesCached(){ return userDataCache?.cadres ?? []; }
function getCadreSelectionneCached() { return userDataCache?.cadreActif ?? "polaroid_01"; }
function isPremiumCached()        { return !!userDataCache?.premium; }
function getLikedPhotosCached()   { return userDataCache?.likedPhotos ?? []; }
function getSignaledPhotosCached(){ return userDataCache?.signaledPhotos ?? []; }
function getHistoriqueCached()    { return userDataCache?.historique ?? []; }
function getVotesConcoursCached(){ return userDataCache?.votesConcours ?? {}; }
function hasDownloadedVZoneCached() { return userDataCache?.hasDownloadedVZone ?? false; }
function hasDownloadedVBlocksCached() { return userDataCache?.hasDownloadedVBlocks ?? false; }
function getFriendsInvitedCached() { return userDataCache?.friendsInvited ?? 0; }

// --------- FONCTIONS CLOUD ----------

async function getPseudo() { await loadUserData(); return getPseudoCached(); }

async function setPseudo(pseudo) {
  await loadUserData();
  userDataCache.nbChangementsPseudo = Number.isFinite(userDataCache.nbChangementsPseudo)
    ? userDataCache.nbChangementsPseudo : 0;
  userDataCache.points = Number.isFinite(userDataCache.points)
    ? userDataCache.points : 0;
  const premium = isPremiumCached();
  const nbChangements = userDataCache.nbChangementsPseudo;
  if (nbChangements >= 1 && !premium) {
    // Appel RPC pour enlever 300 points
    const points = await getPointsCloud();
    if (points < 300) {
      alert("Changer d'identifiant coûte 300 pièces. Tu n’en as pas assez.");
      return false;
    }
    const { data, error } = await supabase.rpc('secure_remove_points', { nb: 300 });
    if (error || !data || data.success !== true) {
      alert("Erreur lors du retrait des points.");
      return false;
    }
  }
  userDataCache.pseudo = pseudo;
  userDataCache.nbChangementsPseudo = nbChangements + 1;
  await supabase.from('users').update({
    pseudo,
    nbChangementsPseudo: userDataCache.nbChangementsPseudo
  }).eq('id', userIdCache);
  return true;
}

// --- POINTS/JETONS 100% SÉCURISÉS ---

async function getPointsCloud() {
  const profil = await getUserDataCloud();
  return profil.points || 0;
}
async function getJetonsCloud() {
  const profil = await getUserDataCloud();
  return profil.jetons || 0;
}

// --- CADRES ---
function formatCadreId(id) {
  const num = id.replace(/[^\d]/g, "");
  const padded = num.padStart(2, "0");
  return "polaroid_" + padded;
}
async function getCadresPossedes(force = false) {
  if (!force) {
    const cached = getCachedOwnedFrames();
    if (cached) return cached;
  }
  await loadUserData();
  setCachedOwnedFrames(getCadresPossedesCached());
  return getCadresPossedesCached();
}
async function possedeCadre(id) {
  await loadUserData();
  const idClean = formatCadreId(id);
  return getCadresPossedesCached().includes(idClean);
}
async function acheterCadre(id) {
  await loadUserData();
  const idClean = formatCadreId(id);
  userDataCache.cadres = Array.from(new Set([...(userDataCache.cadres || []), idClean]));
  await supabase.from('users').update({ cadres: userDataCache.cadres }).eq('id', userIdCache);
  setCachedOwnedFrames(userDataCache.cadres);
}
async function getCadreSelectionne() {
  await loadUserData();
  return getCadreSelectionneCached();
}
async function setCadreSelectionne(id) {
  const idClean = formatCadreId(id);
  await loadUserData();
  userDataCache.cadreActif = idClean;
  await supabase.from('users').update({ cadreActif: idClean }).eq('id', userIdCache);
}
// HISTORIQUE PHOTOS
async function sauvegarderPhoto(base64, defi, type = "solo") {
  await loadUserData();
  const historique = [...(userDataCache.historique || []), { base64, defi, date: new Date().toISOString(), type, defis: [defi] }];
  userDataCache.historique = historique;
  await supabase.from('users').update({ historique }).eq('id', userIdCache);
}
async function getHistoriquePhotos() {
  await loadUserData();
  return getHistoriqueCached();
}

// LIKES PHOTOS
async function likePhoto(photoId) {
  await loadUserData();
  if (!userDataCache.likedPhotos.includes(photoId))
    userDataCache.likedPhotos.push(photoId);
  await supabase.from('users').update({ likedPhotos: userDataCache.likedPhotos }).eq('id', userIdCache);
}
async function unlikePhoto(photoId) {
  await loadUserData();
  userDataCache.likedPhotos = (userDataCache.likedPhotos || []).filter(id => id !== photoId);
  await supabase.from('users').update({ likedPhotos: userDataCache.likedPhotos }).eq('id', userIdCache);
}
async function getLikedPhotos() {
  await loadUserData();
  return getLikedPhotosCached();
}

// SIGNALER PHOTOS
async function signalerPhoto(photoId) {
  await loadUserData();
  if (!userDataCache.signaledPhotos.includes(photoId))
    userDataCache.signaledPhotos.push(photoId);
  await supabase.from('users').update({ signaledPhotos: userDataCache.signaledPhotos }).eq('id', userIdCache);
}
async function getSignaledPhotos() {
  await loadUserData();
  return getSignaledPhotosCached();
}

// PREMIUM & FLAGS
async function isPremium() { await loadUserData(); return isPremiumCached(); }
async function setPremium(status) {
  await loadUserData();
  userDataCache.premium = !!status;
  await supabase.from('users').update({ premium: !!status }).eq('id', userIdCache);
}
async function setHasDownloadedVZone(value) {
  await loadUserData();
  userDataCache.hasDownloadedVZone = !!value;
  await supabase.from('users').update({ hasDownloadedVZone: !!value }).eq('id', userIdCache);
}
async function hasDownloadedVZone() {
  await loadUserData();
  return !!userDataCache.hasDownloadedVZone;
}
async function setHasDownloadedVBlocks(value) {
  await loadUserData();
  userDataCache.hasDownloadedVBlocks = !!value;
  await supabase.from('users').update({ hasDownloadedVBlocks: !!value }).eq('id', userIdCache);
}
async function hasDownloadedVBlocks() {
  await loadUserData();
  return !!userDataCache.hasDownloadedVBlocks;
}
async function setFriendsInvited(count) {
  await loadUserData();
  userDataCache.friendsInvited = count;
  await supabase.from('users').update({ friendsInvited: count }).eq('id', userIdCache);
}
async function getNbAmisInvites() {
  await loadUserData();
  return userDataCache.friendsInvited || 0;
}
async function incrementFriendsInvited() {
  await loadUserData();
  userDataCache.friendsInvited = (userDataCache.friendsInvited || 0) + 1;
  await supabase.from('users').update({ friendsInvited: userDataCache.friendsInvited }).eq('id', userIdCache);
}

// ========== CONDITIONS CADRES SPÉCIAUX ==========
async function getJoursDefisRealises() {
  await loadUserData();
  const historique = userDataCache?.historique || [];
  const defisParJourType = {};
  historique.forEach(entry => {
    let dateISO = entry.date && entry.date.length === 10 ? entry.date : (entry.date || '').slice(0, 10);
    if (!defisParJourType[dateISO]) defisParJourType[dateISO] = { solo: 0, duel_random: 0, duel_amis: 0 };
    if (entry.type === "solo") defisParJourType[dateISO].solo += (entry.defis?.length || 0);
    if (entry.type === "duel_random") defisParJourType[dateISO].duel_random += (entry.defis?.length || 0);
    if (entry.type === "duel_amis") defisParJourType[dateISO].duel_amis += (entry.defis?.length || 0);
  });
  let joursValides = 0;
  for (const date in defisParJourType) {
    const { solo, duel_random, duel_amis } = defisParJourType[date];
    if (solo >= 3 || duel_random >= 3 || duel_amis >= 3) joursValides++;
  }
  return joursValides;
}

async function getConcoursParticipationStatus() {
  await loadUserData();
  const concoursId = getConcoursId();
  const aPoste = (userDataCache.concoursPhotosPostees || []).includes(concoursId);
  const votes = userDataCache.votesConcours?.[concoursId]?.votes || {};
  const joursVotés = Object.keys(votes).filter(date => (votes[date]?.length ?? 0) > 0);
  const aVote3Jours = joursVotés.length >= 3;
  return aPoste && aVote3Jours;
}

// ========== LOGIQUE CONCOURS ==========
function getConcoursId() {
  const now = new Date();
  const year = now.getFullYear();
  const firstJan = new Date(year, 0, 1);
  const days = Math.floor((now - firstJan) / 86400000);
  const week = Math.ceil((days + firstJan.getDay() + 1) / 7);
  return `${year}-${week}`;
}

async function getVotesInfoForConcours() {
  await loadUserData();
  const concoursId = getConcoursId();
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const maxVotes = isPremiumCached() ? 6 : 3;
  if (!userDataCache.votesConcours) userDataCache.votesConcours = {};
  if (!userDataCache.votesConcours[concoursId]) userDataCache.votesConcours[concoursId] = {};
  if (userDataCache.votesConcours[concoursId].lastReset !== dateStr) {
    userDataCache.votesConcours[concoursId].lastReset = dateStr;
    userDataCache.votesConcours[concoursId].votesToday = maxVotes;
    userDataCache.votesConcours[concoursId].votes = userDataCache.votesConcours[concoursId].votes || {};
    userDataCache.votesConcours[concoursId].votes[dateStr] = [];
    await supabase.from('users').update({ votesConcours: userDataCache.votesConcours }).eq('id', userIdCache);
  }
  const dejaVotees = userDataCache.votesConcours[concoursId].votes?.[dateStr] || [];
  const votesToday = userDataCache.votesConcours[concoursId].votesToday ?? maxVotes;
  return {
    votesToday,
    maxVotes,
    dejaVotees
  };
}

async function voterPourPhoto(photoId) {
  await loadUserData();
  const concoursId = getConcoursId();
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0];
  const maxVotes = isPremiumCached() ? 6 : 3;
  if (!userDataCache.votesConcours) userDataCache.votesConcours = {};
  if (!userDataCache.votesConcours[concoursId]) userDataCache.votesConcours[concoursId] = {};
  if (!userDataCache.votesConcours[concoursId].votes) userDataCache.votesConcours[concoursId].votes = {};
  if (!userDataCache.votesConcours[concoursId].votes[dateStr]) userDataCache.votesConcours[concoursId].votes[dateStr] = [];
  if (userDataCache.votesConcours[concoursId].lastReset !== dateStr) {
    userDataCache.votesConcours[concoursId].lastReset = dateStr;
    userDataCache.votesConcours[concoursId].votesToday = maxVotes;
    userDataCache.votesConcours[concoursId].votes[dateStr] = [];
  }
  const votesToday = userDataCache.votesConcours[concoursId].votesToday;
  const dejaVotees = userDataCache.votesConcours[concoursId].votes[dateStr];
  if (votesToday <= 0) throw new Error("Tu as utilisé tous tes votes aujourd'hui !");
  if (dejaVotees.includes(photoId)) throw new Error("Tu as déjà voté pour cette photo aujourd'hui.");
  userDataCache.votesConcours[concoursId].votesToday -= 1;
  userDataCache.votesConcours[concoursId].votes[dateStr].push(photoId);
  userDataCache.votesConcours[concoursId].lastReset = dateStr;
  await supabase.from('users').update({ votesConcours: userDataCache.votesConcours }).eq('id', userIdCache);
  const { data: photo, error: errorPhoto } = await supabase
    .from('concoursPhotos')
    .select('*')
    .eq('id', photoId)
    .maybeSingle();
  if (errorPhoto) {
    console.error("Erreur voterPourPhoto :", errorPhoto);
    return false;
  }
  let votesTotal = photo?.votesTotal || 0;
  votesTotal += 1;
  await supabase.from('concoursPhotos').update({ votesTotal }).eq('id', photoId);
  return true;
}

async function getPhotosConcours() {
  const concoursId = getConcoursId();
  const { data } = await supabase
    .from('concoursPhotos')
    .select('*')
    .eq('concoursId', concoursId);
  let photos = (data || []).map(d => ({
    id: d.id,
    url: d.url,
    user: d.user || "Inconnu",
    votesTotal: d.votesTotal || 0
  }));
  photos.sort((a, b) => b.votesTotal - a.votesTotal);
  return photos;
}

// RESET/UPDATE
async function resetUserData() {
  await ensureAuth();
  const randomPseudo = "VUser_" + Math.random().toString(36).slice(2, 8);
  userDataCache = {
    id: userIdCache,
    pseudo: randomPseudo,
    points: 0,
    jetons: 0,
    cadres: [],
    cadreActif: "polaroid_01",
    historique: [],
    likedPhotos: [],
    signaledPhotos: [],
    premium: false,
    votesConcours: {},
    hasDownloadedVZone: false,
    hasDownloadedVBlocks: false,
    friendsInvited: 0,
    defiActifs: [],
    defiTimer: 0,
    amis: [],
    demandesRecues: [],
    dateinscription: new Date().toISOString(),
    demandesEnvoyees: [],
    id_color: null
  };
  await supabase.from('users').upsert([userDataCache]);
  setCachedOwnedFrames([]);
}

async function updateUserData(update) {
  await loadUserData();
  Object.assign(userDataCache, update);
  await supabase.from('users').update(update).eq('id', userIdCache);
  if ('cadres' in update) setCachedOwnedFrames(update.cadres);
}

// ACCÈS GLOBAL
async function getUserDataCloud() {
  await loadUserData();
  return { ...userDataCache };
}

// Récupère la liste des défis (toutes langues)
async function getDefisFromSupabase(lang = "fr") {
  let { data } = await supabase.from("defis").select("*");
  return (data || []).map(d => ({
    id: d.id,
    texte: lang === "fr" ? d.intitule : (d[lang] || d.intitule),
    done: false
  }));
}

// Alias rétrocompatible pour boutique
async function getOwnedFrames(force = false) {
  return await getCadresPossedes(force);
}

// Permet de récupérer l'ID utilisateur
function getUserId() {
  return userIdCache;
}

// ========== AJOUT DEFIS DANS HISTORIQUE ==========
async function ajouterDefiHistorique({ defi, type = 'solo', date = null }) {
  await loadUserData();
  const userId = getUserId();
  if (!userId) throw new Error("Utilisateur non connecté");
  const { data, error } = await supabase
    .from('users')
    .select('historique')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error("Erreur ajouterDefiHistorique :", error);
  }
  let historique = Array.isArray(data?.historique) ? data.historique : [];
  const dateISO = date || (new Date()).toISOString().slice(0, 10);
  let entry = historique.find(e => e.date === dateISO && e.type === type);
  if (entry) {
    if (!entry.defis.includes(defi)) entry.defis.push(defi);
  } else {
    historique.push({
      date: dateISO,
      defis: [defi],
      type: type
    });
  }
  await supabase.from('users').update({ historique }).eq('id', userId);
}

// ========== CHECK BLOCAGE UTILISATEUR ==========
async function checkBlocageUtilisateur(userId) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('users')
    .select('banni, ban_date_debut, ban_date_fin, ban_motif')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error("Erreur blocage utilisateur :", error.message);
    return false;
  }
  if (data && data.banni) {
    if (
      data.ban_date_debut &&
      data.ban_date_fin &&
      now >= data.ban_date_debut &&
      now <= data.ban_date_fin
    ) {
      alert("🚫 Accès bloqué temporairement.\nMotif : " + (data.ban_motif || "non spécifié") + "\nFin : " + new Date(data.ban_date_fin).toLocaleString());
      return true;
    }
  }
  return false;
}

// --------- ID RENDER AVEC COULEUR ---------
function renderID(pseudo) {
  // Utilise la couleur personnalisée si premium, sinon or/blanc
  const color = userDataCache?.id_color
    ? userDataCache.id_color
    : (isPremiumCached() ? "gold" : "white");
  return `<span style="color:${color};font-weight:bold;">${pseudo}</span>`;
}

// ========== GET CADRE URL SUPABASE ==========
function getCadreUrl(id) {
  return localStorage.getItem(`cadre_${id}`) ||
    `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
}

// -------- GET USER BY PSEUDO (pour afficher couleur) ---------
async function getUserByPseudo(pseudo) {
  if (!pseudo) return null;
  const { data, error } = await supabase
    .from('users')
    .select('pseudo, premium, id_color')
    .eq('pseudo', pseudo)
    .maybeSingle();
  if (error) {
    console.error("Erreur getUserByPseudo :", error);
    return null;
  }
  return data || null;
}
// Ajout local d'une photo aimée complète (cadre inclus, limité à 30)
window.ajouterPhotoAimeeComplete = function(defiId, imageDataUrl, cadreId) {
  let aimes = JSON.parse(localStorage.getItem("photos_aimees_obj") || "[]");
  // déjà présente ?
  if (aimes.some(obj => obj.defiId === defiId)) return;
  // Limite à 30
  if (aimes.length >= 30) aimes.shift();
  aimes.push({ defiId, imageDataUrl, cadreId, date: Date.now() });
  localStorage.setItem("photos_aimees_obj", JSON.stringify(aimes));
};

// ========== GLOBALISATION DES FONCTIONS ==========
window.supabase = supabase;
window.loadUserData = loadUserData;
window.ensureAuth = ensureAuth;
window.getPseudo = getPseudo;
window.setPseudo = setPseudo;
window.getPointsCloud = getPointsCloud;
window.getJetonsCloud = getJetonsCloud;
window.getCadresPossedes = getCadresPossedes;
window.acheterCadre = acheterCadre;
window.possedeCadre = possedeCadre;
window.getCadreSelectionne = getCadreSelectionne;
window.setCadreSelectionne = setCadreSelectionne;
window.isPremium = isPremium;
window.setPremium = setPremium;
window.setHasDownloadedVZone = setHasDownloadedVZone;
window.hasDownloadedVZone = hasDownloadedVZone;
window.setHasDownloadedVBlocks = setHasDownloadedVBlocks;
window.hasDownloadedVBlocks = hasDownloadedVBlocks;
window.setFriendsInvited = setFriendsInvited;
window.getNbAmisInvites = getNbAmisInvites;
window.incrementFriendsInvited = incrementFriendsInvited;
window.getJoursDefisRealises = getJoursDefisRealises;
window.getConcoursParticipationStatus = getConcoursParticipationStatus;
window.getVotesInfoForConcours = getVotesInfoForConcours;
window.voterPourPhoto = voterPourPhoto;
window.getPhotosConcours = getPhotosConcours;
window.sauvegarderPhoto = sauvegarderPhoto;
window.getHistoriquePhotos = getHistoriquePhotos;
window.likePhoto = likePhoto;
window.unlikePhoto = unlikePhoto;
window.getLikedPhotos = getLikedPhotos;
window.signalerPhoto = signalerPhoto;
window.getSignaledPhotos = getSignaledPhotos;
window.resetUserData = resetUserData;
window.updateUserData = updateUserData;
window.getUserDataCloud = getUserDataCloud;
window.getDefisFromSupabase = getDefisFromSupabase;
window.getOwnedFrames = getOwnedFrames;
window.getUserId = getUserId;
window.ajouterDefiHistorique = ajouterDefiHistorique;
window.setIdColor = setIdColor;
window.getIdColor = getIdColor;
window.checkBlocageUtilisateur = checkBlocageUtilisateur;
window.renderID = renderID;
window.getCadreUrl = getCadreUrl;
window.getUserByPseudo = getUserByPseudo;
window.getJetons = getJetonsCloud;

// ----- AJOUTE CECI À LA FIN DE userData.js -----
// Fonction cloud SÉCURISÉE de retrait de jeton pour les duels
window.removeJeton = async function() {
  await loadUserData();
  // Sécurité anti-négatif
  const jetonsActuels = Number(userDataCache.jetons || 0);
  if (jetonsActuels <= 0) throw new Error("Plus de jetons disponibles.");
  userDataCache.jetons = jetonsActuels - 1;
  await supabase.from('users').update({ jetons: userDataCache.jetons }).eq('id', userIdCache);
  return userDataCache.jetons;
};
