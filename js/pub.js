// pub.js

const SDK_KEY = "TA_CLÉ_APPLOVIN_SDK_ICI"; // 👉 à remplacer par ta vraie clé dans le dashboard AppLovin
const AD_UNIT_REWARDED = "ID_REWARDED_ICI"; // 👉 à remplacer par ton ad unit rewarded
const AD_UNIT_INTERSTITIAL = "ID_INTERSTITIAL_ICI"; // 👉 à remplacer par ton ad unit interstitielle

document.addEventListener("DOMContentLoaded", async () => {
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLovinPlugin) {
      await window.Capacitor.Plugins.AppLovinPlugin.initialize({ sdkKey: SDK_KEY });
      await window.Capacitor.Plugins.AppLovinPlugin.loadRewardedAd(AD_UNIT_REWARDED);
      await window.Capacitor.Plugins.AppLovinPlugin.loadInterstitialAd(AD_UNIT_INTERSTITIAL);
    }
  } catch (error) {
    console.warn("Erreur initialisation AppLovin :", error);
  }
});

// -------- Fonctions utilitaires pour l'app --------
// (userData.js doit être chargé avant ce fichier !)

window.showAd = async function(type = "rewarded") {
  // On récupère la fonction premium/points globales
  const premium = await window.isPremium();
  if (premium) {
    if (type === "rewarded") await window.addPoints(10);
    await window.updatePointsDisplay?.();
    return;
  }

  // RGPD/Consentement
  const consent = window.userConsent || localStorage.getItem("rgpdConsent");
  if (consent !== "accept") return;

  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AppLovinPlugin) {
      if (type === "rewarded") {
        await window.Capacitor.Plugins.AppLovinPlugin.showRewardedAd(AD_UNIT_REWARDED);
      } else if (type === "interstitial") {
        await window.Capacitor.Plugins.AppLovinPlugin.showInterstitialAd(AD_UNIT_INTERSTITIAL);
      }
    } else {
      // En mode navigateur : simule une pub pour dev/test
      alert("[SIMULATION PUB] Regarde une pub " + type);
      if (type === "rewarded") await window.addPoints(10);
    }
  } catch (e) {
    console.warn("Erreur pub :", e);
  }

  await window.updatePointsDisplay?.();
};

window.updatePointsDisplay = async function() {
  const pointsSpan = document.getElementById("points");
  if (pointsSpan && window.getPoints) pointsSpan.textContent = await window.getPoints();
};
