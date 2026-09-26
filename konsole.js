/* Aura · Overlay-Logik
 *
 * Hören    → eigene Aufnahme → Edge Function "sprache-hoeren" (ElevenLabs Scribe)
 * Denken   → Edge Function "aura" (Claude, mit Aufgaben und Freigaben)
 * Sprechen → Edge Function "sprache-stimme" (ElevenLabs, Sarah)
 *
 * Beide Functions verlangen die Anmeldung (anmeldung.js). Modell- und
 * Stimmschlüssel liegen ausschließlich in den Function-Secrets.
 */
(() => {
  "use strict";

  const anm = window.AuraAnmeldung;

  const orb     = AuraOrb(document.getElementById("orb"), {punkte: 1600, anteil: 0.36});
  const elWort  = document.getElementById("wort");
  const elZeile = document.getElementById("zeile");
  const elHoert = document.getElementById("gehoert");

  const tauri  = window.__TAURI__;
  const rufen  = tauri?.core?.invoke;
  const horchen = tauri?.event?.listen;
  // Nur die Mac-App kann Dateien auf dem Mac aufraeumen (src-tauri/src/dateien.rs).
  const FAEHIGKEITEN = rufen ? ["mac_dateien"] : [];

  /* Der Orb zeichnet nur bei sichtbarem Fenster. Beim Programmstart ist das
   * Overlay ausgeblendet, sein Webview laeuft aber schon – deshalb der Blick
   * auf isVisible() zusaetzlich zum Ereignis. */
  const fenster = tauri?.window?.getCurrentWindow?.();
  //
  // Dieselbe Meldung entscheidet, ob nach einer Antwort weiter zugehört wird.
  // document.hasFocus() taugt dafür nicht: Als Menüleisten-App (Accessory)
  // meldet macOS dem Fenster den Fokus nicht zuverlässig.
  let offen = !fenster;          // ohne Tauri (Browser-Test): immer offen
  function sichtbar(s){
    offen = !!s;
    if(offen) orb.weiter();
    else{ orb.anhalten(); beenden(); }   // verborgen: nicht weiter hören oder sprechen
  }
  fenster?.isVisible?.().then(sichtbar).catch(() => {});
  // Im Browser (iPad): Tab oder App im Hintergrund → Gespräch beenden.
  // orb.js hält bei verborgener Seite nur an; weiter geht es hier.
  if(!fenster) document.addEventListener("visibilitychange", () => {
    if(document.hidden) beenden();
    else orb.weiter();
  });
  horchen?.("aura://sichtbar", ev => sichtbar(ev.payload));

  function zustand(z){
    orb.zustand(z);
    elWort.textContent = orb.wort();
    rufen?.("zustand_melden", {zustand: z});
  }

  /* ---------- Gesprächslauf ----------
   * Jeder Abbruch (Escape, Taste, Klick daneben) zählt "lauf" hoch. Was danach
   * noch aus einem alten Lauf zurückkommt – Erkennung, Antwort, Ton –, wird
   * verworfen, statt in ein geschlossenes Fenster zu sprechen.
   */
  let lauf = 0;

  /* ---------- Sprachausgabe ----------
   * Ein Tonelement und ein AudioContext für alle Antworten. iPad und iPhone
   * spielen nur Ton ab, der einmal durch einen Fingertipp freigeschaltet
   * wurde – entsperren() tut das beim Tipp auf den Ball; danach darf dasselbe
   * Element auch Sekunden später ohne Tipp abspielen.
   */
  const STILLE = "data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";
  let klang = null, ac = null, tonAnalyse = null, tonPuffer = null, adresse = null;

  function tonBereit(){
    if(klang) return;
    klang = new Audio();
    klang.preload = "auto";
    try{
      ac = new (window.AudioContext || window.webkitAudioContext)();
      tonAnalyse = ac.createAnalyser();
      tonAnalyse.fftSize = 256;
      ac.createMediaElementSource(klang).connect(tonAnalyse);
      tonAnalyse.connect(ac.destination);
      tonPuffer = new Uint8Array(tonAnalyse.frequencyBinCount);
    }catch{ tonAnalyse = null; /* ohne Pegelmessung läuft die Eigenbewegung weiter */ }
  }

  // Nur aus einer Nutzergeste (Tipp, Klick) heraus aufrufen.
  function entsperren(){
    tonBereit();
    ac?.resume?.().catch(() => {});
    if(!klang.src){
      klang.src = STILLE;
      klang.play().then(() => klang.pause()).catch(() => {});
    }
  }

  async function sprechen(text, meiner){
    zustand("sprechen");
    try{
      const antwort = await anm.rufen("sprache-stimme", {text});
      const blob = await antwort.blob();
      if(meiner !== lauf) return;

      tonBereit();
      if(ac?.state === "suspended") await ac.resume().catch(() => {});
      klang.pause();
      if(adresse) URL.revokeObjectURL(adresse);
      adresse = URL.createObjectURL(blob);
      klang.src = adresse;

      // Gesprächsmodus: nach der Antwort gleich wieder zuhören.
      klang.onended = () => {
        orb.pegel(null);
        zustand("ruhe");
        if(meiner === lauf && offen) hoeren(true);
      };
      await klang.play();

      // Echte Lautstärke aus dem Ton holen, damit der Orb mitatmet
      if(tonAnalyse) (function lesen(){
        if(klang.paused || klang.ended) return;
        tonAnalyse.getByteFrequencyData(tonPuffer);
        let s = 0;
        for(let i = 0; i < tonPuffer.length; i++) s += tonPuffer[i];
        orb.pegel(Math.min(1, (s/tonPuffer.length/255)*3.0));
        requestAnimationFrame(lesen);
      })();
    }catch(e){
      console.error("Sprachausgabe:", e);
      orb.pegel(null);
      zustand("ruhe");
    }
  }

  /* ---------- Antwort ---------- */
  // Gesprächsverlauf nur im Speicher, solange die App läuft. Dauerhaft
  // gespeichert wird noch nichts (conversation_log folgt).
  const verlauf = [];

  async function antworten(frage){
    if(!frage) return;
    const meiner = lauf;
    zustand("denken");
    elZeile.textContent = "…";
    try{
      let ergebnis = await (await anm.rufen("aura", {
        aktion: "antwort", frage, verlauf: verlauf.slice(-12), faehigkeiten: FAEHIGKEITEN,
      })).json();
      // Will Aura etwas auf dem Mac tun, fuehrt die App es aus und gibt die
      // Ergebnisse zurueck, bis eine Antwort kommt.
      while(ergebnis.lokal){
        if(meiner !== lauf) return;
        elZeile.textContent = "Ich räume auf …";
        const ergebnisse = [];
        for(const a of ergebnis.lokal.aufrufe){
          try{
            ergebnisse.push({id: a.id, text: await rufen("mac_werkzeug", {name: a.name, eingabe: a.eingabe})});
          }catch(e){
            ergebnisse.push({id: a.id, text: String(e), fehler: true});
          }
        }
        ergebnis = await (await anm.rufen("aura", {aktion: "weiter", id: ergebnis.lokal.id, ergebnisse})).json();
      }
      const text = ergebnis.antwort;
      if(meiner !== lauf) return;
      verlauf.push({rolle: "du", text: frage}, {rolle: "aura", text});
      elZeile.textContent = text;
      await sprechen(text, meiner);
    }catch(e){
      if(meiner !== lauf) return;
      console.error("Antwort:", e);
      elZeile.textContent = e.status === 401 ? "Bitte melde dich an."
        : e.status === 403 ? "Diese Adresse ist für Aura nicht freigegeben."
        : `Das hat nicht geklappt: ${e.message}`;
      zustand("ruhe");
    }
  }

  /* ---------- Hören ----------
   * Die App nimmt selbst auf (MediaRecorder) und schickt die Aufnahme an die
   * Function "sprache-hoeren". Die Spracherkennung des Browsers bricht im
   * App-Fenster unter macOS sofort ab.
   * Ende der Frage: gut eine Sekunde Stille, nachdem gesprochen wurde.
   */
  // Sprechen = Lautstärke (RMS) deutlich über dem Grundrauschen des Raums.
  // Das Grundrauschen wird laufend nachgeführt, feste Schwellen passen nie.
  const UEBER_RAUSCHEN = 3.5;
  const MINDEST_RMS = 0.012;
  const STILLE_MS = 1300;       // so lange Stille beendet die Frage
  const WARTEN_MS = 8000;       // so lange wird auf den ersten Ton gewartet
  const LAENGSTENS_MS = 30000;
  const FORMATE = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg"];

  let aufnahme = null;          // {rec, strom, abbruch}

  // Alles anhalten: Aufnahme, Ton, laufende Anfragen.
  function beenden(){
    lauf++;
    aufnahmeBeenden(true);
    klang?.pause();
    orb.pegel(null);
    zustand("ruhe");
  }

  function aufnahmeBeenden(abbruch = false){
    if(!aufnahme) return;
    aufnahme.abbruch ||= abbruch;
    if(aufnahme.rec.state !== "inactive") aufnahme.rec.stop();
  }

  // weiter = true: automatisch nach einer Antwort, nicht per Taste.
  async function hoeren(weiter = false){
    if(!anm.angemeldet()){ ansicht(); return; }
    if(aufnahme) return;
    if(!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia){
      elZeile.textContent = "Aufnahme steht hier nicht bereit.";
      return;
    }

    let strom;
    try{
      strom = await navigator.mediaDevices.getUserMedia(
        {audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    }catch(e){
      elZeile.textContent = e.name === "NotAllowedError"
        ? "Kein Zugriff aufs Mikrofon – bitte in den Systemeinstellungen erlauben."
        : `Mikrofon nicht verfügbar (${e.name}).`;
      zustand("ruhe");
      return;
    }
    await orb.mikro(strom);

    // Eigene Messung für die Stille – der Pegel des Orbs ist für die Anzeige
    // geglättet und fällt in einem ruhigen Raum nie auf null.
    const messAc = new (window.AudioContext || window.webkitAudioContext)();
    if(messAc.state === "suspended") await messAc.resume().catch(() => {});
    const mess = messAc.createAnalyser();
    mess.fftSize = 1024;
    messAc.createMediaStreamSource(strom).connect(mess);
    const probe = new Float32Array(mess.fftSize);
    let boden = null;
    const lautstaerke = () => {
      mess.getFloatTimeDomainData(probe);
      let q = 0;
      for(let i = 0; i < probe.length; i++) q += probe[i]*probe[i];
      return Math.sqrt(q / probe.length);
    };

    const format = FORMATE.find(f => MediaRecorder.isTypeSupported?.(f));
    const rec = new MediaRecorder(strom, format ? {mimeType: format} : undefined);
    const teile = [];
    const eigene = {rec, strom, abbruch: false};
    aufnahme = eigene;

    const meiner = lauf;
    const beginn = performance.now();
    let gesprochen = false, stilleSeit = null;

    rec.ondataavailable = e => { if(e.data?.size) teile.push(e.data); };
    rec.onstop = async () => {
      strom.getTracks().forEach(t => t.stop());
      messAc.close().catch(() => {});
      orb.mikroAus();
      aufnahme = null;
      if(eigene.abbruch || meiner !== lauf){ zustand("ruhe"); return; }
      if(!gesprochen){
        elZeile.textContent = weiter ? "Ich bin da, wenn du noch etwas hast." : "Ich habe nichts gehört.";
        zustand("ruhe");
        return;
      }
      zustand("denken");
      elZeile.textContent = "…";
      try{
        const blob = new Blob(teile, {type: (rec.mimeType || format || "audio/mp4").split(";")[0]});
        const antwort = await anm.rufen("sprache-hoeren", blob);
        const {text} = await antwort.json();
        if(meiner !== lauf) return;
        if(!text){ elZeile.textContent = "Das habe ich nicht verstanden."; zustand("ruhe"); return; }
        elHoert.textContent = text;
        antworten(text);
      }catch(e){
        console.error("Hören:", e);
        elZeile.textContent = `Spracherkennung: ${e.message}`;
        zustand("ruhe");
      }
    };

    rec.start(250);
    zustand("hoeren");
    elHoert.textContent = "";
    elZeile.textContent = "Ich höre.";

    // Stille erkennen. setTimeout statt requestAnimationFrame: läuft auch,
    // wenn das Fenster gerade nicht gezeichnet wird.
    (function pruefen(){
      if(aufnahme !== eigene) return;
      const jetzt = performance.now();
      const rms = lautstaerke();
      // Grundrauschen: folgt Absenkungen sofort, Anstiegen nur langsam.
      boden = boden === null ? rms : Math.min(rms, boden * 1.01);
      const laut = rms > Math.max(MINDEST_RMS, boden * UEBER_RAUSCHEN);
      if(laut && jetzt - beginn > 250){ gesprochen = true; stilleSeit = null; }
      else if(gesprochen){
        stilleSeit ??= jetzt;
        if(jetzt - stilleSeit > STILLE_MS) return aufnahmeBeenden();
      }
      if(!gesprochen && jetzt - beginn > WARTEN_MS) return aufnahmeBeenden();
      if(jetzt - beginn > LAENGSTENS_MS) return aufnahmeBeenden();
      setTimeout(pruefen, 80);
    })();
  }

  /* ---------- Anmeldung ---------- */
  const form = document.getElementById("anmeldung");
  const elEmail = document.getElementById("email");
  const elPasswort = document.getElementById("passwort");
  const elLos = document.getElementById("los");
  const elMeldung = document.getElementById("meldung");

  function ansicht(){
    const drin = anm.angemeldet();
    document.body.classList.toggle("abgemeldet", !drin);
    if(!drin){
      elWort.textContent = "anmelden";
      setTimeout(() => (elEmail.value ? elPasswort : elEmail).focus(), 50);
    }else{
      elWort.textContent = orb.wort();
    }
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();
    elLos.disabled = true;
    elMeldung.textContent = "";
    try{
      await anm.anmelden(elEmail.value, elPasswort.value);
      elPasswort.value = "";
      ansicht();
      // Mac: gleich zuhören. Browser/iPad: auf den Tipp warten – erst der
      // schaltet dort den Ton frei.
      if(fenster) hoeren();
      else elZeile.textContent = "Tippe auf den Ball und sprich.";
    }catch(err){
      elMeldung.textContent = err.status === 400
        ? "E-Mail oder Passwort stimmen nicht."
        : `Anmeldung fehlgeschlagen: ${err.message}`;
    }finally{
      elLos.disabled = false;
    }
  });

  document.getElementById("abmelden").addEventListener("click", () => {
    beenden();
    verlauf.length = 0;
    anm.abmelden();
  });

  anm.beiAenderung(ansicht);

  /* ---------- Microsoft 365 verbinden ----------
   * Der Knopf erscheint, solange keine Verbindung besteht. Die Anmeldung bei
   * Microsoft läuft im Browser (Mac: Standardbrowser, iPad: gleiche Seite);
   * danach leitet "m365-verbinden" zurück auf die Aura-Webseite mit
   * ?m365=verbunden bzw. ?m365=fehler.
   */
  const elM365 = document.getElementById("m365");
  async function m365Stand(){
    if(!elM365 || !anm.angemeldet()) return;
    try{
      const {verbunden, rechte_fehlen} = await (await anm.rufen("m365-verbinden", {aktion: "status"})).json();
      elM365.hidden = !!verbunden;
      // Verbunden, aber noch ohne Schreibrechte: einmal neu verbinden.
      elM365.querySelector("button").textContent = rechte_fehlen ? "Microsoft neu verbinden" : "Microsoft verbinden";
    }catch{ elM365.hidden = true; }
  }
  elM365?.addEventListener("click", async () => {
    try{
      const {url} = await (await anm.rufen("m365-verbinden", {aktion: "start"})).json();
      const oeffnen = window.__TAURI__?.opener?.openUrl;
      if(oeffnen){
        await oeffnen(url);
        elZeile.textContent = "Melde dich im Browser bei Microsoft an und komm dann zurück.";
      }else{
        location.href = url;
      }
    }catch(e){
      elZeile.textContent = `Microsoft verbinden: ${e.message}`;
    }
  });
  // Rückkehr von Microsoft (nur Webseite)
  const rueck = new URLSearchParams(location.search);
  if(rueck.has("m365")){
    elZeile.textContent = rueck.get("m365") === "verbunden"
      ? "Microsoft 365 ist verbunden. Frag mich nach Mails, Terminen oder Dateien."
      : `Microsoft-Verbindung fehlgeschlagen: ${rueck.get("grund") ?? "unbekannt"}`;
    history.replaceState(null, "", location.pathname);
  }
  anm.beiAenderung(m365Stand);
  m365Stand();

  /* ---------- Fenster ---------- */
  // Klick daneben verbirgt das Overlay (lib.rs). Verborgen wird nicht
  // weiter zugehört.
  // Klick daneben: lib.rs verbirgt das Fenster und meldet "aura://sichtbar"
  // = false; sichtbar() beendet dann Aufnahme und Ton.

  // Verschieben: -webkit-app-region gibt es nur in Electron. In Tauri zieht
  // startDragging() das Fenster, solange nicht auf ein Bedienelement geklickt wird.
  document.addEventListener("mousedown", e => {
    if(e.button !== 0 || e.target.closest("input, button, a, textarea")) return;
    window.__TAURI__?.window?.getCurrentWindow?.().startDragging().catch(() => {});
  });

  document.addEventListener("keydown", e => {
    if(e.key === "Escape"){
      beenden();
      rufen?.("overlay_schliessen");
    }
  });

  // ⌥ Leertaste bei offenem Fenster: in Ruhe → zuhören, sonst abbrechen und schließen.
  function taste(){
    if(orb.jetzt() === "ruhe" && !aufnahme) hoeren();
    else{ beenden(); rufen?.("overlay_schliessen"); }
  }
  horchen?.("aura://taste", taste);

  // Tipp auf den Ball (iPad, Browser): wie ⌥ Leertaste – und schaltet den
  // Ton frei, den Safari sonst verweigert.
  document.getElementById("orb").addEventListener("click", () => {
    if(!anm.angemeldet()) return;
    entsperren();
    taste();
  });

  // Rust meldet den Zustand, wenn das Fenster per Kürzel aufgeht
  horchen?.("aura://zustand", ev => {
    if(ev.payload === "hoeren") hoeren();
    else zustand(ev.payload);
  });

  zustand("ruhe");
  ansicht();
})();
