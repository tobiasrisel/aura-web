/* Aura · Orb
 *
 * Volumetrische Punktwolke auf einer Kugel. Zustand steuert Farbe, Drehzahl,
 * Streuung und Wellen. Mikrofonpegel treibt "hoeren", die Sprachausgabe "sprechen".
 *
 * Aufruf:  const orb = AuraOrb(canvasElement);
 *          orb.zustand("denken");  orb.mikro(strom);  orb.mikroAus();  orb.pegel(0.8);
 */
window.AuraOrb = function (cv, optionen) {
  // Kein Vorgabewert in der Parameterliste: zusammen mit "use strict" ist das
  // ein Syntaxfehler, und die ganze Datei lüde nicht.
  "use strict";
  optionen = optionen || {};

  const Z = {
    ruhe:     {wort:"bereit",              farbe:[ 78,107,128], dreh:0.10, streu:0.06, grund:0.05},
    hoeren:   {wort:"hört zu",             farbe:[ 56,207,226], dreh:0.16, streu:0.10, grund:0.10},
    denken:   {wort:"denkt nach",          farbe:[123,107,242], dreh:0.52, streu:0.62, grund:0.30},
    sprechen: {wort:"spricht",             farbe:[242,168, 92], dreh:0.22, streu:0.16, grund:0.22},
    freigabe: {wort:"wartet auf freigabe", farbe:[232,103, 76], dreh:0.07, streu:0.05, grund:0.09}
  };

  const ctx = cv.getContext("2d", {alpha:true});
  const sparsam = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const N = optionen.punkte || 1400;
  const anteil = optionen.anteil || 0.30;   // Radius im Verhältnis zur Kantenlänge

  let zustand = "ruhe";
  let farbe = Z.ruhe.farbe.slice();
  let dreh = Z.ruhe.dreh, streu = Z.ruhe.streu;
  let pegel = 0, zielPegel = 0, extern = null;
  let winkel = 0, zeit = 0, seite = 440, dpr = 1;
  let laeuft = false, bildNr = 0;
  const wellen = [];

  /* Fibonacci-Verteilung auf der Kugel */
  const punkte = new Array(N);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i/(N-1))*2;
    const r = Math.sqrt(Math.max(0, 1-y*y));
    const t = i * Math.PI * (3 - Math.sqrt(5));
    punkte[i] = {
      x: Math.cos(t)*r, y, z: Math.sin(t)*r,
      p1: Math.random()*Math.PI*2,
      p2: Math.random()*Math.PI*2,
      f:  0.6 + Math.random()*1.5
    };
  }

  const NEIGUNG = -0.38;
  const sinN = Math.sin(NEIGUNG), cosN = Math.cos(NEIGUNG);

  function masse(){
    dpr = Math.min(devicePixelRatio || 1, 2);
    const w = cv.clientWidth || 440;
    seite = w;
    cv.width  = Math.round(w*dpr);
    cv.height = Math.round(w*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  masse();
  addEventListener("resize", masse);
  if (window.ResizeObserver) new ResizeObserver(masse).observe(cv);

  function bild(){
    const w = seite, m = w/2, R = w*anteil;
    ctx.clearRect(0,0,w,w);
    const [cr,cg,cb] = farbe.map(Math.round);
    const auf = pegel;

    const kern = ctx.createRadialGradient(m,m,0, m,m, R*(1.05+auf*0.5));
    kern.addColorStop(0,    `rgba(${cr},${cg},${cb},${0.30+auf*0.42})`);
    kern.addColorStop(0.42, `rgba(${cr},${cg},${cb},${0.10+auf*0.16})`);
    kern.addColorStop(1,    `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = kern;
    ctx.beginPath(); ctx.arc(m,m,R*1.9,0,Math.PI*2); ctx.fill();

    // Wellen laufen hoechstens bis zum Rand der Flaeche aus, sonst schnitte
    // die Kante sie bei grossem Anteil sichtbar ab.
    const weit = Math.max(R*0.2, Math.min(R*1.75, m - R*0.55));
    for (let i = wellen.length-1; i >= 0; i--) {
      const wl = wellen[i];
      wl.r += 0.9;
      const a = Math.max(0, 1 - wl.r/weit) * wl.kraft;
      if (a <= 0.01) { wellen.splice(i,1); continue; }
      ctx.beginPath();
      ctx.arc(m,m,R*0.55 + wl.r,0,Math.PI*2);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a*0.30})`;
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    const sinW = Math.sin(winkel), cosW = Math.cos(winkel);
    for (let i = 0; i < N; i++) {
      const p = punkte[i];
      const turb = Math.sin(zeit*p.f + p.p1) * Math.cos(zeit*0.7 + p.p2);
      const aus  = 1 + (0.045 + auf*0.30) * turb + auf*0.10;

      const x  = (p.x*cosW - p.z*sinW) * aus;
      const z  = (p.x*sinW + p.z*cosW) * aus;
      const y  = p.y * aus;
      const y2 = y*cosN - z*sinN;
      const z2 = y*sinN + z*cosN;

      const tiefe = (z2 + 1.9) / 2.9;
      const per   = 1 / (2.1 - z2*0.55);
      const al = Math.max(0, (tiefe-0.26)) * (0.62 + auf*0.42);
      if (al <= 0.01) continue;

      ctx.beginPath();
      ctx.arc(m + x*R*per*1.55, m + y2*R*per*1.55,
              Math.max(0.35, tiefe*1.55 + auf*0.9), 0, Math.PI*2);
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(0.95, al)})`;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(m, m, R*1.02*(1+auf*0.07), 0, Math.PI*2);
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.13+auf*0.20})`;
    ctx.lineWidth = 0.9;
    ctx.stroke();
  }

  function takt(){
    if (!laeuft) return;
    const z = Z[zustand];
    for (let i = 0; i < 3; i++) farbe[i] += (z.farbe[i] - farbe[i]) * 0.07;
    document.documentElement.style.setProperty(
      "--akt", `rgb(${farbe.map(v=>Math.round(v)).join(",")})`);

    dreh  += (z.dreh  - dreh ) * 0.05;
    streu += (z.streu - streu) * 0.05;

    if (extern !== null) {
      zielPegel = extern;
    } else if (zustand !== "hoeren") {
      const atem = Math.sin(zeit*0.9)*0.5 + 0.5;
      const unruhe = zustand === "denken" ? (Math.sin(zeit*4.1)*0.5+0.5)*0.35 : 0;
      zielPegel = z.grund + atem*streu + unruhe;
    }
    pegel += (zielPegel - pegel) * (zustand === "hoeren" ? 0.30 : 0.10);

    if (zustand === "sprechen" && Math.random() < 0.035) {
      wellen.push({r:0, kraft:0.6 + Math.random()*0.5});
    }

    const dt = sparsam ? 0.004 : 0.016;
    zeit += dt;
    winkel += dreh * dt;
    bild();
    bildNr = requestAnimationFrame(takt);
  }

  /* Die Schleife lief bisher bedingungslos weiter – auch im ausgeblendeten
   * Overlay und in der Wand ohne Nebenmonitor. Jedes Bild zeichnet N Punkte
   * einzeln, das kostete je Fenster dauerhaft einen Kern und belastete den
   * WindowServer. Sichtbarkeit meldet das Programm über "aura://sichtbar",
   * weil document.hidden in einem per window.hide() ausgeblendeten
   * WKWebView-Fenster nicht zuverlaessig umschaltet.
   */
  function weiter(){
    if (laeuft) return;
    laeuft = true;
    bildNr = requestAnimationFrame(takt);
  }

  function anhalten(){
    if (!laeuft) return;
    laeuft = false;
    cancelAnimationFrame(bildNr);
  }

  // Nur anhalten, nie von hier aus fortsetzen: schaltet document.hidden doch
  // um, deckt sich das mit der Meldung des Programms; bleibt es stehen,
  // widerspricht es ihr auch nicht.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) anhalten();
  });

  weiter();

  /* Mikrofon
   * Nur offen, solange zugehört wird. Bliebe der Strom stehen, zeigte macOS
   * dauerhaft den Mikrofonpunkt in der Menüleiste. */
  let analyse = null, puffer = null, strom = null, mikroAc = null;
  // Ein uebergebener Strom (von der Aufnahme) wird mitbenutzt statt ein
  // zweites Mal nach dem Mikrofon zu fragen.
  async function mikro(vorhanden){
    if (analyse) return true;
    try {
      strom = vorhanden || await navigator.mediaDevices.getUserMedia({audio:true});
      mikroAc = new (window.AudioContext || window.webkitAudioContext)();
      if (mikroAc.state === "suspended") await mikroAc.resume();
      mikroAc.createMediaStreamSource(strom).connect(analyse = mikroAc.createAnalyser());
      analyse.fftSize = 512;
      analyse.smoothingTimeConstant = 0.72;
      puffer = new Uint8Array(analyse.frequencyBinCount);
      (function lesen(){
        if (!analyse) return;
        analyse.getByteFrequencyData(puffer);
        let s = 0;
        for (let i = 0; i < puffer.length; i++) s += puffer[i];
        if (zustand === "hoeren") zielPegel = Math.min(1, (s/puffer.length/255)*3.4);
        requestAnimationFrame(lesen);
      })();
      return true;
    } catch { mikroAus(); return false; }
  }

  function mikroAus(){
    strom?.getTracks().forEach(t => t.stop());
    mikroAc?.close().catch(() => {});
    strom = mikroAc = analyse = puffer = null;
  }

  return {
    zustand(neu){
      if (!Z[neu] || neu === zustand) return zustand;
      zustand = neu;
      if (neu === "sprechen") wellen.length = 0;
      if (neu !== "sprechen") extern = null;
      return zustand;
    },
    wort(){ return Z[zustand].wort; },
    jetzt(){ return zustand; },
    pegel(v){ extern = (v === null || v === undefined) ? null : Math.max(0, Math.min(1, v)); },
    mikro,
    mikroAus,
    anhalten,
    weiter
  };
};
