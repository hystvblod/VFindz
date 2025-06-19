// --- AUCUN await global ici ! ---
// getUserId() et loadUserData() sont déjà sur window via userData.js

// Si tu as un objet PIECE_PACKS dans un autre fichier, importe-le aussi
const API_URL = 'https://vfindez-api.vercel.app/api/validate-receipt';

// Appelle cette fonction APRES que deviceready a été déclenché !
function initAchats() {
  if (!window.store) {
    alert("Le plugin achat n'est pas chargé !");
    return;
  }

  // Déclare tous tes produits ici
  const PRODUCTS = [
    { id: "premium", type: window.store.NON_CONSUMABLE },
    // { id: "pack_500", type: window.store.CONSUMABLE }, // ex pour des pièces
    // { id: "pack_2000", type: window.store.CONSUMABLE },
  ];

  PRODUCTS.forEach(prod => window.store.register(prod));

  // Callback général pour chaque produit approuvé
  PRODUCTS.forEach(prod => {
    window.store.when(prod.id).approved(async function(order) {
      // Utilise window.loadUserData et window.getUserId pour être certain d'utiliser le cache correct
      await window.loadUserData();
      const userId = window.getUserId();
      let quantite = 0;
      if (prod.id.startsWith("pack_") && typeof PIECE_PACKS !== 'undefined') {
        const pack = PIECE_PACKS[prod.id];
        if (pack) quantite = pack.base + pack.bonus;
      }

      // Prépare reçu selon la plateforme
      let receipt = order?.transaction?.id || "";
      let plateforme = (window.device?.platform || "").toLowerCase().includes('android') ? "android" : "ios";

      // Envoi au backend
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            achat: prod.id,
            quantite,
            receipt,
            plateforme
          })
        });
        const result = await res.json();
        if (result.success) {
          alert(result.message || "Achat validé !");
        } else {
          alert("Erreur : " + (result.error || "inconnue"));
        }
      } catch (err) {
        alert("Erreur lors de la validation serveur : " + (err.message || err));
      }

      order.finish();
    });
  });

  // Gestion erreur achat
  window.store.error(function(err) {
    alert("Erreur achat : " + err.message);
  });

  window.store.refresh();

  // Fonction globale à appeler selon le produit voulu
  window.validerAchat = function(achat) {
    // Vérifie d'abord si le produit existe
    const prod = PRODUCTS.find(p => p.id === achat);
    if (!prod) {
      alert("Produit inconnu : " + achat);
      return;
    }
    window.store.order(achat);
  };
}

// Démarre le setup achats APRES deviceready !
document.addEventListener('deviceready', function() {
  initAchats();
});
