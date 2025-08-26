// === Dépendances : userData.js / i18n.js / pub.js avant ce fichier ===

// Petites aides i18n facultatives
function _t(key, fallback) {
  try { return typeof t === 'function' ? t(key, fallback || key) : (fallback || key); }
  catch { return fallback || key; }
}

/* ---------------- Affichages solde ---------------- */
async function updatePointsDisplay() {
  await window.loadUserData?.(true);
  const el = document.getElementById("points");
  if (el) {
    const profil = await window.getUserDataCloud?.();
    el.textContent = (profil && typeof profil.points === "number") ? profil.points : 0;
  }
}
async function updateJetonsDisplay() {
  await window.loadUserData?.(true);
  const el = document.getElementById("jetons");
  if (el) {
    const profil = await window.getUserDataCloud?.();
    el.textContent = (profil && typeof profil.jetons === "number") ? profil.jetons : 0;
  }
}

/* ---------------- Popups jetons ---------------- */
function ouvrirPopupJetonBoutique() {
  const popup = document.getElementById("popup-achat-jeton");
  if (!popup) return;
  popup.classList.remove("hidden");

  // Met à jour les prix des packs jetons (12/50) via Store
  try {
    if (typeof window.refreshStoreProducts === "function") window.refreshStoreProducts();
    setTimeout(() => {
      const ids = ["tokens_12", "tokens_50"];
      ids.forEach(id => {
        const span = document.getElementById("price-" + id);
        const price = typeof window.getStorePrice === "function" ? window.getStorePrice(id) : null;
        if (span && price) span.textContent = price;
      });
    }, 600);
  } catch {}
}
function fermerPopupJetonBoutique() {
  const popup = document.getElementById("popup-achat-jeton");
  if (popup) popup.classList.add("hidden");
}

// 1 jeton = 100 pièces
async function acheterJetonAvecPieces() {
  try {
    await window.loadUserData?.(true);
    const { data, error } = await window.supabase.rpc('secure_remove_points', { nb: 100 });
    if (error || !data || data.success !== true) {
      alert(_t("boutique.feedback.error", "❌ Pas assez de pièces."));
      return;
    }
    await window.supabase.rpc('secure_add_jetons', { nb: 1 });
    alert(_t("boutique.feedback.jeton1", "✅ 1 jeton ajouté !"));
    await updatePointsDisplay();
    await updateJetonsDisplay();
  } catch (e) {
    alert("Erreur: " + (e?.message || e));
  } finally {
    fermerPopupJetonBoutique();
  }
}

// 🎬 1 pub = 1 jeton (crédit après event rewarded via pub.js)
async function acheterJetonAvecPub() {
  try {
    await window.showRewardBoutique?.(); // crédite à l’événement rewarded
  } catch (e) {
    alert("Erreur: " + (e?.message || e));
  } finally {
    fermerPopupJetonBoutique();
  }
}

// Packs jetons (Store uniquement) : tokens_12 / tokens_50
async function acheterPackJetons(productId) {
  try {
    if (typeof window.validerAchat !== "function") {
      alert("Achat non disponible sur ce device.");
      return;
    }
    // On lance l'achat via le plugin (pas d'attente/retour)
    window.validerAchat(productId);
  } catch (e) {
    alert("Achat annulé ou erreur : " + (e?.message || e));
  } finally {
    fermerPopupJetonBoutique();
  }
}

/* ---------------- Popups pièces ---------------- */
function ouvrirPopupPiecesBoutique() {
  const el = document.getElementById("popup-achat-pieces");
  if (!el) return;
  el.classList.remove("hidden");

  // Prix dynamiques packs pièces
  try {
    if (typeof window.refreshStoreProducts === "function") window.refreshStoreProducts();
    setTimeout(() => {
      const ids = ["coins_099","coins_199","coins_399","coins_999"];
      ids.forEach(id => {
        const span = document.getElementById("price-" + id);
        const price = typeof window.getStorePrice === "function" ? window.getStorePrice(id) : null;
        if (span && price) span.textContent = price;
      });
    }, 600);
  } catch {}
}
function fermerPopupPiecesBoutique() {
  const el = document.getElementById("popup-achat-pieces");
  if (el) el.classList.add("hidden");
}

// 🎬 Pub → +100 pièces (crédit après event rewarded via pub.js)
async function acheterPiecesAvecPub() {
  try {
    await window.showRewardVcoins?.(); // crédite à l’événement rewarded
  } catch (e) {
    alert("Erreur: " + (e?.message || e));
  } finally {
    fermerPopupPiecesBoutique();
  }
}

// 👥 Parrainage → +300 pièces (fixe)
async function acheterPiecesParrainage() {
  try {
    // branche ton flux réel de parrainage :
    const ok = await window.demarrerParrainage?.();
    if (!ok) return;
    await window.supabase.rpc('secure_add_points', { nb: 300 });
    await updatePointsDisplay();
    alert(_t("boutique.feedback.coins300", "✅ +300 pièces !"));
  } catch (e) {
    alert("Erreur: " + (e?.message || e));
  } finally {
    fermerPopupPiecesBoutique();
  }
}

