import { supabase } from './js/userData.js';
import cadres from './data/cadres.json' with { type: 'json' };

async function importerTousLesCadres() {
  for (const cadre of cadres) {
    const { id, nom, prix, unlock, condition } = cadre;
    const image_url = `https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/${id}.webp`;
    const premium = parseInt(id.split('_')[1]) >= 100;

    const { error } = await supabase
      .from('cadres')
      .upsert({
        id,
        nom,
        prix,
        unlock: unlock || null,
        condition: condition || null,
        image_url,
        premium
      });

    if (error) console.error(`Erreur pour ${id} :`, error.message);
    else console.log(`✅ Cadre ajouté : ${id}`);
  }
}

importerTousLesCadres();
