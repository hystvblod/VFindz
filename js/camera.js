// ==== Fonctions accessibles globalement ====

// Fonction de normalisation mobile, AJOUTE-LA TOUT EN HAUT
window.normaliserPhotoMobile = function(base64Image) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      const sizeW = 500, sizeH = 550;
      const destRatio = sizeW / sizeH;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      const srcRatio = img.width / img.height;
      if (srcRatio > destRatio) {
        sw = img.height * destRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / destRatio;
        sy = (img.height - sh) / 2;
      }
      canvas.width = sizeW;
      canvas.height = sizeH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sizeW, sizeH);
      resolve(canvas.toDataURL("image/webp", 0.93));
    };
    img.onerror = reject;
    img.src = base64Image;
  });
}

// Générer image + cadre concours (inchangé, version Promise, sur window)
window.genererImageConcoursAvecCadre = function(base64Image) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const sizeW = 500, sizeH = 550;
      canvas.width = sizeW;
      canvas.height = sizeH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, sizeW, sizeH);

      // CROP AU BON RATIO SANS ÉTIREMENT
      const destRatio = sizeW / sizeH; // 0.909

      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      const srcRatio = img.width / img.height;

      if (srcRatio > destRatio) {
        // Image trop large : crop sur les côtés
        sw = img.height * destRatio;
        sx = (img.width - sw) / 2;
      } else {
        // Image trop haute : crop en haut et en bas
        sh = img.width / destRatio;
        sy = (img.height - sh) / 2;
      }

      // On colle l'image recadrée pile au ratio polaroid
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sizeW, sizeH);

      // Ajoute le cadre polaroid au-dessus
      const cadre = new Image();
      cadre.onload = () => {
        ctx.drawImage(cadre, 0, 0, sizeW, sizeH);
        resolve(canvas.toDataURL("image/webp", 0.93));
      };
      cadre.onerror = () => reject("Erreur chargement cadre concours !");
      cadre.src = window.getCadreUrl ? window.getCadreUrl("polaroid_01") : "https://swmdepiukfginzhbeccz.supabase.co/storage/v1/object/public/cadres/polaroid_01.webp";
    };
    img.onerror = () => reject("Erreur chargement photo !");
    img.src = base64Image;
  });
};

window.uploadPhotoConcoursWebp = async function(dataUrl, concoursId, userId) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1].split(',')[1] || arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  const blob = new Blob([u8arr], { type: mime });

  // --------- Ajout d'une vraie date dans le nom du fichier -----------
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2,8);

  // Format: 20240709_181650_xyz123_userid.webp
  const fileName = `${yyyy}${mm}${dd}_${hh}${min}${ss}_${rand}_${userId}.webp`;

  const { data: uploadData, error: uploadError } = await window.supabase
    .storage
    .from('photoconcours')
    .upload(fileName, blob, { contentType: 'image/webp' });

  if (uploadError) throw uploadError;

  const { data: publicUrlData } = window.supabase
    .storage
    .from('photoconcours')
    .getPublicUrl(fileName);

  return publicUrlData.publicUrl;
};


