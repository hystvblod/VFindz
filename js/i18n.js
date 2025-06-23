// i18n.js — Système multilingue PRO VFindz

// Liste des langues supportées
const SUPPORTED_LANGS = ["fr", "en", "es", "de", "it", "nl", "pt", "ptbr", "ar", "id", "ja", "ko"];

// Sur window, la data i18n globale
window.i18nData = window.i18nData || {};

// Récupérer la langue actuelle choisie, ou défaut navigateur
window.getCurrentLang = function() {
  let lang = localStorage.getItem("langue") || navigator.language?.split("-")[0] || "fr";
  if (!SUPPORTED_LANGS.includes(lang)) lang = "fr";
  return lang;
};

// Récupérer une clé traduite (fallback clé brute si absente)
window.i18nGet = function(key) {
  return window.i18nData[key] || key;
};

// Appliquer toutes les traductions dans la page
window.i18nTranslateAll = function() {
  // Attribut data-i18n sur tout le DOM
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const translation = window.i18nGet(key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = translation;
    } else {
      el.innerHTML = translation;
    }
  });
  // Attributs title
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const translation = window.i18nGet(key);
    el.title = translation;
  });
  // Attributs alt
  document.querySelectorAll('[data-i18n-alt]').forEach(el => {
    const key = el.getAttribute('data-i18n-alt');
    const translation = window.i18nGet(key);
    el.alt = translation;
  });
  // Attributs placeholder (ex pour search, etc.)
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = window.i18nGet(key);
    el.placeholder = translation;
  });
};

// Charger la langue depuis le cache/localStorage ou via fetch si besoin
window.loadI18nLang = async function(force = false) {
  const lang = window.getCurrentLang();
  if (window.i18nData && Object.keys(window.i18nData).length > 0 && !force) return;
  try {
    let data = localStorage.getItem("lang_" + lang);
    if (data && !force) {
      window.i18nData = JSON.parse(data);
    } else {
      const res = await fetch(`data/lang_${lang}.json`);
      if (!res.ok) throw new Error("Langue introuvable");
      window.i18nData = await res.json();
      localStorage.setItem("lang_" + lang, JSON.stringify(window.i18nData));
    }
  } catch (e) {
    // Fallback français en cas d’erreur
    const res = await fetch(`data/lang_fr.json`);
    window.i18nData = await res.json();
    localStorage.setItem("lang_fr", JSON.stringify(window.i18nData));
  }
};

// Système pour cacher le body le temps du chargement (anti FOU flash)
document.addEventListener("DOMContentLoaded", async function() {
  document.body.style.visibility = "hidden";
  await window.loadI18nLang();
  window.i18nTranslateAll();
  document.body.style.visibility = "visible";
});

// (optionnel) Permet de forcer le reload si changement de langue
window.setLang = async function(newLang) {
  if (!SUPPORTED_LANGS.includes(newLang)) newLang = "fr";
  localStorage.setItem("langue", newLang);
  await window.loadI18nLang(true);
  window.i18nTranslateAll();
};
