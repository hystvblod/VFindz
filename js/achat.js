import { getUserId, loadUserData } from './userData.js';
import { Purchases } from 'capacitor-plugin-purchases';

const API_URL = 'https://vfindez-api.vercel.app/api/validate-receipt';

export async function validerAchat(achat) {
  await loadUserData();
  const userId = getUserId();
  if (!userId) {
    alert("Utilisateur non connecté.");
    return;
  }

  let quantite = 0;
  if (achat.startsWith("pack_")) {
    const pack = PIECE_PACKS[achat];
    if (pack) quantite = pack.base + pack.bonus;
  }

  try {
    const { purchaseToken, receiptData, productIdentifier } = await Purchases.purchaseProduct({
      productIdentifier: achat === "premium" ? "premium" : achat
    });

    // ⬇️ Format du reçu + détection plateforme
    let receipt = "";
    let plateforme = "";

    if (purchaseToken) {
      receipt = `${purchaseToken}||${productIdentifier}`;
      plateforme = "android";
    } else if (receiptData) {
      receipt = receiptData;
      plateforme = "ios";
    } else {
      alert("Aucun reçu détecté.");
      return;
    }

    // ✅ Envoi à l'API
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, achat, quantite, receipt, plateforme })
    });

    const result = await res.json();
    if (result.success) {
      alert(result.message || "Achat validé !");
    } else {
      alert("Erreur : " + (result.error || "inconnue"));
    }

  } catch (err) {
    alert("Erreur pendant l'achat : " + (err.message || err));
  }
}
