import {
  supabase, // <-- Ne jamais retirer cette ligne !
  getPoints, addPoints, removePoints, getJetons, addJetons,
  possedeCadre, acheterCadre, getOwnedFrames, isPremium,
  updateUserData, getCadreSelectionne,
  getJoursDefisRealises, getNbAmisInvites, getConcoursParticipationStatus,
  hasDownloadedVZone // (si besoin, à implémenter)
  
} from './userData.js';

// === IndexedDB cache boutique/cadres.json ===
const BOUTIQUE_DB_NAME = 'VFindBoutiqueCache';
const BOUTIQUE_STORE = 'boutiqueData';
async function openBoutiqueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BOUTIQUE_DB_NAME, 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(BOUTIQUE_STORE, { keyPath: 'key' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = reject;
  });
}
async function getBoutiqueCache() {
  const db = await openBoutiqueDB();
  return new Promise(res => {
    const tx = db.transaction(BOUTIQUE_STORE, 'readonly');
    const store = tx.objectStore(BOUTIQUE_STORE);
    const req = store.get('cadres');
    req.onsuccess = () => res(req.result?.data || null);
    req.onerror = () => res(null);
  });
}
async function setBoutiqueCache(data) {
  const db = await openBoutiqueDB();
  return new Promise(res => {
    const tx = db.transaction(BOUTIQUE_STORE, 'readwrite');
    const store = tx.objectStore(BOUTIQUE_STORE);
    store.put({ key: 'cadres', data, ts: Date.now() });
    tx.oncomplete = res;
  });
}

// ================== CONDITIONS CADRES UNIVERSAL ===================
async function checkCadreUnlock(cadre) {
  if (!cadre.condition) return { unlocked: true };

  switch (cadre.condition.type) {
    case "premium":
      return { unlocked: await isPremium(), texte: cadre.condition.texte || "Compte premium requis" };
    case "jours_defis":
      if (typeof getJoursDefisRealises === "function") {
        const nb = await getJoursDefisRealises();
        return {
          unlocked: nb >= (cadre.condition.nombre || 0),
          texte: cadre.unlock || `Fais ${cadre.condition.nombre} jours de défis pour débloquer`
        };
      }
      return { unlocked: false, texte: "Fonction de check non dispo" };
    case "inviter_amis":
      if (typeof getNbAmisInvites === "function") {
        const nb = await getNbAmisInvites();
        return {
          unlocked: nb >= (cadre.condition.nombre || 0),
          texte: cadre.unlock || `Invite ${cadre.condition.nombre} amis`
        };
      }
      return { unlocked: false, texte: "Fonction de check non dispo" };
    case "participation_concours":
      if (typeof getConcoursParticipationStatus === "function") {
        const ok = await getConcoursParticipationStatus();
        return {
          unlocked: ok,
          texte: cadre.unlock || "Participe à un concours et vote au moins 3 jours"
        };
      }
      return { unlocked: false, texte: "Fonction de check non dispo" };
    case "telechargement_vzone":
      if (typeof hasDownloadedVZone === "function") {
        const ok = await hasDownloadedVZone();
        return {
          unlocked: ok,
          texte: cadre.unlock || "Télécharge le jeu VZone pour débloquer ce cadre."
        };
      }
      return { unlocked: false, texte: "Fonction de check non dispo" };
    default:
      return { unlocked: false, texte: cadre.unlock || "Condition inconnue" };
  }
}

// --- Feedback popups ---
function showFeedback(text) {
  const feedback = document.getElementById("gain-feedback");
  if (!feedback) return;
  feedback.textContent = text;
  feedback.classList.remove("hidden");
  feedback.classList.add("show");
  setTimeout(() => {
    feedback.classList.remove("show");
    feedback.classList.add("hidden");
  }, 1500);
}

