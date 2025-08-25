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
const SDK_KEY               = IS_IOS ? 'TA_CLE_SDK_IOS'         : 'TA_CLE_SDK_ANDROID';
const AD_UNIT_ID_REWARDED   = IS_IOS ? 'IOS_REWARDED_ADUNIT'    : 'ANDROID_REWARDED_ADUNIT';
const AD_UNIT_ID_INTERSTIT  = IS_IOS ? 'IOS_INTERSTITIAL_ADUNIT': 'ANDROID_INTERSTITIAL_ADUNIT';

// Récompenses
const REWARD_JETONS = 1;
const REWARD_VCOINS = 300;
const REWARD_REVIVE = true;

// Garde ta fonction NoAds côté Supabase si elle existe déjà
async function hasNoAds() {
  try {
    if (!window.sb || !window.getUserId) return false;
    const { data, error } = await window.sb
      .from('users')
      .select('nopub')
      .eq('id', window.getUserId())
      .single();
    if (error) return false;
    return !!data?.nopub;
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
    if (att?.requestPermission) {
      await att.requestPermission();
    }
  } catch (e) {
    console.warn('ATT error:', e);
  }
}

// Init + preload ads
async function _initAdsOnce() {
  const MAX = window.Capacitor?.Plugins?.AppLovinPlugin;
  if (!MAX) { console.warn('[Ads] AppLovinPlugin indisponible.'); return; }

  await requestATTIfNeeded();

  try {
    await MAX.initialize({ sdkKey: SDK_KEY });

    // (optionnel) Consentement si exposé par le plugin
    // const consent = (localStorage.getItem('rgpdConsent') === 'accept') && (localStorage.getItem('adsConsent') === 'yes');
    // if (typeof MAX.setHasUserConsent === 'function') await MAX.setHasUserConsent(!!consent);

    await MAX.loadRewardedAd(AD_UNIT_ID_REWARDED);
    await MAX.loadInterstitialAd(AD_UNIT_ID_INTERSTIT);
    console.log('[Ads] MAX init + preloads OK');
  } catch (e) {
    console.warn('[Ads] Init error:', e);
  }
}

// Expose pour ta pop-up RGPD (index.html appelle window.initAds() après consentement)
window.initAds = function() {
  _initAdsOnce();
};

// Show interstitial
async function showInterstitial() {
  if (await hasNoAds()) {
    console.log('[Ads] Interstitiel bloqué (NoPub)');
    return;
  }
  const MAX = window.Capacitor?.Plugins?.AppLovinPlugin;
  if (!MAX) {
    console.log('[Ads] Interstitiel simulée (dev)');
    return;
  }
  try {
    await MAX.showInterstitialAd(AD_UNIT_ID_INTERSTIT);
  } catch (e) {
    console.warn('[Ads] Interstitial error:', e);
  }
}

// Show rewarded (+ callback success)
function showRewarded(callback) {
  const MAX = window.Capacitor?.Plugins?.AppLovinPlugin;
  if (!MAX) {
    console.log('[Ads] Rewarded simulée (dev)');
    setTimeout(() => typeof callback === 'function' && callback(true), 2000);
    return;
  }
  MAX.showRewardedAd(AD_UNIT_ID_REWARDED)
    .then((res) => {
      const ok = !!res?.rewarded;
      if (typeof callback === 'function') callback(ok);
    })
    .catch((e) => {
      console.warn('[Ads] Rewarded error:', e);
      if (typeof callback === 'function') callback(false);
    });
}

// Helpers boutique (récompenses locales)
function showRewardBoutique() {
  showRewarded(async (ok) => {
    if (!ok) return;
    try {
      await window.addJetonsSupabase?.(REWARD_JETONS);
      alert(`+${REWARD_JETONS} jeton ajouté !`);
      if (window.renderThemes) window.renderThemes();
    } catch (e) {
      alert("Erreur lors de l'ajout de jeton: " + (e?.message || e));
    }
  });
}

function showRewardVcoins() {
  showRewarded(async (ok) => {
    if (!ok) return;
    try {
      await window.addVCoinsSupabase?.(REWARD_VCOINS);
      alert(`+${REWARD_VCOINS} VCoins ajoutés !`);
      if (window.renderThemes) window.renderThemes();
    } catch (e) {
      alert("Erreur lors de l'ajout de VCoins: " + (e?.message || e));
    }
  });
}

function showRewardRevive(callback) {
  if (!REWARD_REVIVE) return;
  showRewarded((ok) => { if (ok && typeof callback === 'function') callback(); });
}

// Compteur interstitiel toutes X parties
let _games = parseInt(localStorage.getItem('compteurParties') || '0', 10);
function partieTerminee() {
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
window.showInterstitial = showInterstitial;
window.showRewarded = showRewarded;
window.showRewardBoutique = showRewardBoutique;
window.showRewardVcoins = showRewardVcoins;
window.showRewardRevive = showRewardRevive;
window.partieTerminee = partieTerminee;
