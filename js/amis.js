import { supabase, getPseudo, loadUserData, getUserDataCloud, incrementFriendsInvited } from './userData.js';

let userPseudo = null;
let userProfile = null;
let lastAmiRequest = 0; // Anti-spam

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
  userPseudo = await getPseudo();
  await loadUserData();
  await rechargerAffichage();

  const btnAjouter = document.getElementById("btn-ajouter-ami");
  btnAjouter?.addEventListener("click", async () => {
    const pseudoAmi = document.getElementById("pseudo-ami").value.trim();
    if (!pseudoAmi) return;
    // --- Loader + Anti-spam (1 demande toutes les 3s)
    const now = Date.now();
    if (now - lastAmiRequest < 3000) return toast("Patiente un peu avant de refaire une demande.", "#b93f3f");
    lastAmiRequest = now;
    btnAjouter.disabled = true;
    btnAjouter.textContent = "Ajout en cours...";
    try {
      await envoyerDemandeAmi(pseudoAmi);
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
  userProfile = await getUserDataCloud();
  await afficherListesAmis(userProfile);
}

async function afficherListesAmis(data) {
  const ulAmis = document.getElementById("liste-amis");
  ulAmis.innerHTML = ""; // 🔁 nettoyage avant réinjection
  ulAmis.innerHTML = data.amis?.length
    ? data.amis.map(pseudo => `
      <li class="amis-li">
        <span class="ami-avatar">${pseudo.slice(0,2).toUpperCase()}</span>
        <span class="ami-nom">${pseudo}</span>
        <button class="btn-small btn-defi" onclick="window.defierAmi('${pseudo}')">Défier</button>
        <button class="btn-small btn-suppr" onclick="window.supprimerAmi('${pseudo}')">❌</button>
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

window.envoyerDemandeAmi = async function(pseudoAmi) {
  if (!userPseudo || !pseudoAmi || pseudoAmi === userPseudo)
    return toast("Tu ne peux pas t'ajouter toi-même !", "#b93f3f");

  const { data: ami, error } = await supabase
    .from("users")
    .select("id, demandesRecues, amis, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (error || !ami) return toast("Aucun utilisateur trouvé.", "#b93f3f");

  userProfile = await getUserDataCloud();

  if (userProfile.amis?.includes(pseudoAmi)) return toast("Vous êtes déjà amis !");
  if (userProfile.demandesEnvoyees?.includes(pseudoAmi)) return toast("Demande déjà envoyée.");
  if (userProfile.demandesRecues?.includes(pseudoAmi)) return toast("Cette personne t'a déjà envoyé une demande !");

  const newEnv = [...(userProfile.demandesEnvoyees || []), pseudoAmi];
  const newRec = [...(ami.demandesRecues || []), userPseudo];

  await supabase.from("users").update({ demandesEnvoyees: newEnv }).ilike("pseudo", userPseudo);
  await supabase.from("users").update({ demandesRecues: newRec }).eq("id", ami.id);

  toast("Demande envoyée à " + pseudoAmi + " !");
  await rechargerAffichage();
};

window.accepterDemande = async function(pseudoAmi) {
  const { data: ami } = await supabase
    .from("users")
    .select("id, amis, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (!ami) return;

  userProfile = await getUserDataCloud();
  const newAmis = [...(userProfile.amis || []), pseudoAmi];
  const newDemandes = (userProfile.demandesRecues || []).filter(p => p !== pseudoAmi);

  await supabase.from("users").update({
    amis: newAmis,
    demandesRecues: newDemandes
  }).ilike("pseudo", userPseudo);

  await supabase.from("users").update({
    amis: [...(ami.amis || []), userPseudo],
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  await incrementFriendsInvited();
  toast("Vous êtes maintenant amis !");
  await rechargerAffichage();
};

window.refuserDemande = async function(pseudoAmi) {
  const { data: ami } = await supabase
    .from("users")
    .select("id, demandesEnvoyees")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (!ami) return;

  userProfile = await getUserDataCloud();

  await supabase.from("users").update({
    demandesRecues: (userProfile.demandesRecues || []).filter(p => p !== pseudoAmi)
  }).ilike("pseudo", userPseudo);

  await supabase.from("users").update({
    demandesEnvoyees: (ami.demandesEnvoyees || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("Demande refusée.");
  await rechargerAffichage();
};

window.supprimerAmi = async function(pseudoAmi) {
  const { data: ami } = await supabase
    .from("users")
    .select("id, amis")
    .ilike("pseudo", pseudoAmi)
    .maybeSingle();

  if (!ami) return;

  userProfile = await getUserDataCloud();

  await supabase.from("users").update({
    amis: (userProfile.amis || []).filter(p => p !== pseudoAmi)
  }).ilike("pseudo", userPseudo);

  await supabase.from("users").update({
    amis: (ami.amis || []).filter(p => p !== userPseudo)
  }).eq("id", ami.id);

  toast("Ami supprimé.");
  await rechargerAffichage();
};

window.defierAmi = function(pseudoAmi) {
  window.location.href = `duel.html?ami=${pseudoAmi}`;
};

function detecterInvitationParLien() {
  const params = new URLSearchParams(window.location.search);
  const toAdd = params.get("add");
  if (toAdd) {
    document.getElementById("pseudo-ami").value = toAdd;
    if (confirm(`Ajouter ${toAdd} comme ami ?`)) {
      envoyerDemandeAmi(toAdd);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
}

