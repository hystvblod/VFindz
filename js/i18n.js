window.i18nData = {};
window.i18nGet = function (key) {
  return window.i18nData[key] || key;
};

window.i18nTranslateAll = function () {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = window.i18nGet(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = translation;
    } else {
      el.textContent = translation;
    }
  });
  if (window.i18nData["title"]) {
    document.title = "VFind - " + window.i18nData["title"];
  }
};

(async function initLang() {
  const supported = ["fr", "en", "es", "de", "it", "nl", "pt", "ptbr", "ar", "id", "ja", "ko"];
  let lang = localStorage.getItem("langue") || navigator.language?.split("-")[0] || "fr";
  if (!supported.includes(lang)) lang = "fr";

  try {
    const res = await fetch(`data/lang_${lang}.json`);
    if (!res.ok) throw new Error("Langue introuvable");
    window.i18nData = await res.json();
  } catch (e) {
    console.warn("Erreur chargement langue, fallback français", e);
    const res = await fetch(`data/lang_fr.json`);
    window.i18nData = await res.json();
  }

  window.i18nTranslateAll();
})();