// --- Acheter cadre depuis boutique (cloud & local) ---
async function acheterCadreBoutique(id, prix) {
  if (!(await removePoints(prix))) {
    alert("❌ Pas assez de pièces !");
    return;
  }
  await acheterCadre(id);

  // On charge l’image en base64 et la stocke dans le localStorage, SANS DUPLICATA de fetch
  const url = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
  try {
    const res = await fetch(url, { cache: "reload" });
    const blob = await res.blob();
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        localStorage.setItem(`cadre_${id}`, reader.result);
        resolve();
      };
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Erreur chargement cadre base64 :", e);
    alert("Erreur lors de l'enregistrement du cadre. Vérifie ta connexion.");
    return;
  }

  // Marque le moment de la dernière update pour forcer la synchro sur Mes Cadres
  localStorage.setItem('lastCadresUpdate', Date.now().toString());

  // Force update possession (cloud)
  await getOwnedFrames(true);

  // Ici SEULEMENT tu affiches “Acheté !” ou tu fais le render.
  await updatePointsDisplay();
  alert("✅ Cadre acheté !");
  await renderBoutique(currentCategory);
}

// --- Popups et pub ---
function closePopup() {
  const popupGain = document.getElementById("gain-feedback");
  if (popupGain) {
    popupGain.classList.remove("show");
    popupGain.classList.add("hidden");
  }
  const oldUnlock = document.getElementById("popup-unlock-info");
  if (oldUnlock) document.body.removeChild(oldUnlock);
}

function showUnlockPopup(nom, message) {
  const oldPopup = document.getElementById("popup-unlock-info");
  if (oldPopup) document.body.removeChild(oldPopup);
  const popup = document.createElement("div");
  popup.id = "popup-unlock-info";
  popup.className = "popup show";
  popup.innerHTML = `
    <div class="popup-inner">
      <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
      <h2 style="font-size:1.4em;">${nom}</h2>
      <div style="margin:1em 0 0.5em 0;font-size:1.1em;text-align:center;">${message || "Aucune information."}</div>
    </div>
  `;
  document.body.appendChild(popup);
}

// Gagne des pièces via pub simulée
async function watchAd() {
  await addPoints(100);
  await updatePointsDisplay();
  showFeedback("+100 💰");
  closePopup();
}

// === Parrainage code (génère lien d’invitation ===
async function inviteFriend() {
  let userId = null;
  try { userId = (await import('./userData.js')).getUserId(); } catch {}
  if (!userId) {
    alert('Connecte-toi pour inviter !');
    return;
  }
  const lien = window.location.origin + "/profil.html?parrain=" + userId;
  prompt("Partage ce lien à ton ami pour qu’il s’inscrive et que tu gagnes 300 pièces :\n\n" + lien + "\n\n(Ton ami doit cliquer sur ce lien AVANT sa première connexion)");
}

// --- Popup achat jetons ---
function ouvrirPopupJetonBoutique() {
  const popup = document.getElementById("popup-achat-jeton");
  if (popup) popup.classList.remove("hidden");
}
function fermerPopupJetonBoutique() {
  const popup = document.getElementById("popup-achat-jeton");
  if (popup) popup.classList.add("hidden");
}

async function acheterJetonsAvecPieces() {
  if (await removePoints(100)) {
    await addJetons(3);
    alert("✅ 3 jetons ajoutés !");
    await updatePointsDisplay();
    await updateJetonsDisplay();
    fermerPopupJetonBoutique();
  } else {
    alert("❌ Pas assez de pièces.");
  }
}
async function acheterJetonsAvecPub() {
  alert("📺 Simulation de pub regardée !");
  setTimeout(async () => {
    await addJetons(3);
    alert("✅ 3 jetons ajoutés !");
    await updateJetonsDisplay();
    fermerPopupJetonBoutique();
  }, 3000);
}

// --- Affichage points/jetons ---
async function updatePointsDisplay() {
  const pointsDisplay = document.getElementById("points");
  if (pointsDisplay) pointsDisplay.textContent = await getPoints();
}
async function updateJetonsDisplay() {
  const jetonsSpan = document.getElementById("jetons");
  if (jetonsSpan) jetonsSpan.textContent = await getJetons();
}

// Patch scroll & overflow
setTimeout(() => {
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
  document.body.style.overflowX = "hidden";
}, 100);

// Gestion click global pour feedback
document.addEventListener("click", function (e) {
  const popupGain = document.getElementById("gain-feedback");
  if (popupGain && popupGain.classList.contains("show") && e.target === popupGain) {
    closePopup();
  }
});

