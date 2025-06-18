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

  // Saisie des défis
  async function handleValiderDefis() {
    let d1 = document.getElementById("input-defi1").value.trim();
    let d2 = document.getElementById("input-defi2").value.trim();

    // Cas : on écrit le 3e défi
    let d1Filled = d1.length > 0, d2Filled = d2.length > 0;
    let champ = isPlayer1 ? "defis_player1" : "defis_player2";
    let existing = roomData[champ] ? JSON.parse(roomData[champ]) : [];
    // Si déjà 2 défis => il ne doit remplir que le 3e
    if (existing.length === 2) {
      if (!d2Filled) { alert("Merci d’entrer le 3e défi."); return; }
      let updateArr = [existing[0], existing[1], d2];
      let updateObj = {};
      updateObj[champ] = JSON.stringify(updateArr);
      await supabase.from('duels').update(updateObj).eq('id', roomId);
      showAttente();
      return;
    }
    // Normal : 2 défis à écrire
    if (!d1Filled || !d2Filled) { alert("Merci de remplir 2 défis."); return; }
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

  // UI helpers
  let blocSaisie = document.getElementById("bloc-defi-saisie");
  let blocFinal = document.getElementById("bloc-defis-final");
  let blocAttente = document.getElementById("bloc-attente");

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
    // Deux premiums
    if (roomData.premium1 && roomData.premium2) {
      if ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2)) {
        // Saisie défis (2 à remplir)
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Propose 2 défis originaux pour ce duel :";
        // Champs visibles
        document.getElementById("input-defi1").style.display = "";
        document.getElementById("input-defi2").style.display = "";
        document.getElementById("input-defi1").value = "";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if (d1.length === 2 && d2.length === 2 && final.length < 3) {
        // Les 2 ont proposé, on tire au sort pour tous
        if (isPlayer1) {
          let all = d1.concat(d2);
          shuffle(all);
          let choisis = [all[0], all[1]];
          let restant = all.filter((x, i) => i > 1);
          choisis.push(restant[Math.floor(Math.random() * restant.length)]);
          supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        }
        showAttente();
      } else {
        showAttente();
      }
    } else {
      // 1 seul premium : il écrit les 3 défis (il fait 2 champs puis 1 champ)
      if (premium && ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2))) {
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris 2 défis (tu auras un 3e champ après) :";
        document.getElementById("input-defi1").style.display = "";
        document.getElementById("input-defi2").style.display = "";
        document.getElementById("input-defi1").value = "";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
      } else if ((isPlayer1 && d1.length === 2) || (!isPlayer1 && d2.length === 2)) {
        // Demande le 3e défi
        blocSaisie.style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Écris un 3e défi pour ce duel :";
        document.getElementById("input-defi1").style.display = "none";
        document.getElementById("input-defi2").placeholder = "Défi 3...";
        document.getElementById("input-defi2").value = "";
        blocAttente.style.display = "none";
        blocFinal.style.display = "none";
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
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Bouton validation
  document.getElementById("btn-valider-defis").onclick = handleValiderDefis;

  majUI();
}

main();
