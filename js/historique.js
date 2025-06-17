import { db, initFirebaseUser, getHistoriquePhotos } from './firebase.js';
// On suppose que drawPolaroid est déjà global via polaroid.js

document.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("historique-gallery");

  await initFirebaseUser();
  let photos = [];

  // Chargement direct Firestore (via helper centralisé)
  try {
    photos = await getHistoriquePhotos();
  } catch (e) {
    console.warn("Erreur Firebase, fallback localStorage :", e);
    // (Optionnel) Fallback localStorage si migration en cours
    if (typeof getHistoriquePhotos === "function") {
      photos = getHistoriquePhotos();
    }
  }

  // Affichage des photos (polaroids)
  if (!photos || photos.length === 0) {
    container.innerHTML = "<p>Aucun défi encore réalisé.</p>";
  } else {
    photos.forEach(entry => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 400;
      // .base64 (recommandé), .photo (fallback) ; .cadre ou .cadreActif si dispo
      drawPolaroid(
        entry.base64 || entry.photo,
        entry.cadre || entry.cadreActif || "polaroid_01",
        canvas
      );
      container.appendChild(canvas);
    });
  }
});
