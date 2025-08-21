// amis.js — VERSION CORRIGÉE + i18n SAFE

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
  // Remplacement très simple des {{var}} si pas d'i18n
  let txt = fallback;
  Object.keys(params || {}).forEach(k => {
    txt = txt.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), params[k]);
  });
  return txt;
}

function toast(msgKey, color = "#222", fallback = msgKey, params = {}) {
  const msg = T(msgKey, fallback, params);
  let t = document.createElement("div");
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
    if (now - lastAmiRequest < 3000) return toast("amis.waitRequest", "#b93f3f", "Patiente un peu avant de refaire une demande.");
    lastAmiRequest = now;
    btnAjouter.disabled = true;
    btnAjouter.textContent = T("amis.adding", "Ajout en cours...");
    try {
      await window.envoyerDemandeAmi(pseudoAmi);
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

// Demande d'ajout d'ami
window.envoyerDemandeAmi = async function(pseudoAmi) {
  if (!userPseudo || !pseudoAmi || pseudoAmi === userPseudo)
    return toast("amis.cannotAddSelf", "#b93f3f", "Tu ne peux pas t'ajouter toi-même !");

  const { data: ami, error } = await window.supabase
    .from("users")
    .select("id, demandesRecues, amis, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (error || !ami) return toast("amis.notFound", "#b93f3f", "Aucun utilisateur trouvé.");

  userProfile = await window.getUserDataCloud();

  if (userProfile.amis?.includes(pseudoAmi)) return toast("amis.alreadyFriends", "#222", "Vous êtes déjà amis !");
  if (userProfile.demandesEnvoyees?.includes(pseudoAmi)) return toast("amis.alreadySent", "#222", "Demande déjà envoyée.");
  if (userProfile.demandesRecues?.includes(pseudoAmi)) return toast("amis.alreadyReceived", "#222", "Cette personne t'a déjà envoyé une demande !");

  const newEnv = [...(userProfile.demandesEnvoyees || []), pseudoAmi];
  const newRec = [...(ami.demandesRecues || []), userPseudo];

  // Update de TON profil par ID unique
  await window.supabase.from("users").update({ demandesEnvoyees: newEnv }).eq("id", window.getUserId());
  // Update du profil de l'ami par son id
  await window.supabase.from("users").update({ demandesRecues: newRec }).eq("id", ami.id);

  toast("amis.sent", "#222", "Demande envoyée !");
  await rechargerAffichage();
};

// Accepter une demande d'ami
window.accepterDemande = async function(pseudoAmi) {
  const { data: ami } = await window.supabase
    .from("users")
    .select("id, amis, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (!ami) return;

  userProfile = await window.getUserDataCloud();
  const newAmis = [...(userProfile.amis || []), pseudoAmi];
  const newDemandes = (userProfile.demandesRecues || []).filter(p => p !== pseudoAmi);

  await window.supabase.from("users").update({
    amis: newAmis,
    demandesRecues: newDemandes
  }).eq("id", window.getUserId());

  await window.supabase.from("users").update({
    amis: [...(ami.amis || []), userPseudo],
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  if (window.incrementFriendsInvited) await window.incrementFriendsInvited();
  toast("amis.nowFriends", "#222", "Vous êtes maintenant amis !");
  await rechargerAffichage();
};

// Refuser une demande
window.refuserDemande = async function(pseudoAmi) {
  const { data: ami } = await window.supabase
    .from("users")
    .select("id, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();
  if (!ami) return;
  userProfile = await window.getUserDataCloud();

  await window.supabase.from("users").update({
    demandesRecues: (userProfile.demandesRecues || []).filter(p => p !== pseudoAmi)
  }).eq("id", window.getUserId());

  await window.supabase.from("users").update({
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("amis.refused", "#222", "Demande refusée.");
  await rechargerAffichage();
};

// Suppression d'ami
window.demanderSuppressionAmi = function(pseudoAmi) {
  amiASupprimer = pseudoAmi;
  document.getElementById('popup-suppr-ami-nom').textContent = pseudoAmi;
  document.getElementById('popup-suppr-ami').classList.remove('hidden');
};
window.confirmerSuppressionAmi = async function() {
  if (!amiASupprimer) return;
  const pseudoAmi = amiASupprimer;
  amiASupprimer = null;
  const { data: ami } = await window.supabase
    .from("users")
    .select("id, amis")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();
  if (!ami) return;
  userProfile = await window.getUserDataCloud();

  await window.supabase.from("users").update({
    amis: (userProfile.amis || []).filter(p => p !== pseudoAmi)
  }).eq("id", window.getUserId());

  await window.supabase.from("users").update({
    amis: (ami.amis || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("amis.removed", "#222", "Ami supprimé.");
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
      window.envoyerDemandeAmi(toAdd);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}
