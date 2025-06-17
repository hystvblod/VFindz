import {
  getCadresPossedes,
  getCadreSelectionne,
  setCadreSelectionne
} from './js/userData.js';

// Liste des IDs de cadres dynamiques (draw/canvas)
const DRAW_IDS = [
  "etoiles", "bulles", "pixel", "neon", "vagues", "aquarelle",
  "feuilles", "cosmique", "pluie", "flammes"
];

// Renvoie l’URL du cadre : base64 local si dispo, sinon lien Supabase (pour images uniquement)
function getCadreUrl(id) {
  return localStorage.getItem(`cadre_${id}`) ||
    `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
}

// Crée dynamiquement l'élément cadre : <canvas> pour draw, <img> sinon
function createCadreElement(id, taille = {w:80, h:100}) {
  if (DRAW_IDS.includes(id)) {
    // Canvas dynamique
    const c = document.createElement("canvas");
    c.width = taille.w;
    c.height = taille.h;
    c.className = "photo-cadre";
    import('./js/cadres_draw.js').then(mod => {
      mod.previewCadre(c.getContext("2d"), id);
    });
    return c;
  } else {
    // Image classique
    const img = document.createElement("img");
    img.className = "photo-cadre";
    img.src = getCadreUrl(id);
    img.style.width = "100%";
    img.style.height = "100%";
    return img;
  }
}

// Zoom sur le cadre (popup)
function zoomCadre(id) {
  const popup = document.createElement("div");
  popup.className = "popup show";
  // On affiche un canvas si cadre "draw", sinon img
  const cadreEl = createCadreElement(id, {w: 180, h: 220});
  const photo = document.createElement("img");
  photo.className = "photo-user";
  photo.src = "./assets/img/exemple.jpg";
  cadreEl.style.display = "block";
  cadreEl.style.margin = "0 auto 10px";
  cadreEl.style.maxWidth = "180px";
  cadreEl.style.maxHeight = "220px";
  popup.innerHTML = `
    <div class="popup-inner">
      <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
      <div class="cadre-preview cadre-popup"></div>
    </div>
  `;
  popup.querySelector(".cadre-preview").appendChild(cadreEl);
  popup.querySelector(".cadre-preview").appendChild(photo);
  document.body.appendChild(popup);
}

// Sélectionner un cadre
async function utiliserCadre(id) {
  await setCadreSelectionne(id);
  alert("✅ Cadre sélectionné !");
  await afficherCadres();
}

// Affiche tous les cadres possédés
async function afficherCadres() {
  const container = document.getElementById("cadres-list");
  const cadresPossedes = await getCadresPossedes();
  const cadreActif = await getCadreSelectionne();

  container.innerHTML = "";

  if (!cadresPossedes.length) {
    container.innerHTML = "<p>Aucun cadre débloqué !</p>";
    return;
  }

  cadresPossedes.forEach(cadre => {
    const div = document.createElement("div");
    div.className = "cadre-item";

    // Aperçu du cadre : canvas ou img
    const preview = document.createElement("div");
    preview.className = "cadre-preview";
    preview.style.cursor = "zoom-in";
    preview.onclick = () => window.zoomCadre(cadre);

    const cadreEl = createCadreElement(cadre);
    preview.appendChild(cadreEl);

    const photo = document.createElement("img");
    photo.className = "photo-user";
    photo.src = "./assets/img/exemple.jpg";
    preview.appendChild(photo);

    // Bouton d'utilisation
    const btn = document.createElement("button");
    btn.onclick = () => window.utiliserCadre(cadre);
    btn.textContent = (cadre === cadreActif) ? "Utilisé" : "Utiliser";
    if (cadre === cadreActif) btn.disabled = true;

    div.appendChild(preview);
    div.appendChild(btn);
    container.appendChild(div);
  });
}

// Initialisation et synchro juste après un achat
document.addEventListener("DOMContentLoaded", async () => {
  window.zoomCadre = zoomCadre;
  window.utiliserCadre = utiliserCadre;

  // Patch : si la dernière update date de moins de 5 secondes,
  // force la resynchro cloud une fois (juste après un achat)
  const lastUpdate = parseInt(localStorage.getItem('lastCadresUpdate') || "0");
  if (Date.now() - lastUpdate < 5000) {
    await getCadresPossedes(true);
    localStorage.removeItem('lastCadresUpdate');
  }

  await afficherCadres();
});
