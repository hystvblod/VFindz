// --- AUCUN await global ici ! ---
// getUserId() et loadUserData() sont déjà sur window via userData.js

const API_URL = 'https://vfindez-api.vercel.app/api/validate-receipt';

// ===== Plateforme =====
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
const PLATFORM   = getPlatformLower();
const IS_ANDROID = PLATFORM === 'android';
const IS_IOS     = PLATFORM === 'ios';

// ===== Produits EXACTS (aligne avec Play Console / App Store) =====
// NOTE: Ce sont les IDs *réels* déclarés côté store.
const PRODUCTS = [
  { id: "vcoins1500",   type: "consumable"     }, // 1 500 pièces
  { id: "vcoins4500",   type: "consumable"     }, // 4 500 pièces
  { id: "vcoins12000",  type: "consumable"     }, // 12 000 pièces
  { id: "vcoins30000",  type: "consumable"     }, // 30 000 pièces
  { id: "jetons12",     type: "consumable"     }, // 12 jetons
  { id: "jetons50",     type: "consumable"     }, // 50 jetons
  { id: "premium",      type: "non_consumable" }  // premium (ou abonnement si défini ainsi)
];

// ===== Alias pour compat HTML existant =====
// UI utilise coins_099 / tokens_12 etc. On mappe → IDs réels store.
const ALIASES = {
  // Pièces
  "coins_099": "vcoins1500",
  "coins_199": "vcoins4500",
  "coins_399": "vcoins12000",
  "coins_999": "vcoins30000",
  // Jetons
  "tokens_12": "jetons12",
  "tokens_50": "jetons50",
  // Premium (identique)
  "premium":   "premium"
};

// Expose si besoin
window.IAP_PRODUCTS = PRODUCTS.slice();

// ===== Cache prix/état renvoyés par le store =====
/** STORE_PRODUCTS indexe par id réel ET par alias pour simplifier l'UI. */
let STORE_PRODUCTS = {}; // { [idOrAlias]: { id, price, currency, canPurchase, raw } }

/** Hydrate STORE_PRODUCTS depuis window.store.products */
function _updateStoreProductsFromPlugin() {
  const IAP = window.store;
  if (!IAP) return;

  const list = IAP.products || [];
  list.forEach(p => {
    // p.id = id réel tel que déclaré au store (ex: "vcoins1500")
    const entry = {
      id: p.id,
      price: p.price || '',       // ex: "€4,99" (localisé)
      currency: p.currency || '', // ex: "EUR"
      canPurchase: !!p.canPurchase,
      raw: p
    };
    // Stocke sous l'id réel...
    STORE_PRODUCTS[p.id] = entry;

    // ...et sous les alias qui pointent dessus (si existants)
    Object.entries(ALIASES).forEach(([alias, real]) => {
      if (real === p.id) STORE_PRODUCTS[alias] = entry;
    });
  });
}

// --- Helpers pour l’UI (boutons/labels) ---
function _realId(productId) { return ALIASES[productId] || productId; }

window.getStorePrice = function(productId) {
  const key = _realId(productId);
  return STORE_PRODUCTS[key]?.price || '—';
};

window.canBuyProduct = function(productId) {
  const key = _realId(productId);
  const p = STORE_PRODUCTS[key];
  return p ? !!p.canPurchase : false;
};

window.refreshStoreProducts = function() {
  try {
    const IAP = window.store;
    if (!IAP) return;
    IAP.refresh(); // recharge infos prix/état
    setTimeout(_updateStoreProductsFromPlugin, 1200);
  } catch (_) {}
};

// ===== Crédit (coté client) — à garder si ton backend ne crédite pas déjà =====
async function creditLocal(productIdOrAlias) {
  try {
    const id = _realId(productIdOrAlias);

    if (id === 'premium') {
      await window.updateUserData?.({ premium: true });
      return;
    }
    if (id === 'jetons12')      { await window.supabase?.rpc('secure_add_jetons',  { nb: 12 }); return; }
    if (id === 'jetons50')      { await window.supabase?.rpc('secure_add_jetons',  { nb: 50 }); return; }
    if (id === 'vcoins1500')    { await window.supabase?.rpc('secure_add_points',  { nb: 1500 }); return; }
    if (id === 'vcoins4500')    { await window.supabase?.rpc('secure_add_points',  { nb: 4500 }); return; }
    if (id === 'vcoins12000')   { await window.supabase?.rpc('secure_add_points',  { nb: 12000 }); return; }
    if (id === 'vcoins30000')   { await window.supabase?.rpc('secure_add_points',  { nb: 30000 }); return; }
  } catch (e) {
    console.warn('[IAP] Crédit local optionnel KO:', e);
  }
}

