import { supabase, getUserId, loadUserData } from './userData.js';

document.addEventListener("DOMContentLoaded", async () => {
  // STYLE CALENDRIER PLACÉ AVANT TOUTE GÉNÉRATION
  const style = document.createElement('style');
  style.textContent = `
    .calendrier {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 7px;
      margin: 1.2em auto 1.5em;
      max-width: 420px;
    }
    .jour, .sem {
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 1.09rem;
      border-radius: 9px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.13);
      transition: background .16s;
      cursor: default;
    }
    .sem {
      background: none;
      color: #aaa;
      box-shadow: none;
      font-size: 0.97em;
      font-weight: 600;
    }
    .jour.vide {
      background: none;
      box-shadow: none;
    }
    .jour-grise { opacity: 0 }
    .jour-inscription { border:2.5px solid #ffe04a; box-shadow:0 0 6px #ffe04a77; }
    .jour-futur { opacity:0 }
  `;
  document.head.appendChild(style);

  let dateCourante = new Date();
  let moisAffiche = dateCourante.getMonth();
  let anneeAffichee = dateCourante.getFullYear();
  let historique = [];
  let dateInscription = null;
  const moisFr = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  function formatYMD(d) {
    return d.toISOString().slice(0, 10);
  }

  // Check meilleure couleur pour un tableau de statuts sur un jour donné
  function couleurMax(statuses) {
    // Priorité : vert foncé > vert clair > rouge
    if (statuses.includes("vert-fonce")) return { color: "#16b46a", textColor: "#fff" }; // Tous défis OK
    if (statuses.includes("vert-clair")) return { color: "#baffc7", textColor: "#222" }; // Au moins 1 défi fait
    if (statuses.includes("rouge")) return { color: "#ff2c2c", textColor: "#fff" };      // Aucun défi sur cette période
    return { color: "#fff", textColor: "#222" }; // blanc par défaut
  }

  async function chargerHistoriqueEtInscription() {
    await loadUserData();
    const userId = getUserId();
    if (!userId) return;

    const { data } = await supabase
      .from('users')
      .select('historique, dateinscription')
      .eq('id', userId)
      .single();

    dateInscription = data.dateinscription ? new Date(data.dateinscription) : null;

    historique = (data.historique || []).map(e => ({
      date: e.date, // timestamp ISO (lancement du défi !)
      defis: e.defis || e.defi || [],
      type: e.type || "solo",
      // Optionnel : peut-être un flag "termine" dans ta base :
      termine: e.termine || false
    }));

    if (!dateInscription && historique.length) {
      dateInscription = new Date(historique.map(e => new Date(e.date)).sort((a, b) => a - b)[0]);
    }

    afficherCalendrier();
  }

  function afficherCalendrier() {
    document.getElementById('titre-mois').textContent = moisFr[moisAffiche] + ' ' + anneeAffichee;
    const premierJour = new Date(anneeAffichee, moisAffiche, 1);
    const nbJours = new Date(anneeAffichee, moisAffiche + 1, 0).getDate();

    let html = '<div class="calendrier">';
    html += '<div class="sem">Lun</div><div class="sem">Mar</div><div class="sem">Mer</div><div class="sem">Jeu</div><div class="sem">Ven</div><div class="sem">Sam</div><div class="sem">Dim</div>';
    const decal = (premierJour.getDay() + 6) % 7;
    for (let i = 0; i < decal; i++) html += '<div class="jour vide"></div>';

    let totalDefisMois = 0, totalDefisTous = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inscriptionYMD = dateInscription ? formatYMD(dateInscription) : null;

    // Compteurs globaux
    historique.forEach(entree => {
      totalDefisTous += (entree.defis || []).length;
    });

    for (let j = 1; j <= nbJours; j++) {
      const d = new Date(anneeAffichee, moisAffiche, j);
      d.setHours(0, 0, 0, 0);
      const dstr = formatYMD(d);
      let classes = ["jour"];
      let color = "#fff";
      let textColor = "#222";

      // 1. Dates avant inscription
      if (inscriptionYMD && dstr < inscriptionYMD) {
        classes.push("jour-grise");
        color = "#f1f1f1";
      }
      // 2. Jour d'inscription
      else if (dstr === inscriptionYMD) {
        classes.push("jour-inscription");
        color = "#ffe04a";
        textColor = "#fff";
      }
      // 3. Jours futurs
      else if (dstr > formatYMD(today)) {
        classes.push("jour-futur");
        color = "#fff";
      }
      // 4. "Scan" de tous les défis qui recouvrent ce jour dans leur fenêtre 24h :
      else {
        // Pour chaque défi de l'historique : est-ce que ce jour "d" tombe DANS la fenêtre ?
        let statuses = [];
        historique.forEach(entree => {
          if (!entree.date) return;
          const debut = new Date(entree.date);
          const fin = new Date(debut.getTime() + 24 * 60 * 60 * 1000); // +24h
          if (d >= debut && d < fin) {
            if (Array.isArray(entree.defis) && entree.defis.length === 3) {
              statuses.push("vert-fonce"); // 3 défis faits => vert foncé
            } else if (Array.isArray(entree.defis) && entree.defis.length > 0) {
              statuses.push("vert-clair"); // au moins 1 défi fait
            } else {
              statuses.push("rouge");      // aucun défi fait
            }
          }
        });
        // Définir la couleur prioritaire
        const { color: c, textColor: t } = couleurMax(statuses.length ? statuses : ["rouge"]);
        color = c;
        textColor = t;

        if (statuses.length && color !== "#fff" && d <= today) totalDefisMois += 1;
      }

      html += `<div class="${classes.join(' ')}" style="background:${color}; color:${textColor}">${j}</div>`;
    }

    html += '</div>';
    document.getElementById('calendrier-container').innerHTML = html;
    document.getElementById('stats-calendrier').innerHTML =
      `Défis ce mois : <b>${totalDefisMois}</b> &nbsp;·&nbsp; Depuis le début : <b>${totalDefisTous}</b>`;
  }

  document.getElementById("mois-prec").onclick = () => {
    moisAffiche--;
    if (moisAffiche < 0) { moisAffiche = 11; anneeAffichee--; }
    afficherCalendrier();
  };

  document.getElementById("mois-suiv").onclick = () => {
    moisAffiche++;
    if (moisAffiche > 11) { moisAffiche = 0; anneeAffichee++; }
    afficherCalendrier();
  };

  await chargerHistoriqueEtInscription();
});
