// --- pub.js ---
// AUCUN await global ici !

// Détection plateforme
function getPlatformLower() {
  try {
    const cap = window.Capacitor;
    if (cap?.getPlatform) return cap.getPlatform().toLowerCase(); // 'ios' | 'android' | 'web'
  } catch (_) {}
  const p = (navigator.userAgent || "").toLowerCase();
  if (p.includes('android')) return 'android';
  if (p.includes('iphone') || p.includes('ipad') || p.includes('ios')) return 'ios';
  return 'web';
}
const PLATFORM = getPlatformLower();
const IS_IOS = PLATFORM === 'ios';
const IS_ANDROID = PLATFORM === 'android';

// ---- Clés/IDs séparés par plateforme (REMPLACE ICI) ----
const SDK_KEY = IS_IOS ? "TA_CLE_SDK_IOS" : "TA_CLE_SDK_ANDROID";
const AD_UNIT_REWARDED     = IS_IOS ? "IOS_REWARDED_ID"     : "ANDROID_REWARDED_ID";
const AD_UNIT_INTERSTITIAL = IS_IOS ? "IOS_INTERSTITIAL_ID" : "ANDROID_INTERSTITIAL_ID";

// Demander l’autorisation ATT sur iOS avant d’initialiser MAX (si plugin dispo)
async function requestATTIfNeeded() {
  if (!IS_IOS) return;
  try {
    const att = window.Capacitor?.Plugins?.AppTrackingTransparency;
    // Plusieurs plugins exposent .requestPermission()
    if (att?.requestPermission) {
      await att.requestPermission(); // on ignore le statut ici
    }
  } catch (e) {
    console.warn("ATT permission error:", e);
  }
}

async function initAds() {
  try {
    const MAX = window.Capacitor?.Plugins?.AppLovinPlugin;
    if (!MAX) return;

    // ATT AVANT l'init en iOS
    await requestATTIfNeeded();

    await MAX.initialize({ sdkKey: SDK_KEY });

    // Optionnel : RGPD si ton plugin expose un setter
    // if (typeof MAX.setHasUserConsent === 'function') {
    //   const consent = (window.userConsent || localStorage.getItem("rgpdConsent")) === "accept";
    //   await MAX.setHasUserConsent(consent);
    // }

    await MAX.loadRewardedAd(AD_UNIT_REWARDED);
    await MAX.loadInterstitialAd(AD_UNIT_INTERSTITIAL);
  } catch (error) {
    console.warn("Erreur initialisation AppLovin :", error);
  }
}

// Lance l'init quand le DOM est prêt (pas d'await global)
document.addEventListener("DOMContentLoaded", () => {
  // On laisse l'async interne vivre sa vie
  initAds();
});

// -------- Fonctions utilitaires pour l'app --------
// (userData.js doit être chargé avant ce fichier !)

window.showAd = async function(type = "rewarded") {
  // Premium : pas de pub (mais on crédite quand même si rewarded)
  try {
    const premium = await window.isPremium?.();
    if (premium) {
      if (type === "rewarded") await window.addPoints?.(10);
      await window.updatePointsDisplay?.();
      return;
    }
  } catch (_) {}

  // RGPD/Consentement (UE)
  const consent = window.userConsent || localStorage.getItem("rgpdConsent");
  if (consent !== "accept") return;

  try {
    const MAX = window.Capacitor?.Plugins?.AppLovinPlugin;
    if (MAX) {
      if (type === "rewarded") {
        await MAX.showRewardedAd(AD_UNIT_REWARDED);
      } else if (type === "interstitial") {
        await MAX.showInterstitialAd(AD_UNIT_INTERSTITIAL);
      }
    } else {
      // En mode navigateur : simule une pub pour dev/test
      alert("[SIMULATION PUB] Regarde une pub " + type);
      if (type === "rewarded") await window.addPoints?.(10);
    }
  } catch (e) {
    console.warn("Erreur pub :", e);
  }

  await window.updatePointsDisplay?.();
};

// -- MAJ points affichés
window.updatePointsDisplay = async function() {
  const pointsSpan = document.getElementById("points");
  if (pointsSpan && window.getPoints) {
    try { pointsSpan.textContent = await window.getPoints(); } catch (_) {}
  }
};

// ========== Fonction pour la popup BOUTIQUE : PUB → Jetons ==========
// (pense à protéger côté serveur si besoin)
window.acheterJetonsAvecPub = async function() {
  // Affiche une pub rewarded, attend la fin
  await window.showAd('rewarded');
  // Ajoute 3 jetons à l'utilisateur (RPC côté Supabase)
  try {
    await window.supabase.rpc('secure_add_jetons', { nb: 3 });
  } catch (e) {
    console.warn("secure_add_jetons error:", e);
  }
  // Mets à jour l'affichage
  try { if (window.afficherSolde) await window.afficherSolde(); } catch (_) {}
  // Ferme la popup si dispo
  if (window.fermerPopupJetonBoutique) window.fermerPopupJetonBoutique();
  alert("+3 jetons ajoutés !");
};