// ===== Init IAP =====
function initAchats() {
  const IAP = window.store;
  if (!IAP || typeof IAP.register !== 'function') {
    alert("Le plugin achat n'est pas chargé !");
    return;
  }

  // Verbosité utile en dev
  try { IAP.verbosity = IAP.DEBUG; } catch(_) {}

  // 1) Enregistrer tous les produits (IDs RÉELS store)
  PRODUCTS.forEach(prod => {
    IAP.register({
      id: prod.id,
      alias: prod.id, // alias interne du plugin (pas nos ALIASES ci-dessus)
      type: (prod.type === 'consumable' ? IAP.CONSUMABLE : IAP.NON_CONSUMABLE)
    });
  });

  // 2) Boutique prête → peupler cache prix
  IAP.ready(() => { _updateStoreProductsFromPlugin(); });

  // 3) À chaque update produit → MAJ cache
  IAP.when('product').updated(() => { _updateStoreProductsFromPlugin(); });

  // 4) Validation (approved) par produit réel
  PRODUCTS.forEach(prod => {
    IAP.when(prod.id).approved(async function(order) {
      await window.loadUserData?.();
      const userId = window.getUserId?.();

      // Récup justificatif selon plateforme
      let receipt = '';
      try {
        if (IS_ANDROID) {
          // Sur Android (Billing), l’ID transaction est souvent suffisant côté backend
          receipt = order?.transaction?.id || order?.transaction?.purchaseToken || '';
        } else if (IS_IOS) {
          // Sur iOS, on peut utiliser l’appStoreReceipt global
          receipt = order?.transaction?.appStoreReceipt || (window.store?.getReceipt?.() || '');
        }
      } catch (_) {}

      // Appel backend de validation
      let result;
      try {
        const res = await fetch(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            achat: prod.id,          // id RÉEL validé côté store
            quantite: null,
            receipt,
            plateforme: IS_ANDROID ? 'android' : (IS_IOS ? 'ios' : 'web')
          })
        });
        result = await res.json();
      } catch (err) {
        alert("Erreur lors de la validation serveur : " + (err?.message || err));
      }

      if (result?.success) {
        // === PREMIUM : no-ads + bonus mensuel + 500 pièces immédiates ===
        if (prod.id === 'premium') {
          try {
            const meta = (typeof window.getUserMeta === 'function' ? (window.getUserMeta() || {}) : {});
            meta.nopub = true; // coupe la pub partout

            const now = Date.now();
            await window.updateUserData?.({
              premium: true,
              user_metadata: meta,
              premium_bonus_next: now + 30*24*3600*1000 // prochain bonus dans 30 jours
            });

            // crédit immédiat des 500 pièces à l'achat
            await window.supabase?.rpc('secure_add_points', { nb: 500 });
            await window.updatePointsDisplay?.();
          } catch (e) {
            console.warn('[IAP premium post-actions]', e);
          }
        }

        // Crédit local si le backend ne l’a pas déjà fait
        await creditLocal(prod.id);

        alert(result.message || "Achat validé !");
        try { await window.updatePointsDisplay?.(); } catch(_) {}
        try { await window.updateJetonsDisplay?.(); } catch(_) {}
      } else {
        alert("Erreur : " + (result?.error || "inconnue"));
      }

      try { order.finish(); } catch (_) {}
    });
  });

  // 5) Gestion d’erreurs globales IAP
  IAP.error(function(err) {
    alert("Erreur achat : " + err.message);
  });

  // 6) Récup du catalogue (prix, canPurchase, etc.)
  IAP.refresh();
  setTimeout(_updateStoreProductsFromPlugin, 1200);

  // 7) Lanceur d’achat global accepté par l’UI (alias OK)
  window.validerAchat = function(achatIdFromUI) {
    const realId = _realId(achatIdFromUI);
    const prod = PRODUCTS.find(p => p.id === realId);
    if (!prod) return alert("Produit inconnu : " + achatIdFromUI + " (→ " + realId + ")");

    try {
      window.store.order(realId);
    } catch (e) {
      alert('Impossible de lancer l’achat: ' + (e?.message || e));
    }
  };
}

// Démarre le setup achats APRES deviceready (cordova)
document.addEventListener('deviceready', function() {
  initAchats();
});