// ----- Gestion catégories -----
const CATEGORIES = [
  { key: 'classique', nom: 'Classique' },
  { key: 'prestige', nom: 'Prestige' },
  { key: 'premium', nom: 'Premium' },
  { key: 'bloque', nom: 'Défi / Spéciaux 🔒' }
];

function getCategorie(id) {
  const num = parseInt(id.replace('polaroid_', ''));
  if (num >= 1 && num <= 10) return 'classique';
  if (num >= 11 && num <= 100) return 'prestige';
  if (num >= 101 && num <= 200) return 'premium';
  if (num >= 900 && num <= 1000) return 'bloque';
  return 'autre';
}

// ---- PATCH MINIATURES DEFI (fixes 100% le centrage et l'affichage)
async function afficherPhotosSauvegardees(photosMap) {
  const cadreActuel = await getCadreSelectionne();
  document.querySelectorAll(".defi-item").forEach(defiEl => {
    const id = defiEl.getAttribute("data-defi-id");
    const dataUrl = photosMap[id];

    const container = defiEl.querySelector(`[data-photo-id="${id}"]`);
    container.innerHTML = '';
    container.style.minWidth = "90px";
    container.style.minHeight = "110px";

    if (dataUrl) {
      const preview = document.createElement("div");
      preview.className = "cadre-preview";

      const fond = document.createElement("img");
      fond.className = "photo-cadre";
      fond.src = `./assets/cadres/${cadreActuel}.webp`;

      const photo = document.createElement("img");
      photo.className = "photo-user";
      photo.src = dataUrl;
      photo.onclick = () => agrandirPhoto(dataUrl, id);

      preview.appendChild(fond);
      preview.appendChild(photo);
      container.appendChild(preview);
      defiEl.classList.add("done");
    }
  });
}

// --- Initialisation principale avec cache boutique ---
let CADRES_DATA = [];
let currentCategory = 'classique';

async function fetchCadres(force = false) {
  if (!force) {
    const cached = await getBoutiqueCache();
    if (cached) {
      CADRES_DATA = cached;
      return;
    }
  }

  // Requête Supabase
  const { data, error } = await supabase.from('cadres').select('*');
  if (error || !data) {
    console.error("Erreur chargement Supabase :", error);
    return;
  }

  CADRES_DATA = data;
  await setBoutiqueCache(data);
}

