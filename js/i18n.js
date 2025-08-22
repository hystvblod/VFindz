// i18n.js — Système multilingue PRO VFindz (auto-refresh à l’ouverture + cache de secours)

// Langues supportées
const SUPPORTED_LANGS = ["fr", "en", "es", "de", "it", "nl", "pt", "ptbr", "ar", "idn", "ja", "ko"];

// Version (utile si un jour tu veux repasser en cache stricte)
const I18N_VER = "1.0.0";

// Data i18n globale
window.i18nData = window.i18nData || {};

// Langue courante
window.getCurrentLang = function () {
  let lang = localStorage.getItem("langue") || navigator.language?.split("-")[0] || "fr";
  if (!SUPPORTED_LANGS.includes(lang)) lang = "fr";
  return lang;
};

// Lookup
window.i18nGet = function (key) {
  return window.i18nData[key] || key;
};

// Appliquer toutes les traductions dans la page
window.i18nTranslateAll = function () {
  // data-i18n (contenu)
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const translation = window.i18nGet(key);
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.placeholder = translation;
    } else {
      el.innerHTML = translation;
    }
  });

  // title
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    el.title = window.i18nGet(key);
  });

  // alt
  document.querySelectorAll("[data-i18n-alt]").forEach(el => {
    const key = el.getAttribute("data-i18n-alt");
    el.alt = window.i18nGet(key);
  });

  // placeholder explicite
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = window.i18nGet(key);
  });

  // aria-label
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria-label");
    el.setAttribute("aria-label", window.i18nGet(key));
  });
};

// Charger la langue : on force le fetch à l’ouverture, on stocke en localStorage, et on a un cache de secours
window.loadI18nLang = async function (force = false) {
  const lang = window.getCurrentLang();
  const cacheKey = "lang_" + lang + "_" + I18N_VER;

  // Si on a déjà en mémoire et qu'on ne force pas → rien à faire
  if (window.i18nData && Object.keys(window.i18nData).length > 0 && !force) return;

  try {
    // Mode refresh : on refetch toujours (no-store) à l’ouverture
    if (force) {
      const res = await fetch(`data/lang_${lang}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("Langue introuvable");
      window.i18nData = await res.json();
      // On stocke après refresh
      localStorage.setItem(cacheKey, JSON.stringify(window.i18nData));
      return;
    }

    // Sinon, tenter le cache local
    const data = localStorage.getItem(cacheKey);
    if (data) {
      window.i18nData = JSON.parse(data);
      return;
    }

    // Sans cache, fetch standard
    const res = await fetch(`data/lang_${lang}.json`, { cache: "no-store" });
    if (!res.ok) throw new Error("Langue introuvable");
    window.i18nData = await res.json();
    localStorage.setItem(cacheKey, JSON.stringify(window.i18nData));
  } catch (e) {
    // Échec du fetch : essayer le cache local de la langue courante
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      window.i18nData = JSON.parse(cached);
      return;
    }
    // Dernier fallback : FR
    try {
      const res = await fetch(`data/lang_fr.json`, { cache: "no-store" });
      window.i18nData = await res.json();
      localStorage.setItem("lang_fr_" + I18N_VER, JSON.stringify(window.i18nData));
    } catch (_) {
      window.i18nData = {};
    }
  }
};

// Anti-flash : cacher le body le temps d’appliquer la trad
document.addEventListener("DOMContentLoaded", async function () {
  document.body.style.visibility = "hidden";
  // >>> Refresh à l’ouverture + stockage après refresh <<<
  await window.loadI18nLang(true);
  window.i18nTranslateAll();
  document.body.style.visibility = "visible";
});

// Changement de langue runtime
window.setLang = async function (newLang) {
  if (!SUPPORTED_LANGS.includes(newLang)) newLang = "fr";
  localStorage.setItem("langue", newLang);
  await window.loadI18nLang(true); // refetch + store
  window.i18nTranslateAll();
};

// Helper t() avec variables
window.t = function (key, vars, fallback) {
  let txt = window.i18nGet ? window.i18nGet(key) : undefined;
  if (!txt || txt === key) txt = fallback || key;
  if (vars && typeof vars === "object") {
    for (const k in vars) {
      txt = txt.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), vars[k]);
    }
  }
  return txt;
};
