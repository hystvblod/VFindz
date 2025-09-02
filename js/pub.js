// --- js/pub.js (AdMob / Capacitor) ---
// Charger APRÈS l'init Supabase/userData.js.

// =======================
// Config & Helpers
// =======================

// 🔗 Ton URL Supabase (utilisée pour appeler /functions/v1/reward-token)
const SUPABASE_URL =
  window.__SUPABASE_URL__ ||
  (window.supabase && window.supabase.supabaseUrl) ||
  "https://swmdepiukfginzhbeccz.supabase.co"; // ← remplace si besoin

function getPlatformLower() {
  try {
    const cap = window.Capacitor;
    if (cap?.getPlatform) return cap.getPlatform().toLowerCase();
  } catch (_) {}
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("android")) return "android";
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ios")) return "ios";
  return "web";
}
const PLATFORM = getPlatformLower();
const IS_IOS = PLATFORM === "ios";

// === CONFIG IDS ADMOB ===
// REMPLACE par tes vrais Ad Unit IDs (iOS ≠ Android).
// Rewarded
const AD_UNIT_ID_REWARDED = IS_IOS
  ? "ca-app-pub-xxxxxxxxxxxxxxxx/yyyyyyyyyy" // iOS rewarded
  : "ca-app-pub-6837328794080297/2149453246"; // Android rewarded
// Interstitial
const AD_UNIT_ID_INTERSTIT = IS_IOS
  ? "ca-app-pub-xxxxxxxxxxxxxxxx/aaaaaaaaaa" // iOS interstitial
  : "ca-app-pub-6837328794080297/3462534911"; // Android interstitial

// Barèmes serveur (informatifs côté client)
const REWARD_JETONS = 1;    // “jeton”: 1
const REWARD_VCOINS = 100;  // “vcoin”: 100
const REWARD_REVIVE = true; // “revive”: vrai/faux

// =======================
// Supabase helpers (auth + nonce)
// =======================
async function ensureSession() {
  const { data: s } = await window.supabase.auth.getSession();
  if (s?.session) return s.session;
  // Anonyme au besoin
  await window.supabase.auth.signInAnonymously?.();
  const { data: s2 } = await window.supabase.auth.getSession();
  return s2?.session || null;
}

async function getUid() {
  const { data, error } = await window.supabase.auth.getUser();
  if (error) return null;
  return data?.user?.id || null;
}

// Appelle l’Edge Function reward-token pour obtenir un nonce
async function getRewardToken(kind = "vcoin", amount = 10) {
  const session = await ensureSession();
  if (!session?.access_token) throw new Error("No session for reward-token");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/reward-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ kind, amount }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`reward-token failed: ${t}`);
  }
  return await res.json(); // { token, kind, amount, expires_at }
}

// =======================
// AdMob plugin
// =======================
function getAdMob() {
  const P = window.Capacitor?.Plugins;
  return {
    AdMob: P?.AdMob || window.AdMob || null,
    RewardAd: P?.RewardAd || window.RewardAd || null,
    InterstitialAd: P?.InterstitialAd || window.InterstitialAd || null,
  };
}

async function requestATTIfNeeded() {
  if (!IS_IOS) return;
  try {
    const att = window.Capacitor?.Plugins?.AppTrackingTransparency;
    if (att?.requestPermission) await att.requestPermission();
  } catch (e) {
    console.warn("[Ads] ATT error:", e);
  }
}

// =======================
// No-ads (premium / nopub)
// =======================
async function hasNoAds() {
  try {
    const uid = window.getUserId?.();
    if (!uid || !window.supabase) return false;
    const { data, error } = await window.supabase
      .from("users")
      .select("premium, user_metadata")
      .eq("id", uid)
      .single();
    if (error) return false;
    const nopub = !!(data?.user_metadata && data.user_metadata.nopub === true);
    return !!(data?.premium || nopub);
  } catch (_) {
    return false;
  }
}
window.hasNoAds = hasNoAds;

// =======================
// Init (idempotent) + preload
// =======================
let __ADS_INITTED__ = false;

async function _initAdsOnce() {
  if (__ADS_INITTED__) return;
  if (await hasNoAds()) {
    console.log("[Ads] Premium/Nopub → pas d’init pubs.");
    __ADS_INITTED__ = true;
    return;
  }
  const { AdMob, RewardAd, InterstitialAd } = getAdMob();
  if (!AdMob) {
    console.warn("[Ads] Capacitor AdMob plugin indisponible.");
    return;
  }

  await requestATTIfNeeded();

  try {
    await AdMob.initialize({
      requestTrackingAuthorization: IS_IOS ? true : false,
      testingDevices: [],
      initializeForTesting: false,
    });
    console.log("[Ads] AdMob initialized");
  } catch (e) {
    console.warn("[Ads] initialize error:", e);
  }

  // Prépare un cache initial (sans SSV). Avant l’affichage réel,
  // on re-préparera la Rewarded avec SSV + nonce.
  try {
    if (RewardAd?.prepare) {
      await RewardAd.prepare({ adId: AD_UNIT_ID_REWARDED });
    }
  } catch (e) {
    console.warn("[Ads] RewardAd.prepare (preload) error:", e);
  }

  try {
    if (InterstitialAd?.prepare) {
      await InterstitialAd.prepare({ adId: AD_UNIT_ID_INTERSTIT });
    }
  } catch (e) {
    console.warn("[Ads] InterstitialAd.prepare error:", e);
  }

  try {
    // auto-reload à la fermeture
    AdMob.addListener?.("onRewardedAdDismissed", async () => {
      try {
        await RewardAd?.prepare?.({ adId: AD_UNIT_ID_REWARDED });
      } catch (_e) {}
    });
    AdMob.addListener?.("onInterstitialAdDismissed", async () => {
      try {
        await InterstitialAd?.prepare?.({ adId: AD_UNIT_ID_INTERSTIT });
      } catch (_e) {}
    });
  } catch (e) {
    console.warn("[Ads] listeners error:", e);
  }

  __ADS_INITTED__ = true;
  console.log("[Ads] AdMob init + preloads OK");
}
window.initAds = function () {
  _initAdsOnce();
};

