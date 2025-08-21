// amis.js — RPC + i18n SAFE + ID-only + JSONB

let userPseudo = null;
let userProfile = null;
let lastAmiRequest = 0;
let amiASupprimer = null;

// --- i18n helper SAFE ---
function T(key, fallback = key, params = {}) {
  try {
    if (window.i18n && typeof window.i18n.t === "function") {
      return window.i18n.t(key, params);
    }
  } catch {}
  let txt = fallback;
  for (const k in (params || {})) {
    txt = txt.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), String(params[k]));
  }
  return txt;
}

function toast(msgKey, color = "#222", fallback = msgKey, params = {}) {
  const msg = T(msgKey, fallback, params);
  const t = document.createElement("div");
  t.className = "toast-msg";
  t.textContent = msg;
  t.style.background = color;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 500); }, 2300);
}

document.addEventListener("DOMContentLoaded", async () => {
  userPseudo = await window.getPseudo();
  await window.loadUserData();
  await rechargerAffichage();

  const btnAjouter = document.getElementById("btn-ajouter-ami");
  btnAjouter?.addEventListener("click", async () => {
    const pseudoAmi = document.getElementById("pseudo-ami").value.trim();
    if (!pseudoAmi) return;
    const now = Date.now();
    if (now - lastAmiRequest < 3000)
      return toast("amis.waitRequest", "#b93f3f", "Patiente un peu avant de refaire une demande.");
    lastAmiRequest = now;
    btnAjouter.disabled = true;
    btnAjouter.textContent = T("amis.adding", "Ajout en cours...");
    try {
      await envoyerDemandeAmi(pseudoAmi);
    } finally {
      btnAjouter.disabled = false;
      btnAjouter.textContent = T("button.add", "Ajouter un ami");
    }
  });

  document.getElementById("btn-lien-invit")?.addEventListener("click", () => {
    const base = window.location.origin + window.location.pathname;
    document.getElementById("lien-invit-output").value = `${base}?add=${userPseudo}`;
    toast("amis.linkCopied", "#222", "Lien copié, partage à tes amis !");
    document.getElementById("lien-invit-output").select();
    document.execCommand('copy');
  });

  detecterInvitationParLien();
});

async function rechargerAffichage() {
  userProfile = await window.getUserDataCloud();
  await afficherListesAmis(userProfile);
}