// --------- OUVERTURE CAMERA UNIFIÉE CAPACITOR + WEB ---------
window.ouvrirCameraPour = async function(defiId, mode = "solo", duelId = null, cadreId = null) {
  // Cas mobile natif Capacitor, TEST ultra solide
  if (
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    typeof window.Capacitor.isNativePlatform === "function" &&
    window.Capacitor.isNativePlatform() &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Camera &&
    typeof window.Capacitor.Plugins.Camera.getPhoto === "function"
  ) {
    try {
      const photo = await window.Capacitor.Plugins.Camera.getPhoto({
        quality: 85,
        allowEditing: false,
        resultType: 'dataUrl',
        source: 'CAMERA'
      });

      const dataUrl = photo.dataUrl;
      const dataUrlNormalise = await window.normaliserPhotoMobile(dataUrl);

      // Mode duel
      if (mode === "duel") {
        if (!duelId) return alert("Erreur interne : duelId manquant.");
        if (!cadreId) cadreId = "polaroid_01";
        try {
          const urlPhoto = await window.uploadPhotoDuelWebp(dataUrlNormalise, duelId, defiId, cadreId);
          const userId = await window.getUserId();
          localStorage.setItem(`photo_duel_${duelId}_${userId}`, urlPhoto);
          await window.savePhotoDuel(defiId, urlPhoto, cadreId);
          const champ = (window.isPlayer1) ? 'photosa' : 'photosb';
          if (window.VFindDuelDB && window.currentRoomId) {
            await window.VFindDuelDB.set(`${duelId}_${champ}_${defiId}`, { url: urlPhoto, cadre: cadreId });
          }
          if (window.updateDuelUI) window.updateDuelUI();
          return urlPhoto;
        } catch (err) {
          alert("Erreur upload duel : " + err.message);
          throw err;
        }
      }
      // Mode solo
      else if (mode === "solo") {
        const cadre = (await window.getCadreSelectionne?.()) || "polaroid_01";
        const obj = { photo: dataUrlNormalise, cadre };
        localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(obj));
        if (window.afficherPhotoDansCadreSolo) {
          window.afficherPhotoDansCadreSolo(defiId, dataUrlNormalise);
        }
        return dataUrlNormalise;
      }
      // Mode concours
      else if (mode === "concours") {
        try {
          const userId = await window.getUserId();
          const urlPhoto = await window.uploadPhotoConcoursWebp(dataUrlNormalise, defiId, userId);
          return urlPhoto;
        } catch (err) {
          alert("Erreur upload concours : " + (err.message || err));
          throw err;
        }
      }

    } catch (err) {
      alert("Erreur caméra native : " + (err.message || err));
      throw err;
    }
    return;
  }

  // ----- Sinon version navigateur web -----
  return new Promise((resolve, reject) => {
    const container = document.createElement("div");
    container.className = "camera-container-fullscreen";
    container.innerHTML = `
      <div class="camera-video-zone">
        <div class="camera-video-wrapper">
          <video autoplay playsinline class="camera-video"></video>
        </div>
        <div class="camera-controls camera-controls-pro">
          <button id="switchCamera" title="Changer de caméra" class="camera-btn">
            <span class="cam-ico">&#8635;</span>
            <span class="cam-label">Retourner</span>
          </button>
          <button id="takePhoto" class="camera-btn btn-capture" title="Prendre la photo">
            <span class="cam-ico-big"></span>
          </button>
          <button id="closeCamera" title="Fermer" class="camera-btn camera-btn-close">
            <span class="cam-ico">&#10006;</span>
            <span class="cam-label">Fermer</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    // ... (le style et toute la gestion UI, inchangé, voir ci-dessous pour la suite)
    const style = document.createElement("style");
    style.innerHTML = `
.camera-video-zone {
  position: relative;
  width: 100vw;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}
.camera-video-wrapper {
  position: relative;
  width: min(100vw, 100vh * 10 / 11, 500px);
  height: min(100vh, 100vw * 11 / 10, 550px);
  aspect-ratio: 10/11;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 30px;
  background: #111;
  box-shadow: 0 8px 32px #0005;
  display: flex;
  align-items: center;
  justify-content: center;
}
.camera-video-wrapper video {
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
  border-radius: 30px;
  transition: transform 0.12s cubic-bezier(.46,1.48,.45,.89);
  will-change: transform;
  display: block;
  position: relative;
  z-index: 1;
}
.camera-controls-pro {
  margin-top: 22px;
  display: flex;
  justify-content: center;
  gap: 28px;
  z-index: 2;
  position: relative;
}
.camera-photo-preview {
  position: absolute;
  left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(20,22,32,0.97);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
    `;
    document.head.appendChild(style);

    const video = container.querySelector("video");
    const switchBtn = container.querySelector("#switchCamera");
    const takeBtn = container.querySelector("#takePhoto");
    const closeBtn = container.querySelector("#closeCamera");

    let videoStream = null;
    let useFrontCamera = false;
    const MAX_W = 1500;
    const MAX_H = 1650;
    const RATIO = MAX_W / MAX_H;

    let camZoom = 1;
    let lastTouchDist = null;
    let isPinching = false;
    function setZoom(scale) {
      camZoom = Math.max(1, Math.min(scale, 6));
      video.style.transform = `scale(${camZoom})`;
    }

    video.addEventListener("touchstart", e => {
      if (e.touches.length === 2) {
        isPinching = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      }
    }, { passive: false });
    video.addEventListener("touchmove", e => {
      if (e.touches.length === 2 && lastTouchDist) {
        isPinching = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.sqrt(dx * dx + dy * dy);
        setZoom(camZoom * (newDist / lastTouchDist));
        lastTouchDist = newDist;
        e.preventDefault();
      }
    }, { passive: false });
    video.addEventListener("touchend", e => {
      if (e.touches.length < 2) {
        lastTouchDist = null;
        setTimeout(() => { isPinching = false; }, 50);
      }
    }, { passive: false });
    let lastTap = 0;
    video.addEventListener("touchend", e => {
      const now = Date.now();
      if (!isPinching && e.touches.length === 0 && now - lastTap < 300) {
        setZoom(1);
      }
      lastTap = now;
    });
    video.addEventListener("wheel", e => {
      if (e.ctrlKey) return;
      setZoom(camZoom + (e.deltaY < 0 ? 0.1 : -0.1));
      e.preventDefault();
    }, { passive: false });

    function startCamera() {
      if (videoStream) videoStream.getTracks().forEach(track => track.stop());
      navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: useFrontCamera ? "user" : "environment",
          width: { ideal: 1920 },
          height: { ideal: 2112 }
        }
      }).then(stream => {
        videoStream = stream;
        video.srcObject = stream;
      }).catch(err => {
        alert("Erreur d’accès à la caméra : " + err);
      });
    }

    switchBtn.onclick = () => {
      useFrontCamera = !useFrontCamera;
      startCamera();
    };

    // ... suite Bloc 4 pour la capture et preview (pas de coupure de logique, tout est prêt pour copier/coller)
    takeBtn.onclick = async () => {
      if (isPinching) return;
      const sourceW = video.videoWidth;
      const sourceH = video.videoHeight;
      const sourceRatio = sourceW / sourceH;

      let cropW, cropH;
      if (sourceRatio > RATIO) {
        cropH = sourceH / camZoom;
        cropW = cropH * RATIO;
      } else {
        cropW = sourceW / camZoom;
        cropH = cropW / RATIO;
      }
      const sx = (sourceW - cropW) / 2;
      const sy = (sourceH - cropH) / 2;

      let destW = Math.round(Math.min(cropW, MAX_W));
      let destH = Math.round(destW / RATIO);
      if (destH > cropH) {
        destH = Math.round(Math.min(cropH, MAX_H));
        destW = Math.round(destH * RATIO);
      }

      const canvas = document.createElement("canvas");
      canvas.width = destW;
      canvas.height = destH;
      const ctx = canvas.getContext("2d");

      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, destW, destH);

      video.style.display = "none";
      if (videoStream) videoStream.getTracks().forEach(track => track.stop());
      video.srcObject = null;

      const previewDiv = document.createElement("div");
      previewDiv.className = "camera-photo-preview";
      previewDiv.innerHTML = `
        <div class="camera-preview-content">
          <img src="${canvas.toDataURL('image/webp', 0.85)}" style="width:90%;max-width:380px;border-radius:14px;box-shadow:0 2px 18px #0007;"/>
          <div style="margin-top:18px;display:flex;gap:16px;justify-content:center;">
            <button class="camera-btn" id="validerPhoto" title="Valider">
              <img src="assets/icons/valider.svg" alt="Valider" width="38" height="38" />
            </button>
            <button class="camera-btn camera-btn-close" id="retakePhoto" title="Reprendre">
              <img src="assets/icons/croix.svg" alt="Reprendre" width="38" height="38" />
            </button>
          </div>
        </div>
      `;

      container.querySelector(".camera-video-zone").style.display = "none";
      container.appendChild(previewDiv);

      previewDiv.querySelector("#validerPhoto").onclick = async () => {
        const dataUrl = canvas.toDataURL("image/webp", 0.85);
        let result = null;
        try {
          // Mode duel
          if (mode === "duel") {
            if (!duelId) return alert("Erreur interne : duelId manquant.");
            if (!cadreId) cadreId = "polaroid_01";
            const urlPhoto = await window.uploadPhotoDuelWebp(dataUrl, duelId, defiId, cadreId);
            const userId = await window.getUserId();
            localStorage.setItem(`photo_duel_${duelId}_${userId}`, urlPhoto);
            await window.savePhotoDuel(defiId, urlPhoto, cadreId);
            const champ = (window.isPlayer1) ? 'photosa' : 'photosb';
            if (window.VFindDuelDB && window.currentRoomId) {
              await window.VFindDuelDB.set(`${duelId}_${champ}_${defiId}`, { url: urlPhoto, cadre: cadreId });
            }
            if (window.updateDuelUI) window.updateDuelUI();
            result = urlPhoto;
          }
          // Mode solo
          else if (mode === "solo") {
            const cadre = (await window.getCadreSelectionne?.()) || "polaroid_01";
            const obj = { photo: dataUrl, cadre };
            localStorage.setItem(`photo_defi_${defiId}`, JSON.stringify(obj));
            if (window.afficherPhotoDansCadreSolo) {
              window.afficherPhotoDansCadreSolo(defiId, dataUrl);
            }
            result = dataUrl;
          }
          // Mode concours
          else if (mode === "concours") {
            const userId = await window.getUserId();
            const urlPhoto = await window.uploadPhotoConcoursWebp(dataUrl, defiId, userId);
            result = urlPhoto;
          }

        } catch (err) {
          alert("Erreur upload : " + (err.message || err));
          result = null;
        }
        container.remove();
        resolve(result);
      };

      previewDiv.querySelector("#retakePhoto").onclick = () => {
        previewDiv.remove();
        video.style.display = "";
        container.querySelector(".camera-video-zone").style.display = "";
        startCamera();
      };
    };

    closeBtn.onclick = () => {
      if (videoStream) videoStream.getTracks().forEach(track => track.stop());
      container.remove();
      reject("fermé");
    };

    startCamera();
  });
};

// Alias rapide pour les autres usages globaux
window.cameraOuvrirCameraPourDuel = (idx, duelId, cadreId) => {
  window.ouvrirCameraPour(idx, "duel", duelId, cadreId);
};
window.cameraOuvrirCameraPourConcours = (concoursId) => {
  window.ouvrirCameraPour(concoursId, "concours");
};
