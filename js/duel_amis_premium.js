// ====== PREMIUM DUEL AMIS : SAISIE DES DEFIS PREMIUM ======

// Tu dois charger ce bloc SEULEMENT sur la page "amis_premium.html" ou équivalent

(function() {
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get("room");

  window.premiumDuelRoomData = null;
  window.premiumDuelIsPlayer1 = false;

  window.mainPremiumDefis = async function() {
    if (!roomId) return;

    const pseudo = await window.getPseudo();
    const userId = await window.getUserId();

    // Récupère la room
    let { data: room } = await window.supabase.from('duels').select('*').eq('id', roomId).single();
    if (!room) {
      document.getElementById("info-premium").innerHTML = "Room introuvable.";
      return;
    }
    window.premiumDuelRoomData = room;
    window.premiumDuelIsPlayer1 = (room.player1_id === userId);

    // Vérifie Premium
    const premium = await window.isPremium();

    // Affiche la bonne UI
    if (room.type !== "amis_premium") {
      document.getElementById("info-premium").innerHTML = "Accès réservé au mode Premium.";
      return;
    }

    // Synchro temps réel
    window.supabase
      .channel('duel_room_' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'duels', filter: `id=eq.${roomId}` }, payload => {
        window.premiumDuelRoomData = payload.new;
        window.majPremiumDefisUI();
      })
      .subscribe();

    window.majPremiumDefisUI();
  };

  window.handleValiderPremiumDefis = async function() {
    let d1 = document.getElementById("input-defi1").value.trim();
    let d2 = document.getElementById("input-defi2").value.trim();

    let d1Filled = d1.length > 0, d2Filled = d2.length > 0;
    let champ = window.premiumDuelIsPlayer1 ? "defis_player1" : "defis_player2";
    let existing = window.premiumDuelRoomData[champ] ? JSON.parse(window.premiumDuelRoomData[champ]) : [];
    // Si déjà 2 défis => il ne doit remplir que le 3e
    if (existing.length === 2) {
      if (!d2Filled) { alert("Merci d’entrer le 3e défi."); return; }
      let updateArr = [existing[0], existing[1], d2];
      let updateObj = {};
      updateObj[champ] = JSON.stringify(updateArr);
      await window.supabase.from('duels').update(updateObj).eq('id', roomId);
      window.showAttentePremiumDefis();
      return;
    }
    // Normal : 2 défis à écrire
    if (!d1Filled || !d2Filled) { alert("Merci de remplir 2 défis."); return; }
    let updateObj = {};
    updateObj[champ] = JSON.stringify([d1, d2]);
    await window.supabase.from('duels').update(updateObj).eq('id', roomId);
    window.showAttentePremiumDefis();
  };

  window.showAttentePremiumDefis = function() {
    document.getElementById("bloc-defi-saisie").style.display = "none";
    document.getElementById("bloc-attente").style.display = "block";
    document.getElementById("bloc-defis-final").style.display = "none";
  };

  window.showDefisPremiumFinal = function(defis) {
    document.getElementById("bloc-defi-saisie").style.display = "none";
    document.getElementById("bloc-attente").style.display = "none";
    document.getElementById("bloc-defis-final").style.display = "block";
    document.getElementById("liste-defis-final").innerHTML = defis.map(d => `<li>${d}</li>`).join('');
  };

  window.majPremiumDefisUI = function() {
    let roomData = window.premiumDuelRoomData;
    let isPlayer1 = window.premiumDuelIsPlayer1;
    let d1 = roomData.defis_player1 ? JSON.parse(roomData.defis_player1) : [];
    let d2 = roomData.defis_player2 ? JSON.parse(roomData.defis_player2) : [];
    let final = roomData.defis_final ? JSON.parse(roomData.defis_final) : [];

    // 1. Finaux déjà générés
    if (final.length === 3) {
      window.showDefisPremiumFinal(final);
      return;
    }

    // Deux premiums
    if (roomData.premium1 && roomData.premium2) {
      if ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2)) {
        document.getElementById("bloc-defi-saisie").style.display = "block";
        document.getElementById("text-saisie-defis").textContent = "Propose 2 défis originaux pour ce duel :";
        document.getElementById("input-defi1").style.display = "";
        document.getElementById("input-defi2").style.display = "";
        document.getElementById("input-defi1").value = "";
        document.getElementById("input-defi2").value = "";
        document.getElementById("bloc-attente").style.display = "none";
        document.getElementById("bloc-defis-final").style.display = "none";
      } else if (d1.length === 2 && d2.length === 2 && final.length < 3) {
        // Les 2 ont proposé, on tire au sort pour tous
        if (isPlayer1) {
          let all = d1.concat(d2);
          shufflePremium(all);
          let choisis = [all[0], all[1]];
          let restant = all.filter((x, i) => i > 1);
          choisis.push(restant[Math.floor(Math.random() * restant.length)]);
          window.supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
        }
        window.showAttentePremiumDefis();
      } else {
        window.showAttentePremiumDefis();
      }
    } else {
      // 1 seul premium : il écrit les 3 défis (il fait 2 champs puis 1 champ)
      if (roomData.premium1 || roomData.premium2) {
        if ((isPlayer1 && d1.length < 2) || (!isPlayer1 && d2.length < 2)) {
          document.getElementById("bloc-defi-saisie").style.display = "block";
          document.getElementById("text-saisie-defis").textContent = "Écris 2 défis (tu auras un 3e champ après) :";
          document.getElementById("input-defi1").style.display = "";
          document.getElementById("input-defi2").style.display = "";
          document.getElementById("input-defi1").value = "";
          document.getElementById("input-defi2").value = "";
          document.getElementById("bloc-attente").style.display = "none";
          document.getElementById("bloc-defis-final").style.display = "none";
        } else if ((isPlayer1 && d1.length === 2) || (!isPlayer1 && d2.length === 2)) {
          document.getElementById("bloc-defi-saisie").style.display = "block";
          document.getElementById("text-saisie-defis").textContent = "Écris un 3e défi pour ce duel :";
          document.getElementById("input-defi1").style.display = "none";
          document.getElementById("input-defi2").placeholder = "Défi 3...";
          document.getElementById("input-defi2").value = "";
          document.getElementById("bloc-attente").style.display = "none";
          document.getElementById("bloc-defis-final").style.display = "none";
        } else if ((d1.length === 3 || d2.length === 3) && final.length < 3) {
          let choisis = isPlayer1 ? d1 : d2;
          window.supabase.from('duels').update({ defis_final: JSON.stringify(choisis) }).eq('id', roomId);
          window.showAttentePremiumDefis();
        } else {
          window.showAttentePremiumDefis();
        }
      } else {
        window.showAttentePremiumDefis();
      }
    }
  };

  function shufflePremium(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Bind bouton
  document.addEventListener("DOMContentLoaded", function() {
    const btn = document.getElementById("btn-valider-defis");
    if (btn) btn.onclick = window.handleValiderPremiumDefis;
    window.mainPremiumDefis();
  });
})();
