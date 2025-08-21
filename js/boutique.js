// === Dépendances : userData.js doit être chargé AVANT ce fichier ===
//
// Fonctions i18n requises AVANT ce script
// Exemple minimal à avoir globalement :
// const translations = { fr: {...}, en: {...}, ... };
// const currentLang = localStorage.getItem("lang") || "fr";
// function t(key, fallback) { return translations?.[currentLang]?.[key] || fallback || key; }

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
      return { unlocked: await window.isPremium(), texte: cadre.condition.texte || t("boutique.button.premium", "Compte premium requis") };
    case "jours_defis":
      if (typeof window.getJoursDefisRealises === "function") {
        const nb = await window.getJoursDefisRealises();
        return {
          unlocked: nb >= (cadre.condition.nombre || 0),
          texte: cadre.unlock || t("boutique.unlock.days", `Fais ${cadre.condition.nombre} jours de défis pour débloquer`)
        };
      }
      return { unlocked: false, texte: t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "inviter_amis":
      if (typeof window.getNbAmisInvites === "function") {
        const nb = await window.getNbAmisInvites();
        return {
          unlocked: nb >= (cadre.condition.nombre || 0),
          texte: cadre.unlock || t("boutique.unlock.invite", `Invite ${cadre.condition.nombre} amis`)
        };
      }
      return { unlocked: false, texte: t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "participation_concours":
      if (typeof window.getConcoursParticipationStatus === "function") {
        const ok = await window.getConcoursParticipationStatus();
        return {
          unlocked: ok,
          texte: cadre.unlock || t("boutique.unlock.concours", "Participe à un concours et vote au moins 3 jours")
        };
      }
      return { unlocked: false, texte: t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "telechargement_vzone":
      if (typeof window.hasDownloadedVZone === "function") {
        const ok = await window.hasDownloadedVZone();
        return {
          unlocked: ok,
          texte: cadre.unlock || t("boutique.unlock.vzone", "Télécharge le jeu VZone pour débloquer ce cadre.")
        };
      }
      return { unlocked: false, texte: t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    default:
      return { unlocked: false, texte: cadre.unlock || t("boutique.unlock.unknown", "Condition inconnue") };
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
  console.log(">>> acheterCadreBoutique", id, prix);
  await window.loadUserData(true); // force reload données utilisateur !
  const { data, error } = await window.supabase.rpc('secure_remove_points', { nb: prix });
  console.log(">>> acheterCadreBoutique: rpc result", data, error);
  if (error || !data || data.success !== true) {
    alert(t("boutique.feedback.error", "❌ Pas assez de pièces ou erreur !"));
    return;
  }

  await window.acheterCadre(id);

  // ✅ NOUVEAU : si cadre "draw" (canvas), NE PAS télécharger d'image .webp
  if (Array.isArray(window.DRAW_IDS) && window.DRAW_IDS.includes(id)) {
    localStorage.setItem('lastCadresUpdate', Date.now().toString());
  } else {
    // comportement image (inchangé)
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
      localStorage.setItem('lastCadresUpdate', Date.now().toString());
    } catch (e) {
      alert(t("boutique.feedback.base64error", "Erreur lors de l'enregistrement du cadre. Vérifie ta connexion."));
      return;
    }
  }

  await window.getOwnedFrames(true);
  await updatePointsDisplay();
  await updateJetonsDisplay();
  alert(t("boutique.feedback.success", "✅ Cadre acheté !"));
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
      <div style="margin:1em 0 0.5em 0;font-size:1.1em;text-align:center;">${message || t("boutique.unlock.none", "Aucune information.")}</div>
    </div>
  `;
  document.body.appendChild(popup);
}

// Gagne des pièces via pub simulée
async function watchAd() {
  console.log(">>> watchAd");
  await window.supabase.rpc('secure_add_points', { nb: 100 });
  await updatePointsDisplay();
  showFeedback("+100 💰");
  closePopup();
}

// --- Popup achat jetons ---
function ouvrirPopupJetonBoutique() {
  console.log(">>> ouvrirPopupJetonBoutique");
  const popup = document.getElementById("popup-achat-jeton");
  if (popup) popup.classList.remove("hidden");
}
function fermerPopupJetonBoutique() {
  const popup = document.getElementById("popup-achat-jeton");
  if (popup) popup.classList.add("hidden");
}
async function acheterJetonsAvecPieces() {
  console.log(">>> acheterJetonsAvecPieces");
  await window.loadUserData(true); // Sécurité anti-cache
  const { data, error } = await window.supabase.rpc('secure_remove_points', { nb: 100 });
  console.log(">>> acheterJetonsAvecPieces: rpc", data, error);
  if (error || !data || data.success !== true) {
    alert(t("boutique.feedback.error", "❌ Pas assez de pièces."));
    return;
  }
  await window.supabase.rpc('secure_add_jetons', { nb: 3 });
  alert(t("boutique.feedback.jetons", "✅ 3 jetons ajoutés !"));
  await updatePointsDisplay();
  await updateJetonsDisplay();
  fermerPopupJetonBoutique();
}
async function acheterJetonsAvecPub() {
  alert(t("boutique.feedback.simupub", " Simulation de pub regardée !"));
  setTimeout(async () => {
    await window.supabase.rpc('secure_add_jetons', { nb: 3 });
    alert(t("boutique.feedback.jetons", "✅ 3 jetons ajoutés !"));
    await updateJetonsDisplay();
    fermerPopupJetonBoutique();
  }, 3000);
}

// --- Affichage points/jetons ---
async function updatePointsDisplay() {
  console.log(">>> updatePointsDisplay");
  await window.loadUserData(true);
  const pointsDisplay = document.getElementById("points");
  if (pointsDisplay) {
    const profil = await window.getUserDataCloud();
    console.log(">>> updatePointsDisplay: profil", profil);
    pointsDisplay.textContent = profil.points || 0;
  }
}
async function updateJetonsDisplay() {
  console.log(">>> updateJetonsDisplay");
  await window.loadUserData(true);
  const jetonsSpan = document.getElementById("jetons");
  if (jetonsSpan) {
    const profil = await window.getUserDataCloud();
    console.log(">>> updateJetonsDisplay: profil", profil);
    jetonsSpan.textContent = profil.jetons || 0;
  }
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
  { key: 'premium',  nom: 'Premium'  },
  { key: 'bloque',   nom: 'Défi / Spéciaux 🔒' }
];

// ✅ Tous les cadres "draw" (canvas) sont rangés en "premium"
function getCategorie(id) {
  if (Array.isArray(window.DRAW_IDS) && window.DRAW_IDS.includes(id)) {
    return 'premium';
  }
  const num = parseInt(id.replace('polaroid_', ''));
  if (!Number.isNaN(num)) {
    if (num >= 1 && num <= 10)   return 'classique';
    if (num >= 11 && num <= 100) return 'prestige';
    if (num >= 101 && num <= 200) return 'premium';
    if (num >= 900 && num <= 1000) return 'bloque';
  }
  return 'autre';
}

// ---- PATCH MINIATURES DEFI (100% compatible draw)
async function afficherPhotosSauvegardees(photosMap) {
  const cadreActuel = await window.getCadreSelectionne();
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

      // ✅ cadre universel (canvas si draw, image sinon)
      const fond = (typeof window.createCadreElement === "function")
        ? window.createCadreElement(cadreActuel, { w: 90, h: 110 })
        : (function(){
            const img = document.createElement("img");
            img.className = "photo-cadre";
            img.src = window.getCadreUrl ? window.getCadreUrl(cadreActuel) : "";
            return img;
          })();

      const photo = document.createElement("img");
      photo.className = "photo-user";
      photo.src = dataUrl;
      photo.onclick = () => window.agrandirPhoto(dataUrl, id);

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
  console.log(">>> fetchCadres: start", force);
  if (!force) {
    const cached = await getBoutiqueCache();
    console.log(">>> fetchCadres: cache", cached);
    if (cached) {
      CADRES_DATA = cached;
      return;
    }
  }
  console.log(">>> fetchCadres: querying supabase...");
  const { data, error } = await window.supabase.from('cadres').select('*');
  console.log(">>> fetchCadres: supabase data", data, error);
  if (error || !data) {
    console.error("Erreur chargement Supabase :", error);
    return;
  }
  CADRES_DATA = data;
  await setBoutiqueCache(data);
  console.log(">>> fetchCadres: data ready, count =", data.length);
}

async function renderBoutique(categoryKey) {
  console.log(">>> renderBoutique", CADRES_DATA, categoryKey);
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

  console.log(">>> renderBoutique: filtering for category", categoryKey);
  const cadresCat = CADRES_DATA.filter(cadre => getCategorie(cadre.id) === categoryKey);
  console.log(">>> renderBoutique: cadresCat", cadresCat);

  let ownedFrames = [];
  if (typeof window.getOwnedFrames === "function") {
    ownedFrames = await window.getOwnedFrames();
    console.log(">>> renderBoutique: ownedFrames", ownedFrames);
  } else {
    console.log(">>> renderBoutique: window.getOwnedFrames is not a function");
  }

  if (!cadresCat.length) {
    const empty = document.createElement("p");
    empty.textContent = t("boutique.empty", "Aucun cadre dans cette catégorie.");
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

      // ✅ APERÇU UNIVERSAL : canvas si draw, image sinon
      const cadreEl = (typeof window.createCadreElement === "function")
        ? window.createCadreElement(cadre.id, { w: 80, h: 100 })
        : (function(){
            const img = document.createElement("img");
            img.className = "photo-cadre";
            img.src = window.getCadreUrl ? window.getCadreUrl(cadre.id) : "";
            img.style.width = "100%";
            img.style.height = "100%";
            return img;
          })();

      const photo = document.createElement("img");
      photo.src = "assets/img/exemple.jpg";
      photo.className = "photo-user";

      wrapper.innerHTML = "";
      wrapper.appendChild(cadreEl);
      wrapper.appendChild(photo);

      // ✅ POPUP de zoom avec aperçu universal
      wrapper.addEventListener("click", () => {
        const popup = document.createElement("div");
        popup.className = "popup show";
        popup.innerHTML = `
          <div class="popup-inner">
            <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
            <div class="cadre-preview cadre-popup" style="position:relative;"></div>
          </div>
        `;
        const holder = popup.querySelector(".cadre-preview");

        const bigCadre = (typeof window.createCadreElement === "function")
          ? window.createCadreElement(cadre.id, { w: 300, h: 375 })
          : (function(){
              const img = document.createElement("img");
              img.className = "photo-cadre";
              img.src = window.getCadreUrl ? window.getCadreUrl(cadre.id) : `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadre.id}.webp`;
              return img;
            })();

        holder.appendChild(bigCadre);

        const bigPhoto = document.createElement("img");
        bigPhoto.className = "photo-user";
        bigPhoto.src = "assets/img/exemple.jpg";
        holder.appendChild(bigPhoto);

        document.body.appendChild(popup);
      });

      const title = document.createElement("h3");
      title.textContent = cadre.nom;

      const price = document.createElement("p");
      price.textContent = `${cadre.prix ? cadre.prix + " " + t("label.pieces", "pièces") : ""}`;

      const button = document.createElement("button");

      if (cadre.condition) {
        const unlockInfo = await checkCadreUnlock(cadre);
        if (unlockInfo.unlocked) {
          if (!ownedFrames.includes(cadre.id)) {
            if (!cadre.prix) {
              await window.acheterCadre(cadre.id);
              ownedFrames = await window.getOwnedFrames(true);
              showFeedback("🎉 " + t("boutique.button.debloque", "Cadre débloqué !"));
            }
            button.textContent = cadre.prix ? t("boutique.button.acheter", "Acheter") : t("boutique.button.debloque", "Débloqué !");
            button.disabled = !!cadre.prix ? false : true;
            if (cadre.prix) {
              button.addEventListener("click", () => acheterCadreBoutique(cadre.id, cadre.prix));
            } else {
              button.classList.add("btn-success");
            }
          } else {
            button.textContent = t("boutique.button.debloque", "Débloqué !");
            button.disabled = true;
            button.classList.add("btn-success");
          }
        } else {
          button.textContent = t("boutique.button.infos", "Infos");
          button.disabled = false;
          button.classList.add("btn-info");
          button.onclick = () => showUnlockPopup(cadre.nom, unlockInfo.texte);
        }
      } else if (categoryKey === "premium" && !(await window.isPremium())) {
        button.textContent = t("boutique.button.premium", "Premium requis");
        button.disabled = true;
        button.classList.add("disabled-premium");
        button.title = t("boutique.button.premium", "Ce cadre nécessite un compte premium");
      } else if (ownedFrames.includes(cadre.id)) {
        button.textContent = t("boutique.button.achete", "Acheté");
        button.disabled = true;
      } else {
        button.textContent = t("boutique.button.acheter", "Acheter");
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

const PREMIUM_PRODUCT_ID = "premium_upgrade";

async function chargerProduits() {
  return new Promise((resolve, reject) => {
    if (!window.Cordova || !window.Cordova.plugins || !window.Cordova.plugins.purchase) {
      alert(t("boutique.feedback.nosupport", "Achat non supporté sur ce device."));
      return reject("Plugin non dispo");
    }
    window.Cordova.plugins.purchase.getProducts([PREMIUM_PRODUCT_ID], function(products) {
      resolve(products);
    }, function(err) {
      reject(err);
    });
  });
}

async function acheterPremium() {
  try {
    await chargerProduits();
    window.Cordova.plugins.purchase.buy(PREMIUM_PRODUCT_ID, 1, function (data) {
      window.updateUserData({ premium: true });
      alert(t("boutique.feedback.premium", " Bravo, tu es maintenant Premium !"));
      window.location.reload();
    }, function (err) {
      alert(t("boutique.feedback.premiumerror", "Erreur achat Premium : ") + JSON.stringify(err));
    });
  } catch (e) {
    alert(t("boutique.feedback.nodisponible", "Achat non disponible : ") + e);
  }
}

// === EXPOSE TO WINDOW POUR ACCÈS HTML INLINE ===
window.checkCadreUnlock = checkCadreUnlock;
window.showFeedback = showFeedback;
window.acheterCadreBoutique = acheterCadreBoutique;
window.closePopup = closePopup;
window.showUnlockPopup = showUnlockPopup;
window.watchAd = watchAd;
window.ouvrirPopupJetonBoutique = ouvrirPopupJetonBoutique;
window.fermerPopupJetonBoutique = fermerPopupJetonBoutique;
window.acheterJetonsAvecPieces = acheterJetonsAvecPieces;
window.acheterJetonsAvecPub = acheterJetonsAvecPub;
window.updatePointsDisplay = updatePointsDisplay;
window.updateJetonsDisplay = updateJetonsDisplay;
window.afficherPhotosSauvegardees = afficherPhotosSauvegardees;
window.fetchCadres = fetchCadres;
window.renderBoutique = renderBoutique;
window.activerPremium = activerPremium;
window.fermerPopupPremium = fermerPopupPremium;
window.acheterPremium = acheterPremium;

// INIT
document.addEventListener('DOMContentLoaded', async () => {
  console.log(">>> BOUTIQUE: DOMContentLoaded, launch main sequence");
  await window.loadUserData(true);   // 1️⃣ FORCE la synchro cloud (et vide le cache)
  console.log(">>> BOUTIQUE: loaded user data");
  await fetchCadres(true);           // 2️⃣ FORCE le fetch cloud pour les cadres (pas le cache local)
  console.log(">>> BOUTIQUE: fetched cadres");
  await renderBoutique('classique'); // 3️⃣ Affiche la boutique avec la vraie data
  console.log(">>> BOUTIQUE: rendered boutique classique");
  await updatePointsDisplay();       // 4️⃣ Recharge pièces à jour depuis cloud
  await updateJetonsDisplay();       // 5️⃣ Recharge jetons à jour depuis cloud
  console.log(">>> BOUTIQUE: displays updated (points, jetons)");
});
