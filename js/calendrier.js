import { supabase, getUserId, loadUserData } from './userData.js';

document.addEventListener("DOMContentLoaded", async () => {
  let dateCourante = new Date();
  let moisAffiche = dateCourante.getMonth();
  let anneeAffichee = dateCourante.getFullYear();
  let historique = [];
  let dateInscription = null;
  const moisFr = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  function formatYMD(d) {
    return d.toISOString().slice(0, 10);
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
      date: e.date,
      defis: e.defis || e.defi || [],
      type: e.type || "solo"
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

    const soloParJour = {}, duelRandomParJour = {}, duelAmisParJour = {};
    historique.forEach(entree => {
      let dateISO = (entree.date || '').slice(0, 10);
      if (entree.type === "solo") soloParJour[dateISO] = (soloParJour[dateISO] || []).concat(entree.defis || []);
      if (entree.type === "duel_random") duelRandomParJour[dateISO] = (duelRandomParJour[dateISO] || []).concat(entree.defis || []);
      if (entree.type === "duel_amis") duelAmisParJour[dateISO] = (duelAmisParJour[dateISO] || []).concat(entree.defis || []);
    });

    let html = '<div class="calendrier">';
    html += '<div class="sem">Lun</div><div class="sem">Mar</div><div class="sem">Mer</div><div class="sem">Jeu</div><div class="sem">Ven</div><div class="sem">Sam</div><div class="sem">Dim</div>';
    const decal = (premierJour.getDay() + 6) % 7;
    for (let i = 0; i < decal; i++) html += '<div class="jour vide"></div>';

    let totalDefisMois = 0, totalDefisTous = 0;
    Object.values(soloParJour).forEach(list => totalDefisTous += list.length);
    Object.values(duelRandomParJour).forEach(list => totalDefisTous += list.length);
    Object.values(duelAmisParJour).forEach(list => totalDefisTous += list.length);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const inscriptionYMD = dateInscription ? formatYMD(dateInscription) : null;

    for (let j = 1; j <= nbJours; j++) {
      const d = new Date(anneeAffichee, moisAffiche, j);
      const dstr = formatYMD(d);
      let classes = ["jour"];
      let color = "#fff";
      let textColor = "#222";

      const soloCount = soloParJour[dstr]?.length || 0;
      const duelRandCount = duelRandomParJour[dstr]?.length || 0;
      const duelAmisCount = duelAmisParJour[dstr]?.length || 0;
      const totalJour = soloCount + duelRandCount + duelAmisCount;

      if (inscriptionYMD && dstr < inscriptionYMD) {
        classes.push("jour-grise");
        color = "#f1f1f1";
      } else if (dstr === inscriptionYMD) {
        classes.push("jour-inscription");
        color = "#ffe04a";
        textColor = "#fff";
      } else if (dstr > formatYMD(today)) {
        classes.push("jour-futur");
        color = "#fff";
      } else if (totalJour === 0) {
        color = "#ff2c2c";
        textColor = "#fff";
      } else if (soloCount === 3 || duelRandCount === 3 || duelAmisCount === 3) {
        color = "#16b46a";
        textColor = "#fff";
      } else {
        color = "#baffc7";
        textColor = "#222";
      }

      if (dstr <= formatYMD(today)) totalDefisMois += totalJour;

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
    .jour-grise { opacity: 0
    .jour-inscription { border:2.5px solid #ffe04a; box-shadow:0 0 6px #ffe04a77; }
    .jour-futur { opacity:0 }
  `;
  document.head.appendChild(style);

  await chargerHistoriqueEtInscription();
});
