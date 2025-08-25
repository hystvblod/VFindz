// --- js/achats.js ---
// AUCUN await global ici.
// Nécessite cordova-plugin-purchase (cc.fovea), chargé en natif (Capacitor).

const API_URL = 'https://vfindez-api.vercel.app/api/validate-receipt'; // ton endpoint

// --- Plateforme ---
function getPlatformLower() {
  try {
    const cap = window.Capacitor;
    if (cap?.getPlatform) return cap.getPlatform().toLowerCase(); // 'ios' | 'android' | 'web'
  } catch (_) {}
  const p = (window.device?.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('android')) return 'android';
  if (p.includes('iphone') || p.includes('ipad') || p.includes('ios')) return 'ios';
  return 'web';
}
const IS_ANDROID = getPlatformLower() === 'android';
const IS_IOS     = getPlatformLower() === 'ios';

// --- Produits (mêmes IDs que App Store Connect / Play Console) ---
const PRODUCTS = [
  { id: 'points3000',  type: 'consumable'     },
  { id: 'points10000', type: 'consumable'     },
  { id: 'jetons12',    type: 'consumable'     },
  { id: 'jetons50',    type: 'consumable'     },
  { id: 'nopub',       type: 'non_consumable' },
];

// --- Helpers optionnels (crédit local si ton backend ne crédite pas lui-même)
async function creditLocal(productId) {
  // Adapte à ta logique Supabase si tu veux créditer côté client après succès serveur.
  try {
    if (productId === 'nopub') {
      if (window.sb) await window.sb.from('users').update({ nopub: true }).eq('id', window.getUserId?.());
      return;
    }
    // exemples: crédits en fonction du produit
    if (productId === 'jetons12')   await window.addJetonsSupabase?.(12);
    if (productId === 'jetons50')   await window.addJetonsSupabase?.(50);
    if (productId === 'points3000') await window.addVCoinsSupabase?.(3000);
    if (productId === 'points10000')await window.addVCoinsSupabase?.(10000);
  } catch (e) {
    console.warn('[IAP] Crédit local optionnel a échoué:', e);
  }
}

// --- Init IAP après deviceready (Cordova compat) ---
function initAchats() {
  const IAP = window.store;
  if (!IAP || typeof IAP.register !== 'function') {
    console.warn('[IAP] Plugin indisponible (web/localhost ?). On saute l’init IAP.');
    return;
  }

  // Verbose utile en dev
  IAP.verbosity = IAP.DEBUG;

  // Register
  PRODUCTS.forEach(p => {
    IAP.register({ id: p.id, alias: p.id, type: (p.type === 'consumable' ? IAP.CONSUMABLE : IAP.NON_CONSUMABLE) });
  });

  // Approved handler
  PRODUCTS.forEach(p => {
    IAP.when(p.id).approved(async (order) => {
      try {
        await window.loadUserData?.();
        const userId = window.getUserId?.();

        // Reçu selon la plateforme
        let receipt = '';
        if (IS_ANDROID) {
          receipt = order?.transaction?.id || ''; // purchase token
        } else if (IS_IOS) {
          receipt = order?.transaction?.appStoreReceipt || (window.store?.getReceipt?.() || '');
        }

        // Envoi au backend (qui doit valider Google/Apple et créditer)
        let result = { success: false, error: 'no-response' };
        try {
          const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId,
              achat: p.id,
              quantite: null, // laissé au backend; sinon tu peux fixer ici
              receipt,
              plateforme: IS_ANDROID ? 'android' : (IS_IOS ? 'ios' : 'web')
            })
          });
          result = await res.json();
        } catch (e) {
          alert('Erreur réseau validation: ' + (e?.message || e));
        }

        if (result?.success) {
          // Optionnel: si ton backend ne crédite pas, fais-le côté client :
          await creditLocal(p.id);
          alert(result.message || 'Achat validé !');
        } else {
          alert('Validation refusée : ' + (result?.error || 'inconnue'));
        }
      } catch (e) {
        alert('Erreur achat : ' + (e?.message || e));
      } finally {
        try { order.finish(); } catch (_) {}
      }
    });
  });

  IAP.error((err) => {
    alert('Erreur IAP : ' + err.message);
  });

  // Important
  IAP.refresh();

  // Expose un lanceur d’achat
  window.acheterProduit = function(id) {
    if (!PRODUCTS.find(p => p.id === id)) return alert('Produit inconnu: ' + id);
    try { IAP.order(id); } catch (e) { alert('Impossible de lancer l’achat: ' + (e?.message || e)); }
  };
}

// Lancement (Cordova compat) — garde ton code existant
document.addEventListener('deviceready', () => {
  try { initAchats(); } catch (e) { console.warn('initAchats error:', e); }
});

// NOTE: ton ancien fichier boutique appelait acheterProduitVercel(...).
// Désormais, déclenche l’IAP natif via window.acheterProduit('jetons12' | 'nopub' | ...).
