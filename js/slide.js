// onboardingSlides.js
export function initOnboardingSlides() {
  if (!localStorage.getItem("onboardingSeen")) {
    document.getElementById("onboarding-modal").style.display = "flex";
    let slides = document.querySelectorAll(".onboarding-slide");
    let dots = document.querySelectorAll(".dot");
    let curr = 0;

    const showSlide = (idx) => {
      slides.forEach((slide, i) => slide.classList.toggle("active", i === idx));
      dots.forEach((dot, i) => dot.classList.toggle("active", i === idx));
      document.getElementById("onboarding-prev").style.display = idx === 0 ? "none" : "inline-block";
      document.getElementById("onboarding-next").style.display = idx === slides.length - 1 ? "none" : "inline-block";
      document.getElementById("onboarding-close").style.display = idx === slides.length - 1 ? "inline-block" : "none";
    };

    document.getElementById("onboarding-next").onclick = () => {
      if (curr < slides.length - 1) { curr++; showSlide(curr); }
    };
    document.getElementById("onboarding-prev").onclick = () => {
      if (curr > 0) { curr--; showSlide(curr); }
    };
    document.getElementById("onboarding-close").onclick = () => {
      document.getElementById("onboarding-modal").style.display = "none";
      localStorage.setItem("onboardingSeen", "yes");
    };

    // (optionnel) clic sur les dots pour naviguer
    dots.forEach((dot, i) => {
      dot.onclick = () => { curr = i; showSlide(curr); };
    });

    showSlide(curr);
  }
}
