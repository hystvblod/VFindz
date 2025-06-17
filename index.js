import { Consent } from '@capawesome-team/capacitor-consent';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Consent.requestInfoUpdate();
    await Consent.loadAndShowConsentFormIfRequired();
  } catch (error) {
    console.warn('Erreur RGPD :', error);
  }
});
