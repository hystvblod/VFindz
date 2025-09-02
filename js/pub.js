// --- js/pub.js (AdMob / Capacitor) ---
// AUCUN await global ici. Charger APRES l'init Supabase/userData.js.

// Plateforme
function getPlatformLower() {
  try {
    const cap = window.Capacitor;
    if (cap?.getPlatform) return cap.getPlatform().toLowerCase();
  } catch (_) {}
  const ua = (navigator.userAgent || '').toLowerCase();
  if (ua.includes('android')) return 'android';
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
  return 'web';
}
const PLATFORM = getPlatformLower();
const IS_IOS = PLATFORM === 'ios';

// === CONFIG IDS ADMOB ===
// REMPLACE par tes vrais Ad Unit IDs (iOS ≠ Android).
// Rewarded
const AD_UNIT_ID_REWARDED = IS_IOS
  ? 'ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy'   // iOS rewarded
  : 'ca-app-pub-6837328794080297/2149453246';  // Android rewarded
// Interstitial
const AD_UNIT_ID_INTERSTIT = IS_IOS
  ? 'ca-app-pub-xxxxxxxxxxxxxxxx/aaaaaaaaaa'   // iOS interstitial
  : 'ca-app-pub-6837328794080297/3462534911';  // Android interstitial

// Récompenses
const REWARD_JETONS = 1;   // 1 pub = +1 jeton
const REWARD_VCOINS = 100; // 1 pub = +100 pièces
const REWARD_REVIVE = true;

// --- Helper: check premium / nopub (stocké en DB)
async function hasNoAds() {
  try {
    const uid = window.getUserId?.();
    if (!uid || !window.supabase) return false;
    const { data, error } = await window.supabase
      .from('users')
      .select('premium, user_metadata')
      .eq('id', uid)
      .single();
    if (error) return false;
    const nopub = !!(data?.user_metadata && (data.user_metadata.nopub === true));
    return !!(data?.premium || nopub);
  } catch (_) {
    return false;
  }
}
window.hasNoAds = hasNoAds;

// --- AdMob plugin (Capacitor Community)
function getAdMob() {
  const P = window.Capacitor?.Plugins;
  // @capacitor-community/admob expose AdMob, RewardAd, InterstitialAd
  return {
    AdMob: P?.AdMob || window.AdMob || null,
    RewardAd: P?.RewardAd || window.RewardAd || null,
    InterstitialAd: P?.InterstitialAd || window.InterstitialAd || null,
  };
}

// iOS ATT (suivi)
async function requestATTIfNeeded() {
  if (!IS_IOS) return;
  try {
    // Certains wrappers AdMob gèrent eux-mêmes l’ATT via initialize({ requestTrackingAuthorization:true })
    // Si tu utilises un plugin séparé :
    const att = window.Capacitor?.Plugins?.AppTrackingTransparency;
    if (att?.requestPermission) await att.requestPermission();
  } catch (e) {
    console.warn('[Ads] ATT error:', e);
  }
}

// Init + preload ads (idempotent)
let __ADS_INITTED__ = false;
async function _initAdsOnce() {
  if (__ADS_INITTED__) return;
  if (await hasNoAds()) {
    console.log('[Ads] Premium/Nopub → pas d’init pubs.');
    __ADS_INITTED__ = true;
    return;
  }

  const { AdMob, RewardAd, InterstitialAd } = getAdMob();
  if (!AdMob) {
    console.warn('[Ads] Capacitor AdMob plugin indisponible.');
    return;
  }

  await requestATTIfNeeded();

  try {
    // Initialisation AdMob
    // Beaucoup d’exemples: AdMob.initialize({ requestTrackingAuthorization: true });
    await AdMob.initialize({
      requestTrackingAuthorization: IS_IOS ? true : false,
      testingDevices: [], // optionnel
      initializeForTesting: false, // passe à true si besoin
    });
    console.log('[Ads] AdMob initialized');
  } catch (e) {
    console.warn('[Ads] initialize error:', e);
  }

  // Prépare Rewarded
  try {
    if (RewardAd?.prepare) {
      await RewardAd.prepare({
        adId: AD_UNIT_ID_REWARDED,
        // serverSideVerification: { userId: '...', customData: '...' }, // si tu fais du SSV AdMob
      });
    }
  } catch (e) {
    console.warn('[Ads] RewardAd.prepare error:', e);
  }

  // Prépare Interstitial
  try {
    if (InterstitialAd?.prepare) {
      await InterstitialAd.prepare({
        adId: AD_UNIT_ID_INTERSTIT,
      });
    }
  } catch (e) {
    console.warn('[Ads] InterstitialAd.prepare error:', e);
  }

  // Listeners (recharge auto après affichage)
  try {
    // Rewarded terminé/reçu
    AdMob.addListener?.('onRewardedAdReward', async () => {
      // rien ici: le flow showRewarded() résout sur cet event
    });
    // Rewarded fermé -> reload
    AdMob.addListener?.('onRewardedAdDismissed', async () => {
      try { await RewardAd?.prepare?.({ adId: AD_UNIT_ID_REWARDED }); } catch (_e) {}
    });
    // Interstitial fermé -> reload
    AdMob.addListener?.('onInterstitialAdDismissed', async () => {
      try { await InterstitialAd?.prepare?.({ adId: AD_UNIT_ID_INTERSTIT }); } catch (_e) {}
    });
  } catch (e) {
    console.warn('[Ads] addListener error:', e);
  }

  __ADS_INITTED__ = true;
  console.log('[Ads] AdMob init + preloads OK');
}