// =======================
// Show Interstitial
// =======================
async function showInterstitial() {
  if (await hasNoAds()) return;
  const { InterstitialAd } = getAdMob();
  if (!InterstitialAd?.show) {
    console.log("[Ads] Interstitiel simulé (dev).");
    return;
  }
  try {
    await InterstitialAd.show();
  } catch (e) {
    console.warn("[Ads] interstitial error:", e);
    try {
      await InterstitialAd.prepare({ adId: AD_UNIT_ID_INTERSTIT });
    } catch (_) {}
  }
}

// =======================
// Show Rewarded (avec SSV)
// =======================
// kind: 'vcoin' | 'jeton' | 'revive'
// amount: nombre de points/pièces/jetons côté serveur
async function showRewarded(kind = "vcoin", amount = 10) {
  if (await hasNoAds()) return false;

  const { RewardAd, AdMob } = getAdMob();
  if (!RewardAd?.show) {
    console.log("[Ads] Rewarded simulée (dev)");
    // Simule l'obtention d'une récompense en dev
    return new Promise((r) => setTimeout(() => r(true), 1200));
  }

  try {
    // 1) S'assure d'avoir un uid
    const uid = (await getUid()) || "";

    // 2) Demande un nonce au serveur (reward-token)
    const { token } = await getRewardToken(kind, amount);

    // 3) Re-prepare la Rewarded avec SSV
    await RewardAd.prepare({
      adId: AD_UNIT_ID_REWARDED,
      serverSideVerification: {
        userId: uid,
        customData: token, // IMPORTANT: le nonce
      },
    });

    // 4) Attendre l'event "rewarded" (selon plugin, on peut écouter l'event)
    let resolved = false;
    const onReward = () => {
      if (!resolved) {
        resolved = true;
        AdMob.removeAllListeners?.("onRewardedAdReward");
        AdMob.removeAllListeners?.("onRewardedAdFailedToShow");
        // ⚠️ NE PAS créditer côté client : le SSV va le faire côté serveur
        // On retourne true pour que l'app sache rafraîchir l'UI
        // (ex: recharger le solde depuis la DB après un petit délai)
        resolve(true);
      }
    };
    const onFail = () => {
      if (!resolved) {
        resolved = true;
        AdMob.removeAllListeners?.("onRewardedAdReward");
        AdMob.removeAllListeners?.("onRewardedAdFailedToShow");
        resolve(false);
      }
    };

    // 5) Écouteurs
    return await new Promise(async (resolve) => {
      try {
        AdMob.addListener?.("onRewardedAdReward", onReward);
        AdMob.addListener?.("onRewardedAdFailedToShow", onFail);

        // S'assure qu'il y a bien un ad chargé
        try {
          await RewardAd.prepare({ adId: AD_UNIT_ID_REWARDED });
        } catch (_) {}
        await RewardAd.show();
        // On laisse les listeners décider du resolve
      } catch (e) {
        console.warn("[Ads] showRewarded error:", e);
        onFail();
      }
    });
  } catch (e) {
    console.warn("[Ads] showRewarded flow error:", e);
    return false;
  }
}

// =======================
// Wrappers “fonctionnels” app
// =======================
async function showRewardBoutique() {
  // 1 pub = +1 jeton (SSV côté serveur)
  const ok = await showRewarded("jeton", REWARD_JETONS);
  if (!ok) return;
  // ⏳ laisse le SSV créditer, puis rafraîchis l’UI
  setTimeout(() => {
    window.updateJetonsDisplay?.();
    alert(`✅ Jeton en cours d'ajout (SSV)…`);
  }, 1200);
}

async function showRewardVcoins() {
  // 1 pub = +100 pièces (SSV côté serveur)
  const ok = await showRewarded("vcoin", REWARD_VCOINS);
  if (!ok) return;
  setTimeout(() => {
    window.updatePointsDisplay?.();
    alert(`✅ Pièces en cours d'ajout (SSV)…`);
  }, 1200);
}

function showRewardRevive(callback) {
  if (!REWARD_REVIVE) return;
  showRewarded("revive", 1).then((ok) => {
    if (ok && typeof callback === "function") callback();
  });
}

// =======================
// Compteur interstitiel toutes X parties
// =======================
let _games = parseInt(localStorage.getItem("compteurParties") || "0", 10);
async function partieTerminee() {
  if (await hasNoAds()) return;
  _games += 1;
  localStorage.setItem("compteurParties", String(_games));
  const INTERSTITIEL_APRES_X_PARTIES = 2;
  if (_games >= INTERSTITIEL_APRES_X_PARTIES) {
    _games = 0;
    localStorage.setItem("compteurParties", "0");
    showInterstitial();
  }
}

// =======================
// Expose global
// =======================
window.showInterstitial = showInterstitial;
window.showRewarded = showRewarded; // showRewarded(kind, amount)
window.showRewardBoutique = showRewardBoutique;
window.showRewardVcoins = showRewardVcoins;
window.showRewardRevive = showRewardRevive;
window.partieTerminee = partieTerminee;

// Init auto si pas de popin RGPD
document.addEventListener("deviceready", _initAdsOnce);