// Packs pièces via Store
async function acheterPackPieces(packId) {
  try {
    if (typeof window.validerAchat !== "function") {
      alert("Achat non disponible sur ce device.");
      return;
    }
    // On lance l'achat via le plugin (pas d'attente/retour, pas de crédit local ici)
    window.validerAchat(packId);
  } catch (e) {
    alert("Achat annulé ou erreur : " + (e?.message || e));
  } finally {
    fermerPopupPiecesBoutique();
  }
}

/* ---------------- Boutique Cadres (inchangé côté logique prix) ---------------- */
const CATEGORIES = [
  { key: 'classique', nom: 'Classique' },
  { key: 'prestige',  nom: 'Prestige' },
  { key: 'premium',   nom: 'Premium' },
  { key: 'bloque',    nom: 'Défi / Spéciaux 🔒' }
];
function getCategorie(id) {
  const num = parseInt(String(id).replace('polaroid_', ''));
  if (num >= 1 && num <= 10)   return 'classique';
  if (num >= 11 && num <= 100) return 'prestige';
  if (num >= 101 && num <= 200) return 'premium';
  if (num >= 900 && num <= 1000) return 'bloque';
  return 'autre';
}

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

async function checkCadreUnlock(cadre) {
  if (!cadre.condition) return { unlocked: true };
  switch (cadre.condition.type) {
    case "premium":
      return { unlocked: await window.isPremium?.(), texte: cadre.condition.texte || _t("boutique.button.premium", "Compte premium requis") };
    case "jours_defis":
      if (typeof window.getJoursDefisRealises === "function") {
        const nb = await window.getJoursDefisRealises();
        return { unlocked: nb >= (cadre.condition.nombre || 0), texte: cadre.unlock || _t("boutique.unlock.days", `Fais ${cadre.condition.nombre} jours de défis pour débloquer`) };
      }
      return { unlocked: false, texte: _t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "inviter_amis":
      if (typeof window.getNbAmisInvites === "function") {
        const nb = await window.getNbAmisInvites();
        return { unlocked: nb >= (cadre.condition.nombre || 0), texte: cadre.unlock || _t("boutique.unlock.invite", `Invite ${cadre.condition.nombre} amis`) };
      }
      return { unlocked: false, texte: _t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "participation_concours":
      if (typeof window.getConcoursParticipationStatus === "function") {
        const ok = await window.getConcoursParticipationStatus();
        return { unlocked: ok, texte: cadre.unlock || _t("boutique.unlock.concours", "Participe à un concours et vote au moins 3 jours") };
      }
      return { unlocked: false, texte: _t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    case "telechargement_vzone":
      if (typeof window.hasDownloadedVZone === "function") {
        const ok = await window.hasDownloadedVZone();
        return { unlocked: ok, texte: cadre.unlock || _t("boutique.unlock.vzone", "Télécharge le jeu VZone pour débloquer ce cadre.") };
      }
      return { unlocked: false, texte: _t("boutique.unlock.nofunc", "Fonction de check non dispo") };
    default:
      return { unlocked: false, texte: cadre.unlock || _t("boutique.unlock.unknown", "Condition inconnue") };
  }
}

let CADRES_DATA = [];
let currentCategory = 'classique';

async function fetchCadres(force = false) {
  if (!force) {
    const cached = await getBoutiqueCache();
    if (cached) { CADRES_DATA = cached; return; }
  }
  const { data, error } = await window.supabase.from('cadres').select('*');
  if (error || !data) {
    console.error("Erreur chargement Supabase :", error);
    return;
  }
  CADRES_DATA = data;
  await setBoutiqueCache(data);
}

async function acheterCadreBoutique(id, prix) {
  await window.loadUserData?.(true);
  const { data, error } = await window.supabase.rpc('secure_remove_points', { nb: prix });
  if (error || !data || data.success !== true) {
    alert(_t("boutique.feedback.error", "❌ Pas assez de pièces ou erreur !"));
    return;
  }
  await window.acheterCadre?.(id);

  // cache local image
  const url = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
  try {
    const res = await fetch(url, { cache: "reload" });
    const blob = await res.blob();
    await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => { localStorage.setItem(`cadre_${id}`, reader.result); resolve(); };
      reader.readAsDataURL(blob);
    });
  } catch {}
  localStorage.setItem('lastCadresUpdate', Date.now().toString());
  await window.getOwnedFrames?.(true);
  await updatePointsDisplay();
  await updateJetonsDisplay();
  alert(_t("boutique.feedback.success", "✅ Cadre acheté !"));
  await renderBoutique(currentCategory);
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
    btn.onclick = () => { currentCategory = cat.key; renderBoutique(cat.key); };
    bar.appendChild(btn);
  });
  catBarContainer.appendChild(bar);

  boutiqueContainer.innerHTML = "";
  const grid = document.createElement("div");
  grid.id = "cadres-grid";
  grid.className = "grid-cadres";

  const cadresCat = CADRES_DATA.filter(cadre => getCategorie(cadre.id) === categoryKey);
  let ownedFrames = [];
  if (typeof window.getOwnedFrames === "function") {
    ownedFrames = await window.getOwnedFrames();
  }

  if (!cadresCat.length) {
    const empty = document.createElement("p");
    empty.textContent = _t("boutique.empty", "Aucun cadre dans cette catégorie.");
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
      if (typeof window.getCadreUrl === "function") {
        cadreEl.src = window.getCadreUrl(cadre.id);
      } else {
        cadreEl.src = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${cadre.id}.webp`;
      }
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
          </div>`;
        document.body.appendChild(popup);
      });

      // ---- Titre, Prix, Bouton avec classes pour le CSS ----
      const title = document.createElement("h3");
      title.className = "cadre-title";
      title.textContent = cadre.nom;

      const price = document.createElement("p");
      price.className = "cadre-price";
      price.textContent = `${cadre.prix ? cadre.prix + " " + _t("label.pieces", "pièces") : ""}`;

      const button = document.createElement("button");
      button.className = "cadre-cta";

      if (cadre.condition) {
        const unlockInfo = await checkCadreUnlock(cadre);
        if (unlockInfo.unlocked) {
          if (!ownedFrames.includes(cadre.id)) {
            if (!cadre.prix) {
              await window.acheterCadre?.(cadre.id);
              ownedFrames = await window.getOwnedFrames?.(true) || ownedFrames;
              alert("🎉 " + _t("boutique.button.debloque", "Cadre débloqué !"));
            }
            button.textContent = cadre.prix ? _t("boutique.button.acheter", "Acheter") : _t("boutique.button.debloque", "Débloqué !");
            button.disabled = !!cadre.prix ? false : true;
            if (cadre.prix) button.addEventListener("click", () => acheterCadreBoutique(cadre.id, cadre.prix));
            else button.classList.add("btn-success"); // garde l’état visuel
          } else {
            button.textContent = _t("boutique.button.debloque", "Débloqué !");
            button.disabled = true;
            button.classList.add("btn-success");
          }
        } else {
          button.textContent = _t("boutique.button.infos", "Infos");
          button.disabled = false;
          button.classList.add("btn-info");
          button.onclick = () => {
            const pop = document.createElement("div");
            pop.className = "popup show";
            pop.innerHTML = `
              <div class="popup-inner">
                <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
                <h2 style="font-size:1.4em;">${cadre.nom}</h2>
                <div style="margin:1em 0 0.5em 0;font-size:1.1em;text-align:center;">${unlockInfo.texte}</div>
              </div>
            `;
            document.body.appendChild(pop);
          };
        }
      } else if (categoryKey === "premium" && !(await window.isPremium?.())) {
        button.textContent = _t("boutique.button.premium", "Premium requis");
        button.disabled = true;
        button.classList.add("disabled-premium");
        button.title = _t("boutique.button.premium", "Ce cadre nécessite un compte premium");
      } else if (ownedFrames.includes(cadre.id)) {
        button.textContent = _t("boutique.button.achete", "Acheté");
        button.disabled = true;
      } else {
        button.textContent = _t("boutique.button.acheter", "Acheter");
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

/* ---------------- Premium ---------------- */
function activerPremium() {
  const popup = document.getElementById("popup-premium");
  if (popup) popup.classList.remove("hidden");
}
function fermerPopupPremium() {
  const popup = document.getElementById("popup-premium");
  if (popup) popup.classList.add("hidden");
}
async function acheterPremium() {
  if (typeof window.validerAchat === 'function') {
    // Déclenche l'achat premium via le plugin
    window.validerAchat('premium');
    return;
  }
  alert("Achat non disponible sur ce device.");
}

/* ---------------- Expose Window ---------------- */
window.updatePointsDisplay = updatePointsDisplay;
window.updateJetonsDisplay = updateJetonsDisplay;

window.ouvrirPopupJetonBoutique = ouvrirPopupJetonBoutique;
window.fermerPopupJetonBoutique = fermerPopupJetonBoutique;
window.acheterJetonAvecPieces = acheterJetonAvecPieces;
window.acheterJetonAvecPub = acheterJetonAvecPub;
window.acheterPackJetons = acheterPackJetons;

window.ouvrirPopupPiecesBoutique = ouvrirPopupPiecesBoutique;
window.fermerPopupPiecesBoutique = fermerPopupPiecesBoutique;
window.acheterPiecesAvecPub = acheterPiecesAvecPub;
window.acheterPiecesParrainage = acheterPiecesParrainage;
window.acheterPackPieces = acheterPackPieces;

window.fetchCadres = fetchCadres;
window.renderBoutique = renderBoutique;
window.acheterCadreBoutique = acheterCadreBoutique;

window.activerPremium = activerPremium;
window.fermerPopupPremium = fermerPopupPremium;
window.acheterPremium = acheterPremium;

/* ---------------- INIT ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  await window.loadUserData?.(true);
  await fetchCadres(true);
  await renderBoutique('classique');
  await updatePointsDisplay();
  await updateJetonsDisplay();
});
