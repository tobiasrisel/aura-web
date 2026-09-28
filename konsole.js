/* Aura · Overlay-Logik
 *
 * Hören    → eigene Aufnahme → Edge Function "sprache-hoeren" (ElevenLabs Scribe)
 * Denken   → Edge Function "aura" (Claude, mit Aufgaben und Freigaben)
 * Sprechen → Edge Function "sprache-stimme" (ElevenLabs, Sarah)
 * Partikelmodus → "Partikelmodus an" / "Partikelmodus aus"; dazwischen wird
 *   jeder Satz zu Wort, Figur oder Animation statt zu einer Frage an Aura.
 *
 * Beide Functions verlangen die Anmeldung (anmeldung.js). Modell- und
 * Stimmschlüssel liegen ausschließlich in den Function-Secrets.
 */
(() => {
  "use strict";

  const anm = window.AuraAnmeldung;

  // Der Orb zeichnet auf der ganzen Fläche, sitzt aber auf #orbplatz.
  const elPlatz = document.getElementById("orbplatz");
  const orb     = AuraOrb(document.getElementById("orb"), {
    anker: elPlatz,
    punkte: matchMedia("(pointer: coarse)").matches ? 6000 : 9000,
  });
  const elWort  = document.getElementById("wort");
  const elZeile = document.getElementById("zeile");
  const elHoert = document.getElementById("gehoert");
  const elProtokoll = document.getElementById("protokoll");

  // Mitschrift (nur Web-Fassung, rechts): neue Zeilen unten. Wer gerade
  // nach oben gescrollt hat, wird nicht nach unten gerissen.
  function mitschreiben(rolle, text){
    if(!elProtokoll || !text) return;
    const unten = elProtokoll.scrollHeight - elProtokoll.scrollTop - elProtokoll.clientHeight < 40;
    const eintrag = document.createElement("div");
    eintrag.className = rolle;
    const wer = document.createElement("span");
    wer.className = "wer";
    wer.textContent = rolle === "du" ? "Du" : "Aura";
    eintrag.append(wer, text);
    elProtokoll.append(eintrag);
    while(elProtokoll.children.length > 200) elProtokoll.firstElementChild.remove();
    if(unten) elProtokoll.scrollTop = elProtokoll.scrollHeight;
  }
  // Antworten stehen auf breiten Fenstern nur rechts; mittig bleiben Hinweise.
  const zeigen = (text, antwort = false) => {
    elZeile.textContent = text;
    elZeile.classList.toggle("antwort", antwort && !!elProtokoll);
  };

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
  // Im Browser: Tab oder Fenster im Hintergrund → das Gespräch läuft weiter
  // (Wunsch Tobias, 28.09.). orb.js hält nur das Zeichnen an; weiter geht es hier.
  if(!fenster) document.addEventListener("visibilitychange", () => {
    if(!document.hidden) orb.weiter();
  });
  horchen?.("aura://sichtbar", ev => sichtbar(ev.payload));

  function zustand(z){
    orb.zustand(z);
    elWort.textContent = orb.wort();
    rufen?.("zustand_melden", {zustand: z});
  }

  /* ---------- Partikelmodus ----------
   * Gilt ein erkannter Satz dem Partikelmodus, geht er nicht an Aura. Im
   * Modus wird weiter zugehört, bis er endet oder das Fenster zugeht.
   */
  function partikel(satz){
    const befehl = AuraOrb.deuten(satz, orb.imPartikelmodus());
    if(!befehl) return false;
    const rueck = orb.befolgen(befehl);
    document.body.classList.toggle("partikel", orb.imPartikelmodus());
    if(rueck) zeigen(rueck);
    rufen?.("partikel_melden", {befehl: JSON.stringify(befehl)});
    zustand("ruhe");
    return true;
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
    zeigen("…");
    try{
      let ergebnis = await (await anm.rufen("aura", {
        aktion: "antwort", frage, verlauf: verlauf.slice(-12), faehigkeiten: FAEHIGKEITEN,
      })).json();
      // Will Aura etwas auf dem Mac tun, fuehrt die App es aus und gibt die
      // Ergebnisse zurueck, bis eine Antwort kommt.
      while(ergebnis.lokal){
        if(meiner !== lauf) return;
        zeigen("Ich räume auf …");
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
      freigabenLaden();
      if(meiner !== lauf) return;
      verlauf.push({rolle: "du", text: frage}, {rolle: "aura", text});
      zeigen(text, true);
      mitschreiben("aura", text);
      await sprechen(text, meiner);
    }catch(e){
      if(meiner !== lauf) return;
      console.error("Antwort:", e);
      zeigen(e.status === 401 ? "Bitte melde dich an."
        : e.status === 403 ? "Diese Adresse ist für Aura nicht freigegeben."
        : `Das hat nicht geklappt: ${e.message}`);
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
      zeigen("Aufnahme steht hier nicht bereit.");
      return;
    }

    let strom;
    try{
      strom = await navigator.mediaDevices.getUserMedia(
        {audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
    }catch(e){
      zeigen(e.name === "NotAllowedError"
        ? "Kein Zugriff aufs Mikrofon – bitte in den Systemeinstellungen erlauben."
        : `Mikrofon nicht verfügbar (${e.name}).`);
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
        if(orb.imPartikelmodus() && offen){ hoeren(true); return; }
        zeigen(weiter ? "Ich bin da, wenn du noch etwas hast." : "Ich habe nichts gehört.");
        zustand("ruhe");
        return;
      }
      zustand("denken");
      zeigen("…");
      try{
        const blob = new Blob(teile, {type: (rec.mimeType || format || "audio/mp4").split(";")[0]});
        const antwort = await anm.rufen("sprache-hoeren", blob);
        const {text} = await antwort.json();
        if(meiner !== lauf) return;
        if(!text){ zeigen("Das habe ich nicht verstanden."); zustand("ruhe"); return; }
        elHoert.textContent = text;
        mitschreiben("du", text);
        if(partikel(text)){
          if(orb.imPartikelmodus() && offen && meiner === lauf) hoeren(true);
          return;
        }
        if(orb.imPartikelmodus()){ zeigen("Das habe ich nicht verstanden."); hoeren(true); return; }
        antworten(text);
      }catch(e){
        console.error("Hören:", e);
        zeigen(`Spracherkennung: ${e.message}`);
        zustand("ruhe");
      }
    };

    rec.start(250);
    zustand("hoeren");
    elHoert.textContent = "";
    zeigen("Ich höre.");

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

  // In der Mac-App nicht: Microsoft leitet zurück auf die Webseite, die App
  // zeigt aber ihre mitgebrachte Seite. Dort meldet sich Tobias mit Passwort an.
  if(rufen){
    document.getElementById("microsoft")?.remove();
    document.querySelector(".oder")?.remove();
  }
  // Anmeldung mit Microsoft: hin zu Microsoft, zurück mit #anmeldung=…
  document.getElementById("microsoft")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    elMeldung.textContent = "";
    try{ await anm.mitMicrosoft(); }
    catch(err){ elMeldung.textContent = `Anmeldung mit Microsoft: ${err.message}`; }
  });
  if(location.hash.startsWith("#anmeldung=")){
    const schluessel = decodeURIComponent(location.hash.slice("#anmeldung=".length));
    history.replaceState(null, "", location.pathname);
    anm.einloesen(schluessel)
      .then(() => { ansicht(); zeigen("Angemeldet. Tippe auf den Ball und sprich."); })
      .catch((err) => { elMeldung.textContent = `Anmeldung fehlgeschlagen: ${err.message}`; });
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
      else zeigen("Tippe auf den Ball und sprich.");
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
    elProtokoll?.replaceChildren();
    anm.abmelden();
  });

  anm.beiAenderung(ansicht);

  /* ---------- Microsoft 365 verbinden ----------
   * Der Knopf erscheint, solange keine Verbindung besteht. In der Mac-App
   * läuft die Anmeldung in einem eigenen Fenster der App (lib.rs,
   * anmeldung_oeffnen), das sich danach selbst schließt und
   * "aura://angemeldet" meldet – kein Browser, keine Webseite. Im Browser
   * (iPad) läuft sie auf derselben Seite; danach leitet die Function zurück
   * mit ?m365=verbunden bzw. ?m365=fehler.
   */
  async function anmeldungOeffnen(url, name){
    if(rufen){
      await rufen("anmeldung_oeffnen", {url});
      zeigen(`Melde dich im Fenster bei ${name} an.`);
    }else{
      location.href = url;
    }
  }
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
      const {url, fehler} = await (await anm.rufen("m365-verbinden", {aktion: "start", app: !!rufen})).json();
      if(!url) throw new Error(fehler);
      await anmeldungOeffnen(url, "Microsoft");
    }catch(e){
      zeigen(`Microsoft verbinden: ${e.message}`);
    }
  });
  // Rückkehr von Microsoft (nur Webseite)
  const rueck = new URLSearchParams(location.search);
  if(rueck.has("m365")){
    zeigen(rueck.get("m365") === "verbunden"
      ? "Microsoft 365 ist verbunden. Frag mich nach Mails, Terminen oder Dateien."
      : `Microsoft-Verbindung fehlgeschlagen: ${rueck.get("grund") ?? "unbekannt"}`);
    // Abgemeldet (Anmeldung mit Microsoft gescheitert): Grund am Formular zeigen
    if(!anm.angemeldet() && rueck.get("m365") !== "verbunden") elMeldung.textContent = elZeile.textContent;
    history.replaceState(null, "", location.pathname);
  }
  anm.beiAenderung(m365Stand);
  m365Stand();

  /* ---------- Tafel: Freigaben und Konten ----------
   * Freigaben (Aura-Vertrag § 5): Tobias entscheidet per Knopf; ausgeführt
   * wird serverseitig genau der angezeigte Entwurf. Konten: LinkedIn und
   * Meta verbinden (Function "konten-verbinden").
   */
  const elTafel = document.getElementById("tafel");
  const elTafelInhalt = document.getElementById("tafel-inhalt");
  const elFreigabenKnopf = document.getElementById("freigaben-knopf");
  const text = (t) => document.createTextNode(String(t ?? ""));
  function knopf(beschriftung, bei, klasse){
    const b = document.createElement("button");
    b.type = "button"; b.textContent = beschriftung;
    if(klasse) b.className = klasse;
    b.addEventListener("click", (e) => { e.stopPropagation(); bei(b); });
    return b;
  }
  function tafelZeigen(titel){
    elTafelInhalt.replaceChildren();
    const h = document.createElement("h2"); h.textContent = titel;
    elTafelInhalt.append(h);
    elTafel.hidden = false;
  }
  document.getElementById("tafel-zu")?.addEventListener("click", (e) => { e.stopPropagation(); elTafel.hidden = true; });
  elTafel?.addEventListener("mousedown", (e) => e.stopPropagation());
  elTafel?.addEventListener("click", (e) => e.stopPropagation());

  let offeneFreigaben = [];
  async function freigabenLaden(){
    if(!elFreigabenKnopf || !anm.angemeldet()) return;
    try{
      const {freigaben} = await (await anm.rufen("aura", {aktion: "freigaben"})).json();
      offeneFreigaben = freigaben ?? [];
      elFreigabenKnopf.hidden = !offeneFreigaben.length;
      elFreigabenKnopf.querySelector("button").textContent = `Freigaben (${offeneFreigaben.length})`;
      if(!elTafel.hidden && elTafel.dataset.art === "freigaben") freigabenZeigen();
    }catch{ /* still */ }
  }
  function freigabenZeigen(){
    elTafel.dataset.art = "freigaben";
    tafelZeigen("Freigaben");
    if(!offeneFreigaben.length){ elTafelInhalt.append(text("Nichts offen.")); return; }
    for(const f of offeneFreigaben){
      const p = document.createElement("div"); p.className = "posten";
      const was = document.createElement("div"); was.className = "was"; was.textContent = f.wirkung;
      const wann = document.createElement("div"); wann.className = "wann";
      wann.textContent = `${f.angefragt}${f.begruendung ? " · " + f.begruendung : ""}`;
      const pre = document.createElement("pre");
      const n = f.nutzlast ?? {};
      const kopf = [
        n.an?.length ? `An: ${[].concat(n.an).join(", ")}` : "",
        n.cc?.length ? `Cc: ${n.cc.join(", ")}` : "",
        n.betreff ? `Betreff: ${n.betreff}` : "",
        n.zeit ? `Zeit: ${String(n.zeit).replace("T", " ")}` : "",
        n.bild_url ? `Bild: ${n.bild_url}` : "",
        n.anhang_namen?.length ? `Anhänge: ${n.anhang_namen.join(", ")}` : "",
        n.link ? `Link: ${n.link}` : "",
      ].filter(Boolean).join("\n");
      const rumpf = n.text ?? n.titel ?? f.entwurf ?? "";
      pre.textContent = kopf ? `${kopf}\n\n${rumpf}` : rumpf;
      const fehler = document.createElement("div"); fehler.className = "fehler";
      if(f.fehler) fehler.textContent = `Letzter Versuch: ${f.fehler}`;
      const k = document.createElement("div"); k.className = "knoepfe";
      const entscheiden = async (entscheidung, b) => {
        k.querySelectorAll("button").forEach((x) => x.disabled = true);
        b.textContent = "…";
        try{
          const r = await anm.rufen("aura", {aktion: "entscheiden", id: f.id, entscheidung});
          const d = await r.json();
          if(!r.ok) throw new Error(d.fehler ?? r.status);
          zeigen(entscheidung === "freigeben" ? `Erledigt: ${f.wirkung}.` : "Abgelehnt.");
        }catch(e){
          fehler.textContent = String(e.message ?? e);
        }
        await freigabenLaden();
        if(!offeneFreigaben.length) elTafel.hidden = true;
      };
      k.append(knopf("Freigeben", (b) => entscheiden("freigeben", b)),
               knopf("Ablehnen", (b) => entscheiden("ablehnen", b), "ablehnen"));
      p.append(was, wann, pre, fehler, k);
      elTafelInhalt.append(p);
    }
  }
  elFreigabenKnopf?.addEventListener("click", (e) => { e.stopPropagation(); freigabenZeigen(); });

  async function kontenZeigen(){
    elTafel.dataset.art = "konten";
    tafelZeigen("Konten");
    let stand = {};
    try{ stand = await (await anm.rufen("konten-verbinden", {aktion: "status"})).json(); }catch{ /* leer */ }
    for(const [anbieter, name] of [["linkedin", "LinkedIn"], ["meta", "Facebook-Seiten und Instagram"]]){
      const s = stand[anbieter] ?? {};
      const p = document.createElement("div"); p.className = "posten";
      const was = document.createElement("div"); was.className = "was"; was.textContent = name;
      const wann = document.createElement("div"); wann.className = "wann";
      wann.textContent = !s.eingerichtet ? "Noch nicht eingerichtet (App-Schlüssel fehlen)."
        : s.verbunden ? `Verbunden${s.konto ? " als " + s.konto : ""}${s.laeuft_ab ? " · bis " + new Date(s.laeuft_ab).toLocaleDateString("de-DE") : ""}`
        : "Nicht verbunden.";
      const k = document.createElement("div"); k.className = "knoepfe";
      if(s.eingerichtet){
        k.append(knopf(s.verbunden ? "Neu verbinden" : "Verbinden", async (b) => {
          b.disabled = true;
          try{
            const {url, fehler} = await (await anm.rufen("konten-verbinden", {aktion: "start", anbieter, app: !!rufen})).json();
            if(!url) throw new Error(fehler);
            await anmeldungOeffnen(url, name);
          }catch(e){ wann.textContent = String(e.message ?? e); b.disabled = false; }
        }));
      }
      p.append(was, wann, k);
      elTafelInhalt.append(p);
    }
    const hinweis = document.createElement("div"); hinweis.className = "wann";
    hinweis.textContent = "Öffentliche Beiträge gehen immer erst hier zur Freigabe (Aura-Vertrag § 3.4).";
    elTafelInhalt.append(hinweis);
  }
  document.getElementById("konten-knopf")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if(ich?.rolle === "kollege") meineFreigabenZeigen(); else kontenZeigen();
  });

  /* ---------- Wer ist angemeldet ----------
   * Kollegen sehen statt „Konten“ (Tobias' persönliche Konten) ihre eigenen
   * Einstellungen: was Aura für sie tun und was sie über sie auswerten darf.
   * Das entscheidet jeder nur für sich; der Server nimmt es nur von ihm an.
   */
  let ich = null;
  async function ichLaden(){
    if(!anm.angemeldet()){ ich = null; document.body.classList.remove("kollege"); return; }
    try{ ich = await (await anm.rufen("aura", {aktion: "ich"})).json(); }catch{ return; }
    document.body.classList.toggle("kollege", ich.rolle === "kollege");
    const k = document.getElementById("konten-knopf");
    if(k) k.textContent = ich.rolle === "kollege" ? "Meine Freigaben" : "Konten";
  }
  function meineFreigabenZeigen(){
    elTafel.dataset.art = "ich";
    tafelZeigen("Meine Freigaben");
    const vorname = String(ich?.name ?? "").split(" ")[0];
    const einleitung = document.createElement("div"); einleitung.className = "wann";
    einleitung.textContent = `Hallo ${vorname}. Aura liest über dein eigenes Microsoft-Konto – nur, was dir in M365 freigegeben ist. `
      + "Deine Gespräche werden nicht gespeichert. Was darüber hinaus gilt, entscheidest nur du:";
    elTafelInhalt.append(einleitung);
    const meldung = document.createElement("div"); meldung.className = "wann";
    for(const [feld, titel, erklaerung] of [
      ["handeln", "Aura darf für mich handeln",
        "Mails, Teams-Nachrichten und Erinnerungen über dein Konto vorbereiten. Mails gehen immer erst hier zur Freigabe; Teams und Erinnerungen nur, wenn du es im Gespräch ausdrücklich sagst."],
      ["muster_erlaubt", "Meine Mails an Tobias dürfen ausgewertet werden",
        "Tobias' Aura wertet eingehende Mails nach Kommunikationsmustern aus. Ausgeschaltet bleiben deine Mails dabei außen vor, und frühere Befunde über dich sind ausgeblendet."],
    ]){
      const l = document.createElement("label"); l.className = "schalter";
      const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!ich?.[feld];
      const t = document.createElement("div");
      const w = document.createElement("div"); w.className = "was"; w.textContent = titel;
      const e = document.createElement("div"); e.className = "wann"; e.textContent = erklaerung;
      t.append(w, e); l.append(c, t);
      c.addEventListener("change", async () => {
        c.disabled = true;
        try{
          const r = await anm.rufen("aura", {aktion: "einstellungen", [feld]: c.checked});
          Object.assign(ich, await r.json());
          meldung.textContent = "Gespeichert.";
        }catch(err){
          c.checked = !c.checked;
          meldung.textContent = `Nicht gespeichert: ${err.message}`;
        }
        c.disabled = false;
      });
      elTafelInhalt.append(l);
    }
    elTafelInhalt.append(meldung);
  }
  anm.beiAenderung(ichLaden);
  ichLaden();

  // Rückkehr von LinkedIn/Meta (nur Webseite)
  if(rueck.has("konto")){
    const name = rueck.get("konto") === "meta" ? "Facebook/Instagram" : "LinkedIn";
    zeigen(rueck.get("ergebnis") === "verbunden"
      ? `${name} ist verbunden.` : `${name}-Verbindung fehlgeschlagen: ${rueck.get("grund") ?? "unbekannt"}`);
    history.replaceState(null, "", location.pathname);
  }
  // Mac-App: Anmeldefenster geschlossen → Stand neu holen.
  horchen?.("aura://angemeldet", async () => {
    await m365Stand();
    if(!elTafel.hidden && elTafel.dataset.art === "konten") kontenZeigen();
    zeigen("Anmeldung beendet – der Stand ist aktualisiert.");
  });
  anm.beiAenderung(freigabenLaden);
  freigabenLaden();
  setInterval(() => { if(!document.hidden) freigabenLaden(); }, 60000);

  /* ---------- Fenster ---------- */
  // Klick daneben verbirgt das Overlay (lib.rs). Verborgen wird nicht
  // weiter zugehört.
  // Klick daneben: lib.rs verbirgt das Fenster und meldet "aura://sichtbar"
  // = false; sichtbar() beendet dann Aufnahme und Ton.

  // Das Overlay ist bildschirmweit (lib.rs). Ein Klick neben das Bedienfeld
  // schließt es – wie früher der Klick neben das kleine Fenster.
  document.addEventListener("mousedown", e => {
    if(!fenster || !document.getElementById("rahmen") || e.button !== 0 || e.target.closest("#rahmen, #tafel")) return;
    beenden();
    rufen?.("overlay_schliessen");
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

  // Klick auf die kleine Kugel (Mac-App): zuhören oder beenden, das Fenster
  // bleibt, wo es ist.
  horchen?.("aura://kugel", () => {
    if(orb.jetzt() === "ruhe" && !aufnahme) hoeren();
    else beenden();
  });

  // Tipp auf den Ball (iPad, Browser): wie ⌥ Leertaste – und schaltet den
  // Ton frei, den Safari sonst verweigert.
  (elPlatz || document.getElementById("orb")).addEventListener("click", () => {
    if(!anm.angemeldet()) return;
    entsperren();
    taste();
  });

  // Rust meldet den Zustand, wenn das Fenster per Kürzel aufgeht
  horchen?.("aura://zustand", ev => {
    if(ev.payload === "hoeren") hoeren();
    else zustand(ev.payload);
  });

  // Zum Ausprobieren ohne Mikrofon, in den Entwicklerwerkzeugen:
  //   aura.sage("Partikelmodus an");  aura.sage("zeig ein Herz");
  window.aura = {sage: t => partikel(t) || antworten(t), figuren: AuraOrb.figuren};

  zustand("ruhe");
  ansicht();
  // Hinweis der App beim Start (etwa: ⌥ Leertaste gehört einer anderen App).
  rufen?.("hinweis_abholen").then(h => { if(h) zeigen(h); }).catch(() => {});
})();