// Expose pour déclencher après consentement RGPD
window.initAds = function() { _initAdsOnce(); };

// Interstitial
async function showInterstitial() {
  if (await hasNoAds()) return;
  const { InterstitialAd } = getAdMob();
  if (!InterstitialAd?.show) {
    console.log('[Ads] Interstitiel simulé (dev).');
    return;
  }
  try {
    await InterstitialAd.show();
  } catch (e) {
    console.warn('[Ads] interstitial error:', e);
    // Essaye de recharger pour la prochaine fois
    try { await InterstitialAd.prepare({ adId: AD_UNIT_ID_INTERSTIT }); } catch (_) {}
  }
}

// Rewarded: promesse booléenne “a-t-on réellement été récompensé ?”
function showRewarded() {
  return new Promise(async (resolve) => {
    if (await hasNoAds()) return resolve(false);
    const { RewardAd, AdMob } = getAdMob();
    if (!RewardAd?.show) {
      console.log('[Ads] Rewarded simulée (dev)');
      return setTimeout(() => resolve(true), 1200);
    }

    let resolved = false;
    const onReward = () => {
      if (!resolved) { resolved = true; resolve(true); }
      AdMob.removeAllListeners?.('onRewardedAdReward');
      AdMob.removeAllListeners?.('onRewardedAdFailedToShow'); // selon plugin
    };
    const onFail = () => {
      if (!resolved) { resolved = true; resolve(false); }
      AdMob.removeAllListeners?.('onRewardedAdReward');
      AdMob.removeAllListeners?.('onRewardedAdFailedToShow');
    };

    try {
      AdMob.addListener?.('onRewardedAdReward', onReward);
      AdMob.addListener?.('onRewardedAdFailedToShow', onFail);

      // S’assure qu’il y a bien un ad chargé
      try { await RewardAd.prepare({ adId: AD_UNIT_ID_REWARDED }); } catch (_) {}
      await RewardAd.show();
      // NB: on ne resolve PAS ici. On attend réellement l’event “rewarded”.
    } catch (e) {
      console.warn('[Ads] showRewarded error:', e);
      onFail();
    }
  });
}

// Wrappers boutique (crédits via RPC sécurisées)
async function showRewardBoutique() {
  const ok = await showRewarded();
  if (!ok) return;
  try {
    await window.supabase?.rpc('secure_add_jetons', { nb: REWARD_JETONS });
    await window.updateJetonsDisplay?.();
    alert(`✅ +${REWARD_JETONS} jeton !`);
  } catch (e) {
    alert("Erreur lors de l'ajout du jeton: " + (e?.message || e));
  }
}

async function showRewardVcoins() {
  const ok = await showRewarded();
  if (!ok) return;
  try {
    await window.supabase?.rpc('secure_add_points', { nb: REWARD_VCOINS });
    await window.updatePointsDisplay?.();
    alert(`✅ +${REWARD_VCOINS} pièces !`);
  } catch (e) {
    alert("Erreur lors de l'ajout de pièces: " + (e?.message || e));
  }
}

function showRewardRevive(callback) {
  if (!REWARD_REVIVE) return;
  showRewarded().then(ok => { if (ok && typeof callback === 'function') callback(); });
}

// Compteur interstitiel toutes X parties (désactivé pour Premium)
let _games = parseInt(localStorage.getItem('compteurParties') || '0', 10);
async function partieTerminee() {
  if (await hasNoAds()) return;
  _games += 1;
  localStorage.setItem('compteurParties', String(_games));
  const INTERSTITIEL_APRES_X_PARTIES = 2;
  if (_games >= INTERSTITIEL_APRES_X_PARTIES) {
    _games = 0;
    localStorage.setItem('compteurParties', '0');
    showInterstitial();
  }
}

// Expose global
window.showInterstitial   = showInterstitial;
window.showRewarded       = showRewarded;
window.showRewardBoutique = showRewardBoutique;
window.showRewardVcoins   = showRewardVcoins;
window.showRewardRevive   = showRewardRevive;
window.partieTerminee     = partieTerminee;

// Optionnel: init auto après deviceready (si pas de popin RGPD)
document.addEventListener('deviceready', _initAdsOnce);
