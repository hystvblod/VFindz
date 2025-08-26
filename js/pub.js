// --- js/pub.js ---
// AUCUN await global ici.

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

// IDs AppLovin MAX — REMPLACE ICI par tes vraies clés (iOS ≠ Android)
const SDK_KEY               = IS_IOS ? 'TA_CLE_SDK_IOS'          : 'TA_CLE_SDK_ANDROID';
const AD_UNIT_ID_REWARDED   = IS_IOS ? 'IOS_REWARDED_ADUNIT'     : 'ANDROID_REWARDED_ADUNIT';
const AD_UNIT_ID_INTERSTIT  = IS_IOS ? 'IOS_INTERSTITIAL_ADUNIT' : 'ANDROID_INTERSTITIAL_ADUNIT';

// Récompenses
const REWARD_JETONS = 1;     // 1 pub = +1 jeton
const REWARD_VCOINS = 100;   // 1 pub = +100 pièces
const REWARD_REVIVE = true;

// Helper: check premium / nopub
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

// ATT (iOS) avant init MAX
async function requestATTIfNeeded() {
  if (!IS_IOS) return;
  try {
    const att = window.Capacitor?.Plugins?.AppTrackingTransparency;
    if (att?.requestPermission) await att.requestPermission();
  } catch (e) {
    console.warn('ATT error:', e);
  }
}

// Récup plugin MAX (Capacitor)
function getMAX() {
  return window.AppLovinMAX || window.Capacitor?.Plugins?.AppLovinPlugin || null;
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

  const MAX = getMAX();
  if (!MAX) {
    console.warn('[Ads] AppLovin MAX plugin indisponible.');
    return;
  }

  await requestATTIfNeeded();

  try {
    await MAX.initialize({ sdkKey: SDK_KEY });
  } catch (e) {
    console.warn('[Ads] initialize error:', e);
  }

  // Écouteurs de lifecycle pour recharger après affichage
  try {
    MAX.addListener?.('OnRewardedAdHiddenEvent', () => {
      // Recharge le rewarded
      MAX.loadRewardedAd?.(AD_UNIT_ID_REWARDED);
    });
    MAX.addListener?.('OnInterstitialHiddenEvent', () => {
      MAX.loadInterstitialAd?.(AD_UNIT_ID_INTERSTIT);
    });
  } catch (e) {
    console.warn('[Ads] addListener error:', e);
  }

  try {
    await MAX.loadRewardedAd?.(AD_UNIT_ID_REWARDED);
    await MAX.loadInterstitialAd?.(AD_UNIT_ID_INTERSTIT);
    console.log('[Ads] MAX init + preloads OK');
    __ADS_INITTED__ = true;
  } catch (e) {
    console.warn('[Ads] preload error:', e);
  }
}

// Expose pour déclencher après consentement RGPD
window.initAds = function() { _initAdsOnce(); };

// Interstitial
async function showInterstitial() {
  if (await hasNoAds()) return;
  const MAX = getMAX();
  if (!MAX?.showInterstitialAd) {
    console.log('[Ads] Interstitiel simulé (dev).');
    return;
  }
  try {
    await MAX.showInterstitialAd(AD_UNIT_ID_INTERSTIT);
  } catch (e) {
    console.warn('[Ads] interstitial error:', e);
  }
}

// Rewarded: renvoie une promesse booléenne “a-t-on réellement été récompensé ?”
function showRewarded() {
  return new Promise(async (resolve) => {
    if (await hasNoAds()) return resolve(false);
    const MAX = getMAX();
    if (!MAX?.showRewardedAd) {
      console.log('[Ads] Rewarded simulée (dev)');
      return setTimeout(() => resolve(true), 1200);
    }

    let resolved = false;

    // One-shot listeners
    const onReward = () => {
      if (!resolved) { resolved = true; resolve(true); }
      MAX.removeAllListeners?.('OnRewardedAdReceivedRewardEvent');
      MAX.removeAllListeners?.('OnRewardedAdDisplayFailedEvent');
    };
    const onFail = () => {
      if (!resolved) { resolved = true; resolve(false); }
      MAX.removeAllListeners?.('OnRewardedAdReceivedRewardEvent');
      MAX.removeAllListeners?.('OnRewardedAdDisplayFailedEvent');
    };

    try {
      MAX.addListener?.('OnRewardedAdReceivedRewardEvent', onReward);
      MAX.addListener?.('OnRewardedAdDisplayFailedEvent', onFail);

      // S’assure qu’il y a bien un ad chargé
      try { await MAX.loadRewardedAd?.(AD_UNIT_ID_REWARDED); } catch (_) {}

      await MAX.showRewardedAd(AD_UNIT_ID_REWARDED);
      // NB: on ne resolve PAS ici. On attend réellement l’event “rewarded”.
    } catch (e) {
      console.warn('[Ads] showRewarded error:', e);
      onFail();
    }
  });
}

// Wrappers boutique

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
