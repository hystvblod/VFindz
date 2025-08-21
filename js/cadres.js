// ========== cadres.js 100% compatible Capacitor (no import/export) ==========
// userData.js doit être chargé AVANT pour exposer toutes ses fonctions sur window
// (window.getCadresPossedes, window.getCadreSelectionne, window.setCadreSelectionne, etc.)

// ---------------------------------------------------------------------------
// 1) Liste des IDs de cadres dynamiques (draw/canvas)
//    ➜ Ajoute ici les nouveaux effets (ils sont implémentés plus bas)
const DRAW_IDS = [
  // existants dans ton projet
  "etoiles", "bulles", "pixel", "neon", "vagues", "aquarelle",
  "feuilles", "cosmique", "pluie", "flammes",
  // nouveaux "ultra pro" prêts à l'emploi
  "stardust", "aurora", "glowgrid"
];
window.DRAW_IDS = DRAW_IDS; // exposé global

// ---------------------------------------------------------------------------
// 2) URL du cadre image : base64 local si dispo, sinon lien Supabase
function getCadreUrl(id) {
  return localStorage.getItem(`cadre_${id}`) ||
    `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
}
window.getCadreUrl = getCadreUrl;

// ---------------------------------------------------------------------------
// 3) Création de l'élément d’aperçu cadre : <canvas> si draw, <img> sinon

function createCadreElement(id, taille = { w: 80, h: 100 }) {
  if (DRAW_IDS.includes(id)) {
    const c = document.createElement("canvas");
    c.width = taille.w;
    c.height = taille.h;
    c.className = "photo-cadre";

    // ⬇️ styles inline indispensables car ton CSS cible <img.photo-cadre>
    c.style.position = "absolute";
    c.style.inset = "0";
    c.style.width = "100%";
    c.style.height = "100%";
    c.style.zIndex = "2";          // le cadre (canvas) AU-DESSUS de la photo
    c.style.pointerEvents = "none";

    const ctx = c.getContext("2d");
    if (window.previewCadre) window.previewCadre(ctx, id);
    return c;
  } else {
    const img = document.createElement("img");
    img.className = "photo-cadre";
    img.src = getCadreUrl(id);
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    // (si ton CSS global met déjà position/z-index sur img.photo-cadre, ne rien changer)
    return img;
  }
}

window.createCadreElement = createCadreElement;

// ---------------------------------------------------------------------------
// 4) Popup zoom cadre
function zoomCadre(id) {
  const popup = document.createElement("div");
  popup.className = "popup show";
  const cadreEl = createCadreElement(id, { w: 300, h: 375 });

  const photo = document.createElement("img");
  photo.className = "photo-user";
  photo.src = "./assets/img/exemple.jpg";

  popup.innerHTML = `
    <div class="popup-inner">
      <button id="close-popup" onclick="document.body.removeChild(this.parentNode.parentNode)">✖</button>
      <div class="cadre-preview cadre-popup" style="position:relative;"></div>
    </div>
  `;
  const holder = popup.querySelector(".cadre-preview");
  holder.appendChild(cadreEl); // cadre (canvas ou image)
  holder.appendChild(photo);   // photo (par-dessus, cf. CSS .photo-user z-index)

  document.body.appendChild(popup);
}
window.zoomCadre = zoomCadre;

// ---------------------------------------------------------------------------
// 5) Sélectionner un cadre actif
async function utiliserCadre(id) {
  if (typeof window.setCadreSelectionne === "function") {
    await window.setCadreSelectionne(id);
    alert("✅ Cadre sélectionné !");
    await afficherCadres();
  } else {
    alert("Erreur : setCadreSelectionne non disponible.");
  }
}
window.utiliserCadre = utiliserCadre;

// ---------------------------------------------------------------------------
// 6) Afficher tous les cadres possédés (Mes cadres)
async function afficherCadres() {
  const container = document.getElementById("cadres-list");
  if (!container) return;

  const getCadresPossedes = window.getCadresPossedes;
  const getCadreSelectionne = window.getCadreSelectionne;

  if (!getCadresPossedes || !getCadreSelectionne) {
    container.innerHTML = `<p>Erreur : fonctions non chargées.</p>`;
    return;
  }

  const cadresPossedes = await getCadresPossedes();
  const cadreActif = await getCadreSelectionne();

  container.innerHTML = "";

  if (!cadresPossedes || !cadresPossedes.length) {
    container.innerHTML = "<p>Aucun cadre débloqué !</p>";
    return;
  }

  cadresPossedes.forEach((cadreId) => {
    const card = document.createElement("div");
    card.className = "cadre-item";

    // Aperçu
    const preview = document.createElement("div");
    preview.className = "cadre-preview";
    preview.style.cursor = "zoom-in";
    preview.onclick = () => window.zoomCadre(cadreId);

    const cadreEl = createCadreElement(cadreId, { w: 300, h: 375 });
    preview.appendChild(cadreEl);

    // Photo par-dessus (superposition gérée par ta CSS .photo-user)
    const photo = document.createElement("img");
    photo.className = "photo-user";
    photo.src = "./assets/img/exemple.jpg";
    preview.appendChild(photo);

    // Bouton
    const btn = document.createElement("button");
    btn.onclick = () => window.utiliserCadre(cadreId);
    btn.textContent = (cadreId === cadreActif) ? "Utilisé" : "Utiliser";
    if (cadreId === cadreActif) btn.disabled = true;

    card.appendChild(preview);
    card.appendChild(btn);
    container.appendChild(card);
  });
}
window.afficherCadres = afficherCadres;

// ---------------------------------------------------------------------------
// 7) Init auto (utile sur la page "Mes cadres")
document.addEventListener("DOMContentLoaded", async () => {
  // Patch : si la dernière update date de moins de 5 sec, resync après achat
  const lastUpdate = parseInt(localStorage.getItem('lastCadresUpdate') || "0", 10);
  if (Date.now() - lastUpdate < 5000 && typeof window.getCadresPossedes === "function") {
    await window.getCadresPossedes(true);
    localStorage.removeItem('lastCadresUpdate');
  }

  // Si la page a #cadres-list, affiche
  if (document.getElementById("cadres-list")) {
    await afficherCadres();
  }
});

// ---------------------------------------------------------------------------
// 8) MOTEUR D’EFFETS ULTRA-PRO (dessin canvas) — previewCadre / overlayCadre
//    ➜ Aucun autre fichier requis. Tout est ici.
// ---------------------------------------------------------------------------

(function () {
  // util: boucle anim + auto-stop si canvas retiré du DOM
  function animate(ctx, drawFrame) {
    let raf;
    function loop() {
      if (!document.body.contains(ctx.canvas)) return; // stop propre
      drawFrame();
      raf = requestAnimationFrame(loop);
    }
    loop();
    return () => cancelAnimationFrame(raf);
  }

  // Effet PRO 1 : Néon pulsé premium
  function drawNeon(ctx, w, h) {
    const border = 10;
    let t0 = performance.now();
    return animate(ctx, () => {
      const t = (performance.now() - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      // cadre arrière léger
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(0,255,255,0.15)";
      ctx.strokeRect(border, border, w - 2*border, h - 2*border);
      ctx.restore();

      // glow principal
      ctx.save();
      ctx.lineWidth = 8;
      ctx.shadowBlur = 22 + 10 * Math.sin(t * 2.2);
      ctx.shadowColor = "rgba(0,255,255,0.95)";
      ctx.strokeStyle  = "rgba(0,255,255,0.65)";
      ctx.strokeRect(border, border, w - 2*border, h - 2*border);
      ctx.restore();

      // balayage doux
      ctx.save();
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0.0, "rgba(0,255,255,0.0)");
      grad.addColorStop(0.5 + 0.5*Math.sin(t*1.5), "rgba(255,255,255,0.25)");
      grad.addColorStop(1.0, "rgba(0,255,255,0.0)");
      ctx.fillStyle = grad;
      ctx.fillRect(border+3, border+3, w - 2*(border+3), h - 2*(border+3));
      ctx.restore();
    });
  }

  // Effet PRO 2 : Stardust (poussière d’étoiles dynamique)
  function drawStardust(ctx, w, h) {
    const N = 60;
    const stars = Array.from({ length: N }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.8 + 0.6,
      vx: 0.25 + Math.random() * 0.6,
      tw: Math.random() * Math.PI * 2
    }));
    return animate(ctx, () => {
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + 0.35 * Math.sin(performance.now()/350 + s.tw);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fill();
        s.x += s.vx;
        if (s.x > w + 2) { s.x = -2; s.y = Math.random() * h; }
      }
      ctx.restore();

      // bord discret
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.restore();
    });
  }

  // Effet PRO 3 : Aurora (voiles lumineux type aurore)
  function drawAurora(ctx, w, h) {
    let t0 = performance.now();
    return animate(ctx, () => {
      const t = (performance.now() - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      // bande 1
      ctx.save();
      let grad1 = ctx.createLinearGradient(0, 0, w, h);
      grad1.addColorStop(0,   `rgba(120, 50, 255, ${0.18 + 0.12*Math.sin(t*0.9)})`);
      grad1.addColorStop(0.5, `rgba(50, 200, 255, ${0.18 + 0.12*Math.cos(t*1.1)})`);
      grad1.addColorStop(1,   `rgba(0, 0, 0, 0)`);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = grad1;
      ctx.beginPath();
      const y1 = 20 + 10*Math.sin(t*1.2);
      ctx.moveTo(0, y1);
      for (let x=0; x<=w; x+=20) {
        ctx.lineTo(x, y1 + 15*Math.sin(x*0.04 + t*1.8));
      }
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      ctx.fill();
      ctx.restore();

      // bande 2
      ctx.save();
      let grad2 = ctx.createLinearGradient(w, 0, 0, h);
      grad2.addColorStop(0,   `rgba(255, 80, 180, ${0.12 + 0.10*Math.cos(t*0.7)})`);
      grad2.addColorStop(1,   `rgba(0, 0, 0, 0)`);
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = grad2;
      ctx.beginPath();
      const y2 = h-20 + 10*Math.cos(t*1.3);
      ctx.moveTo(0, h);
      for (let x=0; x<=w; x+=20) {
        ctx.lineTo(x, y2 + 18*Math.cos(x*0.035 + t*1.3));
      }
      ctx.lineTo(w, h); ctx.closePath();
      ctx.fill();
      ctx.restore();

      // bord doux
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.strokeRect(8,8,w-16,h-16);
      ctx.restore();
    });
  }

  // Effet PRO 4 : GlowGrid (grille techno animée)
  function drawGlowGrid(ctx, w, h) {
    let t0 = performance.now();
    return animate(ctx, () => {
      const t = (performance.now() - t0) / 1000;
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = "rgba(0,255,200,0.25)";
      ctx.lineWidth = 1;

      const cell = 20;
      const phase = (t * 30) % cell;

      // verticales
      for (let x = -phase; x < w; x += cell) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      // horizontales
      for (let y = phase; y < h + cell; y += cell) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();

      // halo de bord
      ctx.save();
      ctx.lineWidth = 6;
      ctx.shadowBlur = 16;
      ctx.shadowColor = "rgba(0,255,200,0.65)";
      ctx.strokeStyle  = "rgba(0,255,200,0.35)";
      ctx.strokeRect(10,10,w-20,h-20);
      ctx.restore();
    });
  }

  // Mapping ID -> fonction de dessin
  const DRAWERS = {
    neon:     drawNeon,
    etoiles:  drawStardust, // "etoiles" = alias de stardust
    stardust: drawStardust,
    aurora:   drawAurora,
    glowgrid: drawGlowGrid,
    // placeholders pour IDs déjà présents (bulles, pixel, vagues, aquarelle, feuilles, cosmique, pluie, flammes)
    bulles:   drawStardust,
    pixel:    drawGlowGrid,
    vagues:   drawAurora,
    aquarelle:drawAurora,
    feuilles: drawStardust,
    cosmique: drawStardust,
    pluie:    drawGlowGrid,
    flammes:  drawNeon
  };

  // Aperçu autonome (utilisé par createCadreElement)
  function previewCadre(ctx, id) {
    const c = ctx.canvas, w = c.width, h = c.height;
    const fn = DRAWERS[id] || ((ctx,w,h) => {
      ctx.clearRect(0,0,w,h);
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.strokeRect(10, 10, w-20, h-20);
    });
    fn(ctx, w, h);
  }

  // Overlay par-dessus une photo déjà peinte dans ctx
  // (à utiliser sur les écrans où tu composes photo + cadre dans un même canvas)
  function overlayCadre(ctx, id, w, h) {
    const fn = DRAWERS[id];
    if (!fn) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 6;
      ctx.strokeStyle = "white";
      ctx.strokeRect(10,10,w-20,h-20);
      ctx.restore();
      return;
    }
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    fn(octx, w, h); // anime en offscreen

    // copie continue du frame offscreen vers ctx
    (function copy() {
      if (!document.body.contains(ctx.canvas)) return;
      ctx.save();
      ctx.globalCompositeOperation = "screen"; // blend doux
      ctx.drawImage(off, 0, 0);
      ctx.restore();
      requestAnimationFrame(copy);
    })();
  }

  // Expose global
  window.previewCadre  = previewCadre;
  window.overlayCadre  = overlayCadre;
})();
