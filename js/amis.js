let userPseudo = null;
let userProfile = null;
let lastAmiRequest = 0;
let amiASupprimer = null;

function toast(msg, color = "#222") {
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
    if (now - lastAmiRequest < 3000) return toast("Patiente un peu avant de refaire une demande.", "#b93f3f");
    lastAmiRequest = now;
    btnAjouter.disabled = true;
    btnAjouter.textContent = "Ajout en cours...";
    try {
      await window.envoyerDemandeAmi(pseudoAmi);
    } finally {
      btnAjouter.disabled = false;
      btnAjouter.textContent = "Ajouter un ami";
    }
  });

  document.getElementById("btn-lien-invit")?.addEventListener("click", () => {
    const base = window.location.origin + window.location.pathname;
    document.getElementById("lien-invit-output").value = `${base}?add=${userPseudo}`;
    toast("Lien copié, partage à tes amis !");
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
        <button class="btn-small btn-defi" onclick="window.defierAmi('${pseudo}')">Défier</button>
        <button class="btn-small btn-suppr" onclick="window.demanderSuppressionAmi('${pseudo}')">❌</button>
      </li>`).join("")
    : "<li class='txt-empty'>Tu n'as pas encore d'amis.</li>";

  const ulRecues = document.getElementById("demandes-recue");
  ulRecues.innerHTML = data.demandesRecues?.length
    ? data.demandesRecues.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
        <button class="btn-small btn-accept" onclick="window.accepterDemande('${pseudo}')">Accepter</button>
        <button class="btn-small btn-refuse" onclick="window.refuserDemande('${pseudo}')">Refuser</button>
      </li>`).join("")
    : "<li class='txt-empty'>Aucune demande reçue.</li>";

  const ulEnvoyees = document.getElementById("demandes-envoyees");
  ulEnvoyees.innerHTML = data.demandesEnvoyees?.length
    ? data.demandesEnvoyees.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
      </li>`).join("")
    : "<li class='txt-empty'>Aucune demande envoyée.</li>";
}

// Demande d'ajout d'ami
window.envoyerDemandeAmi = async function(pseudoAmi) {
  if (!userPseudo || !pseudoAmi || pseudoAmi === userPseudo)
    return toast("Tu ne peux pas t'ajouter toi-même !", "#b93f3f");
  const { data: ami, error } = await window.supabase
    .from("users")
    .select("id, demandesRecues, amis, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();
  if (error || !ami) return toast("Aucun utilisateur trouvé.", "#b93f3f");

  userProfile = await window.getUserDataCloud();

  if (userProfile.amis?.includes(pseudoAmi)) return toast("Vous êtes déjà amis !");
  if (userProfile.demandesEnvoyees?.includes(pseudoAmi)) return toast("Demande déjà envoyée.");
  if (userProfile.demandesRecues?.includes(pseudoAmi)) return toast("Cette personne t'a déjà envoyé une demande !");

  const newEnv = [...(userProfile.demandesEnvoyees || []), pseudoAmi];
  const newRec = [...(ami.demandesRecues || []), userPseudo];

  await window.supabase.from("users").update({ demandesEnvoyees: newEnv }).ilike("pseudo", userPseudo);
  await window.supabase.from("users").update({ demandesRecues: newRec }).eq("id", ami.id);

  toast("Demande envoyée à " + pseudoAmi + " !");
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
  }).ilike("pseudo", userPseudo);

  await window.supabase.from("users").update({
    amis: [...(ami.amis || []), userPseudo],
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  if (window.incrementFriendsInvited) await window.incrementFriendsInvited();
  toast("Vous êtes maintenant amis !");
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
  }).ilike("pseudo", userPseudo);

  await window.supabase.from("users").update({
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("Demande refusée.");
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
  const { data: ami } = await window.supabase
    .from("users")
    .select("id, amis")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();
  if (!ami) return;
  userProfile = await window.getUserDataCloud();
  await window.supabase.from("users").update({
    amis: (userProfile.amis || []).filter(p => p !== pseudoAmi)
  }).ilike("pseudo", userPseudo);
  await window.supabase.from("users").update({
    amis: (ami.amis || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("Ami supprimé.");
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
    if (confirm(`Ajouter ${toAdd} comme ami ?`)) {
      window.envoyerDemandeAmi(toAdd);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}