async function renderBoutique(categoryKey) {
  const catBarContainer = document.getElementById("boutique-categories");
  const boutiqueContainer = document.getElementById("boutique-container");

  catBarContainer.innerHTML = "";
  const bar = document.createElement("div");
  bar.className = "categories-bar";
  CATEGORIES.forEach(cat => {
    const btn = document.createElement("button");
    btn.textContent = cat.nom;
    btn.className = "btn-categorie" + (cat.key === categoryKey ? " active" : "");
    btn.onclick = () => {
      currentCategory = cat.key;
      renderBoutique(cat.key);
    };
    bar.appendChild(btn);
  });
  catBarContainer.appendChild(bar);

  boutiqueContainer.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "grid-cadres";

  const cadresCat = CADRES_DATA.filter(cadre => getCategorie(cadre.id) === categoryKey);
  let ownedFrames = await getOwnedFrames();

  if (!cadresCat.length) {
    const empty = document.createElement("p");
    empty.textContent = "Aucun cadre dans cette catégorie.";
    grid.appendChild(empty);
  } else {
    for (const cadre of cadresCat) {
      const item = document.createElement("div");
      item.classList.add("cadre-item");

      const wrapper = document.createElement("div");
wrapper.classList.add("cadre-preview");
wrapper.style.width = "80px";
wrapper.style.height = "100px";
wrapper.style.position = "relative";
wrapper.style.margin = "0 auto 10px";

const cadreEl = document.createElement("img");
cadreEl.src = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadre.id}.webp`;
cadreEl.className = "photo-cadre";
cadreEl.style.width = "100%";
cadreEl.style.height = "100%";


const photo = document.createElement("img");
photo.src = "assets/img/exemple.jpg";
photo.className = "photo-user";

wrapper.appendChild(cadreEl);
wrapper.appendChild(photo);


      wrapper.addEventListener("click", () => {
        const popup = document.createElement("div");
        popup.className = "popup show";
        popup.innerHTML = `
          <div class="popup-inner">
            <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
            <div class="cadre-preview cadre-popup">
              <img class="photo-cadre" src="https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadre.id}.webp" />
              <img class="photo-user" src="assets/img/exemple.jpg" />
            </div>
          </div>
        `;
        document.body.appendChild(popup);
      });

      const title = document.createElement("h3");
      title.textContent = cadre.nom;

      const price = document.createElement("p");
      price.textContent = `${cadre.prix ? cadre.prix + " pièces" : ""}`;

      const button = document.createElement("button");

if (cadre.condition) {
  const unlockInfo = await checkCadreUnlock(cadre);
  if (unlockInfo.unlocked) {
    if (!ownedFrames.includes(cadre.id)) {
      // Si le cadre est à débloquer gratuitement via une condition, on l’ajoute direct
      if (!cadre.prix) {
        await acheterCadre(cadre.id);
        ownedFrames = await getOwnedFrames(true);
        showFeedback("🎉 Cadre débloqué !");
      }
      button.textContent = cadre.prix ? "Acheter" : "Débloqué !";
      button.disabled = !!cadre.prix ? false : true;
      if (cadre.prix) {
        button.addEventListener("click", () => acheterCadreBoutique(cadre.id, cadre.prix));
      } else {
        button.classList.add("btn-success");
      }
    } else {
      button.textContent = "Débloqué !";
      button.disabled = true;
      button.classList.add("btn-success");
    }
  } else {
    button.textContent = "Infos";
    button.disabled = false;
    button.classList.add("btn-info");
    button.onclick = () => showUnlockPopup(cadre.nom, unlockInfo.texte);
  }
} else if (categoryKey === "premium" && !(await isPremium())) {
  button.textContent = "Premium requis";
  button.disabled = true;
  button.classList.add("disabled-premium");
  button.title = "Ce cadre nécessite un compte premium";
} else if (ownedFrames.includes(cadre.id)) {
  button.textContent = "Acheté";
  button.disabled = true;
} else {
  button.textContent = "Acheter";
  button.addEventListener("click", () => acheterCadreBoutique(cadre.id, cadre.prix));
}

      item.appendChild(wrapper);
      item.appendChild(title);
      item.appendChild(price);
      item.appendChild(button);
      grid.appendChild(item);
    }
  }
  boutiqueContainer.appendChild(grid);
}

// === POPUP PREMIUM ===
function activerPremium() {
  const popup = document.getElementById("popup-premium");
  if (popup) popup.classList.remove("hidden");
}
function fermerPopupPremium() {
  const popup = document.getElementById("popup-premium");
  if (popup) popup.classList.add("hidden");
}
async function acheterPremium() {
  if (await removePoints(3500)) {
    await updateUserData({ premium: true });
    alert("✨ Bravo, tu es maintenant Premium !");
    window.location.reload(); // Recharge pour activer premium partout
  } else {
    alert("❌ Pas assez de pièces pour passer Premium (3500 nécessaires).");
  }
}

// === EXPOSE TO WINDOW POUR ACCÈS HTML INLINE ===
window.activerPremium = activerPremium;
window.fermerPopupPremium = fermerPopupPremium;
window.acheterPremium = acheterPremium;
window.removePoints = removePoints;
window.updateUserData = updateUserData;
window.closePopup = closePopup;
window.showUnlockPopup = showUnlockPopup;
window.ouvrirPopupJetonBoutique = ouvrirPopupJetonBoutique;
window.fermerPopupJetonBoutique = fermerPopupJetonBoutique;
window.acheterJetonsAvecPieces = acheterJetonsAvecPieces;
window.acheterJetonsAvecPub = acheterJetonsAvecPub;
window.watchAd = watchAd;
window.inviteFriend = inviteFriend;
window.afficherPhotosSauvegardees = afficherPhotosSauvegardees;

document.addEventListener('DOMContentLoaded', async () => {
  await fetchCadres();
  await renderBoutique('classique');
  await updatePointsDisplay();
  await updateJetonsDisplay();
});