async function afficherListesAmis(data) {
  const ulAmis = document.getElementById("liste-amis");
  ulAmis.innerHTML = data.amis?.length
    ? data.amis.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
        <button class="btn-small btn-defi" onclick="window.defierAmi('${pseudo}')">${T("button.challenge", "Défier")}</button>
        <button class="btn-small btn-suppr" onclick="window.demanderSuppressionAmi('${pseudo}')">❌</button>
      </li>`).join("")
    : `<li class='txt-empty'>${T("amis.none", "Tu n'as pas encore d'amis.")}</li>`;

  const ulRecues = document.getElementById("demandes-recue");
  ulRecues.innerHTML = data.demandesRecues?.length
    ? data.demandesRecues.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
        <button class="btn-small btn-accept" onclick="window.accepterDemande('${pseudo}')">${T("button.accept", "Accepter")}</button>
        <button class="btn-small btn-refuse" onclick="window.refuserDemande('${pseudo}')">${T("button.refuse", "Refuser")}</button>
      </li>`).join("")
    : `<li class='txt-empty'>${T("amis.noRequests", "Aucune demande reçue.")}</li>`;

  const ulEnvoyees = document.getElementById("demandes-envoyees");
  ulEnvoyees.innerHTML = data.demandesEnvoyees?.length
    ? data.demandesEnvoyees.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
      </li>`).join("")
    : `<li class='txt-empty'>${T("amis.noSent", "Aucune demande envoyée.")}</li>`;
}

// ===== RPC wrappers =====
async function envoyerDemandeAmi(pseudoAmi) {
  // garde quelques gardes-fous côté client
  const my = await window.getUserDataCloud();
  if (!pseudoAmi || pseudoAmi === my.pseudo)
    return toast("amis.cannotAddSelf", "#b93f3f", "Tu ne peux pas t'ajouter toi-même !");
  // appel RPC (fait les 2 updates côté serveur)
  const { data, error } = await window.supabase.rpc('friends_request', {
    op: 'send',
    other_pseudo: pseudoAmi
  });
  if (error || !data?.ok) {
    console.error('friends_request send:', error || data);
    const reason = data?.reason || 'unknown';
    const mapMsg = {
      not_authenticated: "Tu n'es pas connecté.",
      sender_not_found: "Profil introuvable.",
      receiver_not_found: "Aucun utilisateur trouvé.",
      already_friends: "Vous êtes déjà amis !",
      already_sent: "Demande déjà envoyée.",
      already_received: "Cette personne t'a déjà envoyé une demande !"
    };
    return toast("amis.errorSend", "#b93f3f", mapMsg[reason] || "Impossible d'envoyer la demande.");
  }
  toast("amis.sent", "#222", "Demande envoyée !");
  await rechargerAffichage();
}

window.accepterDemande = async function(pseudoAmi) {
  const { data, error } = await window.supabase.rpc('friends_request', {
    op: 'accept',
    other_pseudo: pseudoAmi
  });
  if (error || !data?.ok) {
    console.error('friends_request accept:', error || data);
    return toast("amis.errorAccept", "#b93f3f", "Impossible d'accepter la demande.");
  }
  if (window.incrementFriendsInvited) await window.incrementFriendsInvited();
  toast("amis.nowFriends", "#222", "Vous êtes maintenant amis !");
  await rechargerAffichage();
};

window.refuserDemande = async function(pseudoAmi) {
  const { data, error } = await window.supabase.rpc('friends_request', {
    op: 'refuse',
    other_pseudo: pseudoAmi
  });
  if (error || !data?.ok) {
    console.error('friends_request refuse:', error || data);
    return toast("amis.errorRefuse", "#b93f3f", "Impossible de refuser la demande.");
  }
  toast("amis.refused", "#222", "Demande refusée.");
  await rechargerAffichage();
};

// (optionnel) annuler une demande envoyée
window.annulerDemandeEnvoyee = async function(pseudoAmi) {
  const { data, error } = await window.supabase.rpc('friends_request', {
    op: 'cancel',
    other_pseudo: pseudoAmi
  });
  if (error || !data?.ok) {
    console.error('friends_request cancel:', error || data);
    return toast("amis.errorCancel", "#b93f3f", "Impossible d'annuler la demande.");
  }
  toast("amis.canceled", "#222", "Demande annulée.");
  await rechargerAffichage();
};

// Suppression d'ami : popup
window.demanderSuppressionAmi = function(pseudoAmi) {
  amiASupprimer = pseudoAmi;
  document.getElementById('popup-suppr-ami-nom').textContent = pseudoAmi;
  document.getElementById('popup-suppr-ami').classList.remove('hidden');
};
window.confirmerSuppressionAmi = async function() {
  if (!amiASupprimer) return;
  const pseudoAmi = amiASupprimer;
  amiASupprimer = null;
  // on peut réutiliser 'cancel' si tu veux juste retirer le lien de demandes, mais ici c'est une vraie suppression d'ami
  // Pour rester simple: on pourra faire un RPC dédié plus tard (remove_friend).
  const me = await window.getUserDataCloud();
  const { data, error } = await window.supabase.rpc('friends_request', {
    op: 'removeFriend', // géré aussi par la fonction SQL ci-dessous
    other_pseudo: pseudoAmi
  });
  if (error || !data?.ok) {
    console.error('friends_request removeFriend:', error || data);
    toast("amis.errorRemove", "#b93f3f", "Impossible de supprimer l'ami.");
  } else {
    toast("amis.removed", "#222", "Ami supprimé.");
  }
  document.getElementById('popup-suppr-ami').classList.add('hidden');
  await rechargerAffichage();
};
window.annulerSuppressionAmi = function() {
  amiASupprimer = null;
  document.getElementById('popup-suppr-ami').classList.add('hidden');
};
window.defierAmi = function(pseudoAmi) {
  window.location.href = `duel.html?ami=${pseudoAmi}`;
};

// Invitation par lien
function detecterInvitationParLien() {
  const params = new URLSearchParams(window.location.search);
  const toAdd = params.get("add");
  if (toAdd) {
    document.getElementById("pseudo-ami").value = toAdd;
    const question = T("amis.confirmAdd", "Ajouter {{pseudo}} comme ami ?", { pseudo: toAdd });
    if (confirm(question)) {
      envoyerDemandeAmi(toAdd);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}
