import { isPremium, addPoints, getPoints } from './userData.js';

const SDK_KEY = "TA_CLÉ_APPLOVIN_SDK_ICI"; // 👉 à remplacer par ta vraie clé dans le dashboard AppLovin
const AD_UNIT_REWARDED = "ID_REWARDED_ICI"; // 👉 à remplacer par ton ad unit rewarded
const AD_UNIT_INTERSTITIAL = "ID_INTERSTITIAL_ICI"; // 👉 à remplacer par ton ad unit interstitielle

// Initialisation AppLovin au lancement de l'app
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await Capacitor.Plugins.AppLovinPlugin.initialize({ sdkKey: SDK_KEY });
    await Capacitor.Plugins.AppLovinPlugin.loadRewardedAd(AD_UNIT_REWARDED);
    await Capacitor.Plugins.AppLovinPlugin.loadInterstitialAd(AD_UNIT_INTERSTITIAL);
  } catch (error) {
    console.warn("Erreur initialisation AppLovin :", error);
  }
});

// Fonction principale pour afficher une pub selon le type demandé
export async function showAd(type = "rewarded") {
  const premium = await isPremium();
  if (premium) {
    if (type === "rewarded") await addPoints(10);
    await updatePointsDisplay();
    return;
  }

  // RGPD : on vérifie si l'utilisateur a accepté les pubs
  const consent = window.userConsent || localStorage.getItem("rgpdConsent");
  if (consent !== "accept") return;

  try {
    if (type === "rewarded") {
      await Capacitor.Plugins.AppLovinPlugin.showRewardedAd(AD_UNIT_REWARDED);
    } else if (type === "interstitial") {
      await Capacitor.Plugins.AppLovinPlugin.showInterstitialAd(AD_UNIT_INTERSTITIAL);
    }
  } catch (e) {
    console.warn("Erreur pub :", e);
  }

  await updatePointsDisplay();
}

// Met à jour l'affichage du score (optionnel)
export async function updatePointsDisplay() {
  const pointsSpan = document.getElementById("points");
  if (pointsSpan) pointsSpan.textContent = await getPoints();
}
