import { supabase, getPseudo as getCurrentUser, getUserId, isPremium } from './userData.js';

const params = new URLSearchParams(window.location.search);
const roomId = params.get("room");

let isPlayer1 = false;
let roomData = null;

async function main() {
  if (!roomId) return;

  const pseudo = await getCurrentUser();
  const userId = await getUserId();

  // Récupère la room
  let { data: room } = await supabase.from('duels').select('*').eq('id', roomId).single();
  if (!room) {
    document.getElementById("info-premium").innerHTML = "Room introuvable.";
    return;
  }
  roomData = room;
  isPlayer1 = (room.player1_id === userId);

  // Vérifie Premium
  const premium = await isPremium();

  // Affiche la bonne UI
  if (room.type !== "amis_premium") {
    document.getElementById("info-premium").innerHTML = "Accès réservé au mode Premium.";
    return;
  }

  // 1. Cas : 1 seul premium → il écrit les 3 défis
  // 2. Cas : 2 premium → chaque joueur écrit 2, puis validation comme expliqué
  let blocSaisie = document.getElementById("bloc-defi-saisie");
  let blocFinal = document.getElementById("bloc-defis-final");
  let blocAttente = document.getElementById("bloc-attente");

  // Saisie des défis
  async function handleValiderDefis() {
    let d1 = document.getElementById("input-defi1").value.trim();
    let d2 = document.getElementById("input-defi2").value.trim();
    if (!d1 || !d2) { alert("Merci de remplir 2 défis."); return; }
    let champ = isPlayer1 ? "defis_player1" : "defis_player2";
    let updateObj = {};
    updateObj[champ] = JSON.stringify([d1, d2]);
    await supabase.from('duels').update(updateObj).eq('id', roomId);
    showAttente();
  }

  // Synchro temps réel
  supabase
    .channel('duel_room_' + roomId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'duels', filter: `id=eq.${roomId}` }, payload => {
      roomData = payload.new;
      majUI();
    })
    .subscribe();

  function showAttente() {
    blocSaisie.style.display = "none";
    blocAttente.style.display = "block";
    blocFinal.style.display = "none";
  }

  function showDefisFinal(defis) {
    blocSaisie.style.display = "none";
    blocAttente.style.display = "none";
    blocFinal.style.display = "block";
    document.getElementById("liste-defis-final").innerHTML = defis.map(d => `<li>${d}</li>`).join('');
  }

  // Gestion UI selon l’état et qui doit écrire
  function majUI() {
    let d1 = roomData.defis_player1 ? JSON.parse(roomData.defis_player1) : [];
    let d2 = roomData.defis_player2 ? JSON.parse(roomData.defis_player2) : [];
    let final = roomData.defis_final ? JSON.parse(roomData.defis_final) : [];

    if (final.length === 3) {
      showDefisFinal(final);
      return;
    }
    // 2 premiums
    if (roomData.premium1 && roomData.premium2) {
      if ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2)) {
        // Saisie défis (2 à remplir)
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Propose 2 défis originaux pour ce duel :";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if (d1.length === 2 && d2.length === 2 && final.length < 3) {
        // Les 2 ont proposé, on tire au sort
        // Logique pour le premier qui passe ici :
        if (isPlayer1) {
          let all = d1.concat(d2);
          shuffle(all);
          let choisis = [all[0], all[1]];
          // 3e au hasard parmi les 2 restants
          let restant = all.filter((x, i) => i > 1);
          choisis.push(restant[Math.floor(Math.random() * restant.length)]);
          supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        }
        showAttente();
      } else {
        showAttente();
      }
    } else {
      // 1 seul premium : c’est lui qui écrit les 3 défis (sur les 2 champs ou tu laisses 3 zones)
      if (premium && ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2))) {
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris 2 défis (tu auras un 3e champ après) :";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if ((isPlayer1 && d1.length === 2) || (!isPlayer1 && d2.length === 2)) {
        // Demande le 3e défi
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris un 3e défi pour ce duel :";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
        // Affiche qu’un seul champ texte
        document.getElementById("input-defi1").style.display = "none";
        document.getElementById("input-defi2").placeholder = "Défi 3...";
      } else if ((d1.length === 3 || d2.length === 3) && final.length < 3) {
        let choisis = isPlayer1 ? d1 : d2;
        supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        showAttente();
      } else {
        showAttente();
      }
    }
  }

  // Shuffle simple
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  // Bouton validation
  document.getElementById("btn-valider-defis").onclick = handleValiderDefis;

  majUI();
}

main();
