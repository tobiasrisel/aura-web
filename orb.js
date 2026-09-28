/* Aura · Orb
 *
 * Energieball aus Partikeln: eine dichte Kugel mit wandernden Farbflecken,
 * umgeben von einem flachen, langsam drehenden Halo. Die Zeichenflaeche ist
 * fensterweit, der Ball bleibt in der Mitte – genauer: in der Mitte des
 * Ankerelements, das seine Groesse vorgibt. Kein Partikel wird am Fensterrand
 * abgeschnitten: der Ball wird so bemessen, dass er mit Abstand hineinpasst,
 * und am Rand blenden Partikel weich aus.
 *
 * Partikelmodus: die Partikel verlassen die Kugel und bilden Woerter, Figuren
 * oder kleine Animationen. Gesteuert ueber AuraOrb.deuten(satz) und
 * orb.befolgen(befehl) – "Partikelmodus an" / "Partikelmodus aus".
 *
 * Aufruf:  const orb = AuraOrb(canvas, {anker: element, punkte: 6000});
 *          orb.zustand("denken");  orb.mikro(strom);  orb.mikroAus();  orb.pegel(0.8);
 *          orb.anhalten();  orb.weiter();
 *          orb.befolgen(AuraOrb.deuten("Partikelmodus an"));
 *          orb.zeige({figur: "herz"});  orb.zeige({text: "Hallo"});
 */
(function () {
  "use strict";

  /* Zwei Farben je Zustand: Grundton und Leuchtfarbe der Flecken.
     "ruhe" entspricht der Vorlage – violett mit Cyan. */
  const ZUSTAENDE = {
    ruhe:     {wort:"bereit",              a:[142, 88,255], b:[ 64,218,232], dreh:0.10, streu:0.06, grund:0.05},
    hoeren:   {wort:"hört zu",             a:[ 96,128,255], b:[ 70,236,240], dreh:0.16, streu:0.10, grund:0.10},
    denken:   {wort:"denkt nach",          a:[150, 84,255], b:[196,132,255], dreh:0.52, streu:0.62, grund:0.30},
    sprechen: {wort:"spricht",             a:[150, 70,220], b:[250,178,100], dreh:0.22, streu:0.16, grund:0.22},
    freigabe: {wort:"wartet auf freigabe", a:[176, 48,104], b:[246,124, 84], dreh:0.07, streu:0.05, grund:0.09}
  };

  const TAU = Math.PI * 2;
  const glatt = (a, b, x) => { const t = Math.min(1, Math.max(0, (x-a)/(b-a))); return t*t*(3-2*t); };
  const zufall = (j, k) => { const s = Math.sin(j*12.9898 + k*78.233) * 43758.5453; return s - Math.floor(s); };
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

  /* Farbrauschen: langsam wandernde Flecken */
  function rauschen(x, y, z, t) {
    return Math.sin(x*2.1 + t*0.31) * Math.sin(y*2.3 - t*0.23 + 1.7) * Math.sin(z*1.9 + t*0.19 + 0.6)
         + Math.sin(x*4.7 - z*3.1 + t*0.47) * 0.35;
  }

  /* ================================================================== */
  /* Figuren                                                             */
  /* ================================================================== */
  /* Eine Figur liefert fuer jedes Formpartikel j (0 … n-1) einen Zielpunkt
     in Figureinheiten: y in [-1, 1] (nach unten positiv), x in [-ax, ax],
     z fuer die Tiefe, dazu einen Helligkeitsfaktor.
       {ax, groesse, ziel(j, n, t, o), takt?(t)}                           */

  const ABTAST = document.createElement("canvas");

  /* Zeichnet eine Form weiss auf eine Hilfsflaeche und verteilt n Punkte
     zufaellig auf die gefuellten Pixel. */
  function abtasten(zeichnen, breite, hoehe, n) {
    ABTAST.width = breite; ABTAST.height = hoehe;
    const g = ABTAST.getContext("2d", {willReadFrequently: true});
    g.clearRect(0, 0, breite, hoehe);
    g.fillStyle = g.strokeStyle = "#fff";
    g.lineCap = g.lineJoin = "round";
    zeichnen(g, breite, hoehe);
    const d = g.getImageData(0, 0, breite, hoehe).data;

    const SCHRITT = 2;
    const kand = [];
    let x0 = breite, x1 = 0, y0 = hoehe, y1 = 0;
    for (let y = 0; y < hoehe; y += SCHRITT)
      for (let x = 0; x < breite; x += SCHRITT)
        if (d[(y*breite + x)*4 + 3] > 127) {
          kand.push(x, y);
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    const m = kand.length / 2;
    const pts = new Float32Array(n*2);
    if (!m) return {pts, ax: 1};

    const mx = (x0 + x1)/2, my = (y0 + y1)/2, hh = Math.max(1, (y1 - y0)/2);
    const folge = new Uint32Array(m);
    for (let k = 0; k < m; k++) folge[k] = k;
    for (let k = m - 1; k > 0; k--) {
      const r = Math.floor(Math.random()*(k + 1));
      const s = folge[k]; folge[k] = folge[r]; folge[r] = s;
    }
    for (let j = 0; j < n; j++) {
      const k = folge[j % m];
      const zit = j >= m ? SCHRITT*0.9 : SCHRITT*0.5;   // Doppelte leicht versetzen
      pts[2*j]   = (kand[2*k]   + (Math.random() - 0.5)*zit - mx) / hh;
      pts[2*j+1] = (kand[2*k+1] + (Math.random() - 0.5)*zit - my) / hh;
    }
    return {pts, ax: Math.max(0.2, (x1 - x0)/2/hh)};
  }

  function flach(abt, groesse, bewegung) {
    return {
      ax: abt.ax, groesse,
      ziel(j, n, t, o) {
        o[0] = abt.pts[2*j]; o[1] = abt.pts[2*j+1]; o[2] = 0; o[3] = 1;
        if (bewegung) bewegung(o, t, j);
      }
    };
  }

  /* Text auf hoechstens drei Zeilen umbrechen */
  function umbrechen(text) {
    const woerter = text.toUpperCase().split(/\s+/).filter(Boolean);
    const zeilen = [];
    for (const w of woerter) {
      const z = zeilen[zeilen.length - 1];
      if (z !== undefined && (z + " " + w).length <= 12) zeilen[zeilen.length - 1] = z + " " + w;
      else zeilen.push(w);
    }
    return zeilen.slice(0, 3);
  }

  function textAbtasten(text, n) {
    const zeilen = umbrechen(text);
    const px = 150, abstand = px*1.12;
    const schrift = `500 ${px}px "Space Grotesk", -apple-system, "Helvetica Neue", sans-serif`;
    const g = ABTAST.getContext("2d", {willReadFrequently: true});
    g.font = schrift;
    const breit = Math.max(1, ...zeilen.map(z => g.measureText(z).width));
    const abt = abtasten((g, b, h) => {
      g.font = schrift; g.textAlign = "center"; g.textBaseline = "middle";
      zeilen.forEach((z, k) => g.fillText(z, b/2, h/2 + (k - (zeilen.length - 1)/2)*abstand));
    }, Math.ceil(breit + px*0.5), Math.ceil(zeilen.length*abstand + px*0.5), n);
    abt.zeilen = zeilen.length;
    return abt;
  }

  function textFigur(text, n) {
    const abt = textAbtasten(text, n);
    const f = flach(abt, 0.34*abt.zeilen + 0.06, (o, t, j) => {
      o[0] += Math.sin(t*1.3 + j) * 0.004;
      o[1] += Math.cos(t*1.1 + j*1.7) * 0.004;
    });
    f.wort = text;
    return f;
  }

  /* Uhrzeit als Text, jede Minute neu abgetastet */
  function uhrFigur(n) {
    const jetzt = () => new Date().toLocaleTimeString("de-DE", {hour:"2-digit", minute:"2-digit"});
    let stand = jetzt(), abt = textAbtasten(stand, n);
    return {
      get ax() { return abt.ax; }, groesse: 0.42,
      takt() { const s = jetzt(); if (s !== stand) { stand = s; abt = textAbtasten(s, n); } },
      ziel(j, n2, t, o) { o[0] = abt.pts[2*j]; o[1] = abt.pts[2*j+1]; o[2] = 0; o[3] = 1; }
    };
  }

  function drehenY(o, a) {
    const c = Math.cos(a), s = Math.sin(a), x = o[0];
    o[0] = x*c; o[2] = x*s;
  }

  const FIGUREN = {
    herz: {
      name: "Herz",
      worte: ["herz", "herzen", "liebe"],
      bau: n => flach(abtasten(g => {
        g.beginPath();
        for (let k = 0; k <= 240; k++) {
          const a = k/240*TAU, s = Math.sin(a);
          g.lineTo(200 + 16*s*s*s*11,
                   195 - (13*Math.cos(a) - 5*Math.cos(2*a) - 2*Math.cos(3*a) - Math.cos(4*a))*11);
        }
        g.fill();
      }, 400, 400, n), 0.8, (o, t) => {
        const schlag = Math.pow(Math.max(0, Math.sin(t*TAU*1.05)), 10);
        const s = 1 + schlag*0.09;
        o[0] *= s; o[1] *= s; o[3] = 1 + schlag*0.5;
      })
    },
    stern: {
      name: "Stern",
      worte: ["stern", "sterne", "sternchen"],
      bau: n => flach(abtasten(g => {
        g.beginPath();
        for (let k = 0; k < 10; k++) {
          const r = k % 2 ? 72 : 185, a = -Math.PI/2 + k*Math.PI/5;
          g.lineTo(200 + Math.cos(a)*r, 205 + Math.sin(a)*r);
        }
        g.fill();
      }, 400, 400, n), 0.8, (o, t) => drehenY(o, t*0.8))
    },
    haus: {
      name: "Haus",
      worte: ["haus", "gebäude", "gebaeude", "immobilie", "immobilien", "wohnung", "zuhause"],
      bau: n => flach(abtasten(g => {
        const p = new Path2D();
        p.moveTo(200, 40); p.lineTo(372, 182); p.lineTo(332, 182); p.lineTo(332, 362);
        p.lineTo(68, 362); p.lineTo(68, 182); p.lineTo(28, 182); p.closePath();
        p.rect(170, 262, 60, 100);
        p.rect(102, 210, 56, 46); p.rect(242, 210, 56, 46);
        g.fill(p, "evenodd");
      }, 400, 400, n), 0.8)
    },
    haken: {
      name: "Haken",
      worte: ["haken", "häkchen", "haekchen", "erledigt", "fertig", "check"],
      bau: n => flach(abtasten(g => {
        g.lineWidth = 52;
        g.beginPath(); g.moveTo(70, 215); g.lineTo(165, 305); g.lineTo(335, 105); g.stroke();
      }, 400, 400, n), 0.72)
    },
    blitz: {
      name: "Blitz",
      worte: ["blitz", "energie", "strom"],
      bau: n => flach(abtasten(g => {
        g.beginPath();
        [[244,18],[98,222],[194,222],[158,382],[306,164],[208,164],[256,18]].forEach(([x,y]) => g.lineTo(x, y));
        g.fill();
      }, 400, 400, n), 0.82, (o, t, j) => {
        const f = Math.pow(Math.max(0, Math.sin(t*3.1)), 16);
        o[3] = 0.8 + f*0.9;
        o[0] += Math.sin(t*23 + j)*0.006*f;
      })
    },
    smiley: {
      name: "Smiley",
      worte: ["smiley", "lächeln", "laecheln", "gesicht", "lachen", "freude"],
      bau: n => flach(abtasten(g => {
        g.lineWidth = 26;
        g.beginPath(); g.arc(200, 200, 160, 0, TAU); g.stroke();
        g.beginPath(); g.arc(145, 160, 22, 0, TAU); g.fill();
        g.beginPath(); g.arc(255, 160, 22, 0, TAU); g.fill();
        g.beginPath(); g.arc(200, 205, 92, 0.15*Math.PI, 0.85*Math.PI); g.stroke();
      }, 400, 400, n), 0.8)
    },
    unendlich: {
      name: "Unendlich",
      worte: ["unendlich", "unendlichkeit", "ewig"],
      bau: n => flach(abtasten(g => {
        g.lineWidth = 30;
        g.beginPath();
        for (let k = 0; k <= 300; k++) {
          const a = k/300*TAU, s = Math.sin(a), q = 1 + s*s;
          g.lineTo(250 + 205*Math.cos(a)/q, 130 + 205*s*Math.cos(a)/q);
        }
        g.stroke();
      }, 500, 260, n), 0.5, (o, t, j) => { o[3] = 0.7 + 0.6*Math.pow(0.5 + 0.5*Math.sin(o[0]*2.2 - t*3), 4); })
    },
    wuerfel: {
      name: "Würfel",
      worte: ["würfel", "wuerfel", "quader", "box", "kubus"],
      bau: () => {
        const K = [[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
        const E = k => [(k&1) ? 0.62 : -0.62, (k&2) ? 0.62 : -0.62, (k&4) ? 0.62 : -0.62];
        return {
          ax: 1, groesse: 0.9,
          ziel(j, n, t, o) {
            const [a, b] = K[j % 12], u = zufall(j, 1), pa = E(a), pb = E(b);
            let x = pa[0] + (pb[0]-pa[0])*u + (zufall(j,2) - 0.5)*0.03;
            let y = pa[1] + (pb[1]-pa[1])*u + (zufall(j,3) - 0.5)*0.03;
            let z = pa[2] + (pb[2]-pa[2])*u + (zufall(j,4) - 0.5)*0.03;
            const ay = t*0.55, ax = 0.55 + Math.sin(t*0.3)*0.25;
            const x1 = x*Math.cos(ay) - z*Math.sin(ay), z1 = x*Math.sin(ay) + z*Math.cos(ay);
            const y1 = y*Math.cos(ax) - z1*Math.sin(ax), z2 = y*Math.sin(ax) + z1*Math.cos(ax);
            o[0] = x1; o[1] = y1; o[2] = z2; o[3] = 1;
          }
        };
      }
    },
    helix: {
      name: "Helix",
      worte: ["helix", "dna", "doppelhelix", "erbgut"],
      bau: () => ({
        ax: 1.6, groesse: 0.75,
        ziel(j, n, t, o) {
          let s, v = 1, b = 1;
          if (j % 9 < 7) { s = zufall(j, 1)*2 - 1; }
          else { s = -1 + (Math.floor(zufall(j, 3)*28) + 0.5)/28*2; v = zufall(j, 4)*2 - 1; b = 0.55; }
          const a = s*Math.PI*2.6 + t*1.1 + (j % 9 < 7 && j % 2 ? Math.PI : 0);
          o[0] = s*1.55 + (zufall(j, 5) - 0.5)*0.02;
          o[1] = Math.sin(a)*0.5*v;
          o[2] = Math.cos(a)*0.5*v;
          o[3] = b;
        }
      })
    },
    welle: {
      name: "Welle",
      worte: ["welle", "wellen", "meer", "ozean", "wasser"],
      bau: n => {
        const sp = Math.ceil(Math.sqrt(n*2.2)), ze = Math.ceil(n/sp);
        return {
          ax: 1.6, groesse: 0.7,
          ziel(j, n2, t, o) {
            const X = ((j % sp)/(sp - 1)*2 - 1)*1.6;
            const Z = (Math.floor(j/sp)/(ze - 1)*2 - 1);
            const Y = 0.32*Math.sin(X*2.2 - t*1.8)*Math.cos(Z*2.4 + t*1.1);
            o[0] = X; o[1] = Z*0.55 - Y; o[2] = Z*0.8; o[3] = 0.55 + Y*0.8;
          }
        };
      }
    },
    galaxie: {
      name: "Galaxie",
      worte: ["galaxie", "galaxis", "spirale", "milchstraße", "milchstrasse", "universum", "weltall"],
      bau: () => ({
        ax: 1.5, groesse: 0.8,
        ziel(j, n, t, o) {
          let r, a;
          if (j % 7 === 0) { r = Math.abs(zufall(j,1) + zufall(j,2) - 1)*0.35; a = zufall(j,3)*TAU; }
          else {
            r = 0.1 + Math.pow(zufall(j,1), 0.75)*1.35;
            a = (j % 3)*TAU/3 + r*2.7 + (zufall(j,2) - 0.5)*(0.25 + 0.5/(r + 0.4));
          }
          a += t*0.28;
          const X = r*Math.cos(a), Zd = r*Math.sin(a), Y = (zufall(j,4) - 0.5)*0.06;
          o[0] = X; o[1] = Zd*0.42 + Y; o[2] = Zd*0.9; o[3] = r < 0.35 ? 1.25 : 1;
        }
      })
    },
    atom: {
      name: "Atom",
      worte: ["atom", "atome", "molekül", "molekuel"],
      bau: () => ({
        ax: 1.3, groesse: 0.85,
        ziel(j, n, t, o) {
          if (j % 8 === 0) {
            const u = zufall(j,1)*TAU, v = Math.acos(2*zufall(j,2) - 1), r = 0.17*Math.cbrt(zufall(j,3));
            o[0] = r*Math.sin(v)*Math.cos(u); o[1] = r*Math.cos(v); o[2] = r*Math.sin(v)*Math.sin(u); o[3] = 1.3;
            return;
          }
          const k = j % 3, f = zufall(j,1)*TAU;
          let x = 1.25*Math.cos(f), y = 0.4*Math.sin(f), z = 0;
          const neig = 0.35;                                  // leicht in die Tiefe kippen
          const y1 = y*Math.cos(neig), z1 = y*Math.sin(neig);
          const w = k*Math.PI/3 + t*0.15, c = Math.cos(w), s = Math.sin(w);
          o[0] = x*c - y1*s; o[1] = x*s + y1*c; o[2] = z1;
          const e = ((t*(1.3 + k*0.35) + k*2) % TAU + TAU) % TAU;
          let d = Math.abs(f - e); d = Math.min(d, TAU - d);
          o[3] = 0.35 + 1.3*Math.exp(-d*d*5);
        }
      })
    },
    puls: {
      name: "Herzschlag",
      worte: ["herzschlag", "puls", "ekg", "herzfrequenz"],
      bau: () => {
        const ekg = p => {
          p = ((p % 1) + 1) % 1;
          return 0.12*Math.exp(-Math.pow((p - 0.18)/0.03, 2))
               - 0.18*Math.exp(-Math.pow((p - 0.37)/0.012, 2))
               + 1.00*Math.exp(-Math.pow((p - 0.40)/0.014, 2))
               - 0.30*Math.exp(-Math.pow((p - 0.43)/0.012, 2))
               + 0.25*Math.exp(-Math.pow((p - 0.62)/0.05, 2));
        };
        return {
          ax: 1.7, groesse: 0.6,
          ziel(j, n, t, o) {
            const x = zufall(j, 1)*3.4 - 1.7;
            o[0] = x;
            o[1] = -ekg((x + 1.7)/3.4*2 - t*0.55)*0.85 + 0.2 + (zufall(j,2) - 0.5)*0.035;
            o[2] = 0; o[3] = 1;
          }
        };
      }
    },
    uhr: {
      name: "Uhrzeit",
      worte: ["uhr", "uhrzeit", "zeit", "spät", "spaet"],
      bau: n => uhrFigur(n)
    }
  };

  /* Woerter, die beim Deuten eines Satzes keine Bedeutung tragen */
  const FUELL = new Set(("zeig zeige zeigen mach mache machen mal bitte ein eine einen einem einer das den die der "
    + "dem mir uns jetzt nun aura wort text schreib schreibe schreiben forme formen bilde bilden "
    + "form figur als und noch kannst du mit aus partikeln partikel").split(" "));
  const SCHREIB = new Set(["schreib", "schreibe", "schreiben", "wort", "text", "buchstabiere"]);
  const ZUR_KUGEL = new Set(["kugel", "orb", "energieball", "ball", "ursprung", "zurück", "zurueck"]);

  /* ================================================================== */
  /* Orb                                                                 */
  /* ================================================================== */
  function AuraOrb(cv, optionen = {}) {
    const N = optionen.punkte || 10000;
    // Sparbetrieb (Mac-App): weniger Bilder je Sekunde und geringere
    // Aufloesung – WKWebView zeichnet sonst mehrere Baelle auf Kosten der
    // Bedienung.
    const BILD_MS = optionen.fps ? 1000/optionen.fps : 0;
    const DPR_MAX = optionen.dprMax || 2;
    let letztesBild = 0;
    const anker = optionen.anker || null;
    const sparsam = matchMedia("(prefers-reduced-motion: reduce)").matches;

    /* --- Zeichenflaeche: WebGL, sonst 2D --- */
    let gl = cv.getContext("webgl", {alpha:true, premultipliedAlpha:true, antialias:false, depth:false, stencil:false});
    let ctx = null, uRes = null;
    const daten = new Float32Array(N*7);
    if (gl) {
      const VS = `attribute vec2 a_pos; attribute float a_gr; attribute vec4 a_farbe;
        uniform vec2 u_res; varying vec4 v_farbe;
        void main(){ vec2 c = a_pos/u_res*2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
          gl_PointSize = a_gr; v_farbe = a_farbe; }`;
      const FS = `precision mediump float; varying vec4 v_farbe;
        void main(){ vec2 d = gl_PointCoord - 0.5; float r2 = dot(d, d)*4.0; if (r2 > 1.0) discard;
          float kern = exp(-r2*7.0); float schein = (1.0 - r2); schein = schein*schein*0.45;
          float a = (kern + schein)*v_farbe.a; gl_FragColor = vec4(v_farbe.rgb*a, a); }`;
      const baue = (typ, src) => {
        const s = gl.createShader(typ); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, baue(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, baue(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, daten.byteLength, gl.DYNAMIC_DRAW);
      const attr = (name, anz, vers) => {
        const l = gl.getAttribLocation(prog, name);
        gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, anz, gl.FLOAT, false, 28, vers);
      };
      attr("a_pos", 2, 0); attr("a_gr", 1, 8); attr("a_farbe", 4, 12);
      uRes = gl.getUniformLocation(prog, "u_res");
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);                 // additiv: Partikel leuchten
      gl.clearColor(0, 0, 0, 0);
    } else {
      ctx = cv.getContext("2d");
    }

    /* --- Partikel --- */
    const typ  = new Uint8Array(N);                 // 0 Kugel, 1 Halo
    const form = new Uint8Array(N);                 // bildet im Partikelmodus die Figur
    const funke = new Uint8Array(N);
    const hx = new Float32Array(N), hy = new Float32Array(N), hz = new Float32Array(N);
    const rr = new Float32Array(N), th = new Float32Array(N);
    const p1 = new Float32Array(N), p2 = new Float32Array(N), fq = new Float32Array(N);
    const hell = new Float32Array(N), gr = new Float32Array(N);
    const rate = new Float32Array(N), folg = new Float32Array(N), wirbel = new Float32Array(N);
    const w  = new Float32Array(N);                 // 0 = Kugel, 1 = Figur
    const fx = new Float32Array(N), fy = new Float32Array(N), fz = new Float32Array(N), fb = new Float32Array(N);
    const fj = new Uint32Array(N);                  // Index innerhalb der Figur
    let nForm = 0;

    for (let i = 0; i < N; i++) {
      p1[i] = Math.random()*TAU; p2[i] = Math.random()*TAU; fq[i] = 0.6 + Math.random()*1.5;
      rate[i] = 0.018 + Math.random()*0.035;
      folg[i] = 0.06 + Math.random()*0.08;
      wirbel[i] = (Math.random() - 0.5)*0.7;
      if (i < N*0.58) {
        typ[i] = 0;
        const r = Math.random() < 0.55 ? 1 - Math.abs(gauss())*0.04 : Math.pow(Math.random(), 0.5)*0.97;
        const v = Math.acos(2*Math.random() - 1), u = Math.random()*TAU;
        hx[i] = r*Math.sin(v)*Math.cos(u); hy[i] = r*Math.cos(v); hz[i] = r*Math.sin(v)*Math.sin(u);
        rr[i] = r;
      } else {
        typ[i] = 1;
        let t, p;
        do {                                        // Halo in Wolken statt gleichmaessig
          t = Math.random()*TAU;
          p = 1.3 + Math.pow(Math.random(), 0.9)*0.92;
        } while (Math.random() > 0.3 + 0.7*(0.5 + 0.5*Math.sin(t*5 + p*3.1)*Math.sin(t*3 - 1.3 + p*2)));
        th[i] = t; rr[i] = p; hy[i] = gauss()*0.16*p;
      }
      funke[i] = Math.random() < 0.02 ? 1 : 0;
      hell[i] = funke[i] ? 1 : 0.45 + Math.random()*0.55;
      gr[i] = funke[i] ? 2.4 + Math.random()*1.2 : 1.05 + Math.pow(Math.random(), 2.5)*1.5;
      form[i] = typ[i] === 0 || Math.random() < 0.4 ? 1 : 0;
      if (form[i]) fj[i] = nForm++;
    }
    // Figurindizes mischen, damit benachbarte Kugelpartikel nicht benachbarte Figurpunkte bekommen
    const reihe = Array.from({length: nForm}, (_, k) => k);
    for (let k = nForm - 1; k > 0; k--) { const r = Math.floor(Math.random()*(k+1)); [reihe[k], reihe[r]] = [reihe[r], reihe[k]]; }
    { let j = 0; for (let i = 0; i < N; i++) if (form[i]) fj[i] = reihe[j++]; }

    /* --- Zustand --- */
    let zustand = "ruhe";
    const A = ZUSTAENDE.ruhe.a.slice(), B = ZUSTAENDE.ruhe.b.slice();
    let dreh = ZUSTAENDE.ruhe.dreh, streu = ZUSTAENDE.ruhe.streu;
    let pegel = 0, zielPegel = 0, extern = null;
    let winkel = 0, zeit = 0, letzt = performance.now(), aktFarbe = "";
    let laeuft = false, bildNr = 0;
    let modus = false, figur = null, staub = 1;
    const wellen = [];
    const O = new Float32Array(4);

    /* --- Masse --- */
    let W = 1, H = 1, dpr = 1;
    function masse() {
      dpr = Math.min(devicePixelRatio || 1, DPR_MAX);
      W = cv.clientWidth || innerWidth; H = cv.clientHeight || innerHeight;
      cv.width = Math.round(W*dpr); cv.height = Math.round(H*dpr);
      if (gl) gl.viewport(0, 0, cv.width, cv.height);
      else ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    masse();
    addEventListener("resize", masse);
    if (window.ResizeObserver) new ResizeObserver(masse).observe(cv);

    const NEIG = -0.38, sinN = Math.sin(NEIG), cosN = Math.cos(NEIG);
    const HALO = 0.68,  sinH = Math.sin(HALO), cosH = Math.cos(HALO);

    function bild() {
      /* Mitte und Groesse aus dem Anker; so bemessen, dass nichts den Rand erreicht */
      const cr = cv.getBoundingClientRect();
      let mx = W/2, my = H/2, S = Math.min(W, H)*0.36;
      if (anker) {
        const a = anker.getBoundingClientRect();
        if (a.width > 0) { mx = a.left - cr.left + a.width/2; my = a.top - cr.top + a.height/2; S = Math.min(a.width, a.height)/2; }
      }
      const rand = Math.max(20, Math.min(W, H)*0.05);
      const frei = Math.max(10, Math.min(mx, W - mx) - rand), freiY = Math.max(10, Math.min(my, H - my) - rand);
      const R = Math.max(8, Math.min(S*0.44, frei/2.5, freiY/2.0));

      /* Figurmassstab */
      let fs = 0;
      if (figur) fs = Math.max(4, Math.min(S*figur.groesse*1.15, freiY*0.94, (frei*0.9)/Math.max(0.2, figur.ax)));

      const auf = pegel;
      const sinW = Math.sin(winkel), cosW = Math.cos(winkel);
      const glob = 0.95 + auf*0.6;
      const ziel = modus && figur ? 1 : 0;
      staub += ((modus ? 0.28 : 1) - staub)*0.04;

      let anz = 0;
      for (let i = 0; i < N; i++) {
        const turb = Math.sin(zeit*fq[i] + p1[i]) * Math.cos(zeit*0.7 + p2[i]);
        let ox, oy, al, nz, welle = 0;
        for (let k = 0; k < wellen.length; k++) {
          const d = (rr[i] - wellen[k].r)/0.14;
          welle += Math.exp(-d*d)*wellen[k].kraft;
        }

        if (typ[i] === 0) {
          const aus = 1 + (0.035 + auf*0.26)*turb + auf*0.09 + welle*0.05;
          const x0 = hx[i]*aus, y0 = hy[i]*aus, z0 = hz[i]*aus;
          const x = x0*cosW - z0*sinW, z = x0*sinW + z0*cosW;
          const y2 = y0*cosN - z*sinN, z2 = y0*sinN + z*cosN;
          const per = 1/(1 - z2*0.16);
          ox = mx + x*R*per; oy = my + y2*R*per;
          al = 0.42 + 0.58*(z2/(rr[i] || 1) + 1)/2;
          nz = rauschen(hx[i]*1.2, hy[i]*1.2, hz[i]*1.2, zeit);
        } else {
          const t = th[i] + winkel*0.55*(1.6/rr[i]);
          const p = rr[i]*(1 + auf*0.10*turb + welle*0.04);
          const X = p*Math.cos(t), Zr = p*Math.sin(t), Y = hy[i] + Math.sin(zeit*fq[i] + p1[i])*0.025;
          const y2 = Y*cosH - Zr*sinH, z2 = Y*sinH + Zr*cosH;
          const per = 1/(1 - z2*0.09);
          ox = mx + X*R*per; oy = my + y2*R*per;
          al = (0.5 + 0.4*(z2/p + 1)/2) * staub;
          nz = rauschen(Math.cos(t)*1.4, Math.sin(t)*1.4, p*0.8, zeit*0.8);
        }

        let X = ox, Y = oy, farbPar = nz, groesse = 1;
        if (form[i]) {
          w[i] += (ziel - w[i])*rate[i];
          if (w[i] > 0.002 && figur) {
            figur.ziel(fj[i], nForm, zeit, O);
            const per = 1/(1 - O[2]*0.2);
            const gx = mx + O[0]*fs*per, gy = my + O[1]*fs*per;
            if (w[i] < 0.02) { fx[i] = gx; fy[i] = gy; fz[i] = O[2]; fb[i] = O[3]; }
            else {
              fx[i] += (gx - fx[i])*folg[i]; fy[i] += (gy - fy[i])*folg[i];
              fz[i] += (O[2] - fz[i])*folg[i]; fb[i] += (O[3] - fb[i])*folg[i];
            }
          }
          if (w[i] > 0.002) {
            const e = w[i]*w[i]*(3 - 2*w[i]);
            const dx = fx[i] - ox, dy = fy[i] - oy, bo = Math.sin(Math.PI*e)*wirbel[i];
            X = ox + dx*e - dy*bo;
            Y = oy + dy*e + dx*bo;
            const fal = (0.6 + 0.4*(Math.max(-1, Math.min(1, fz[i])) + 1)/2) * fb[i];
            al += (fal*1.05 - al)*e;
            farbPar += (rauschen((fx[i] - mx)/(fs || 1)*1.1, (fy[i] - my)/(fs || 1)*1.1, fz[i], zeit) - farbPar)*e;
            groesse = 1 + 0.1*e;
          }
        }

        /* weich ausblenden, bevor ein Partikel den Rand erreicht */
        const dr = Math.min(X, W - X, Y, H - Y);
        if (dr <= 1) continue;
        const rand01 = dr < rand ? glatt(0, rand, dr) : 1;

        const c = funke[i] ? 1 : glatt(0.2, 0.75, farbPar);
        const funkeln = 0.72 + 0.28*Math.sin(zeit*fq[i]*2.3 + p2[i]);
        const alpha = Math.min(1, hell[i]*al*funkeln*glob*(1 + welle*0.8)*rand01);
        if (alpha < 0.01) continue;

        const o = anz*7;
        daten[o]   = X*dpr; daten[o+1] = Y*dpr;
        daten[o+2] = gr[i]*groesse*(1 + auf*0.35)*dpr*3.2;
        daten[o+3] = (A[0] + (B[0] - A[0])*c)/255;
        daten[o+4] = (A[1] + (B[1] - A[1])*c)/255;
        daten[o+5] = (A[2] + (B[2] - A[2])*c)/255;
        daten[o+6] = alpha;
        anz++;
      }

      if (gl) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uRes, cv.width, cv.height);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, daten.subarray(0, anz*7));
        gl.drawArrays(gl.POINTS, 0, anz);
      } else {
        ctx.clearRect(0, 0, W, H);
        ctx.globalCompositeOperation = "lighter";
        for (let k = 0; k < anz; k++) {
          const o = k*7, s = daten[o+2]/dpr/3;
          ctx.fillStyle = `rgba(${daten[o+3]*255|0},${daten[o+4]*255|0},${daten[o+5]*255|0},${daten[o+6]})`;
          ctx.fillRect(daten[o]/dpr - s/2, daten[o+1]/dpr - s/2, s, s);
        }
      }
    }

    function takt(jetzt) {
      if (!laeuft) return;
      if (BILD_MS && jetzt && jetzt - letztesBild < BILD_MS - 2) { bildNr = requestAnimationFrame(takt); return; }
      letztesBild = jetzt || performance.now();
      const dt = Math.min(0.05, Math.max(0, ((jetzt || performance.now()) - letzt)/1000)) * (sparsam ? 0.25 : 1);
      letzt = jetzt || performance.now();

      const z = ZUSTAENDE[zustand];
      for (let i = 0; i < 3; i++) { A[i] += (z.a[i] - A[i])*0.06; B[i] += (z.b[i] - B[i])*0.06; }
      const akt = `rgb(${B.map(v => Math.round(v)).join(",")})`;
      if (akt !== aktFarbe) { aktFarbe = akt; document.documentElement.style.setProperty("--akt", akt); }

      dreh  += (z.dreh  - dreh )*0.05;
      streu += (z.streu - streu)*0.05;

      if (extern !== null) zielPegel = extern;
      else if (zustand !== "hoeren") {
        const atem = Math.sin(zeit*0.9)*0.5 + 0.5;
        const unruhe = zustand === "denken" ? (Math.sin(zeit*4.1)*0.5 + 0.5)*0.35 : 0;
        zielPegel = z.grund + atem*streu + unruhe;
      }
      pegel += (zielPegel - pegel)*(zustand === "hoeren" ? 0.30 : 0.10);

      if (zustand === "sprechen" && Math.random() < 0.03 && wellen.length < 4)
        wellen.push({r: 0.6, kraft: 0.5 + Math.random()*0.5});
      for (let k = wellen.length - 1; k >= 0; k--) {
        wellen[k].r += dt*1.6;
        wellen[k].kraft *= 0.992;
        if (wellen[k].r > 2.6) wellen.splice(k, 1);
      }

      zeit += dt;
      winkel += dreh*dt*1.6;
      if (figur && figur.takt) figur.takt(zeit);
      bild();
      bildNr = requestAnimationFrame(takt);
    }

    /* Gezeichnet wird nur bei sichtbarem Fenster. Die Sichtbarkeit meldet das
       Programm ueber "aura://sichtbar" (konsole.js, wand.html), weil
       document.hidden in einem per hide() verborgenen WKWebView nicht
       zuverlaessig umschaltet. */
    function weiter() {
      if (laeuft) return;
      laeuft = true;
      letzt = performance.now();
      bildNr = requestAnimationFrame(takt);
    }
    function anhalten() {
      if (!laeuft) return;
      laeuft = false;
      cancelAnimationFrame(bildNr);
    }
    // Nur anhalten, nie von hier aus fortsetzen – das entscheidet die Meldung.
    document.addEventListener("visibilitychange", () => { if (document.hidden) anhalten(); });
    weiter();

    /* --- Mikrofon ---
       Nur offen, solange zugehoert wird; sonst zeigte macOS dauerhaft den
       Mikrofonpunkt. Ein uebergebener Strom (von der Aufnahme) wird
       mitbenutzt, statt ein zweites Mal nach dem Mikrofon zu fragen. */
    let analyse = null, puffer = null, strom = null, mikroAc = null;
    async function mikro(vorhanden) {
      if (analyse) return true;
      try {
        strom = vorhanden || await navigator.mediaDevices.getUserMedia({audio: true});
        mikroAc = new (window.AudioContext || window.webkitAudioContext)();
        if (mikroAc.state === "suspended") await mikroAc.resume();
        mikroAc.createMediaStreamSource(strom).connect(analyse = mikroAc.createAnalyser());
        analyse.fftSize = 512;
        analyse.smoothingTimeConstant = 0.72;
        puffer = new Uint8Array(analyse.frequencyBinCount);
        (function lesen() {
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

    function mikroAus() {
      strom?.getTracks().forEach(t => t.stop());
      mikroAc?.close().catch(() => {});
      strom = mikroAc = analyse = puffer = null;
    }

    /* --- Partikelmodus --- */
    function zeige(spec) {
      if (!spec || spec.figur === "orb") { figur = null; return null; }
      if (spec.text) figur = textFigur(String(spec.text).slice(0, 40), nForm);
      else if (FIGUREN[spec.figur]) figur = FIGUREN[spec.figur].bau(nForm);
      return figur;
    }

    const api = {
      zustand(neu) {
        if (!ZUSTAENDE[neu] || neu === zustand) return zustand;
        zustand = neu;
        if (neu === "sprechen") wellen.length = 0;
        if (neu !== "sprechen") extern = null;
        return zustand;
      },
      wort() { return modus ? "partikelmodus" : ZUSTAENDE[zustand].wort; },
      jetzt() { return zustand; },
      pegel(v) { extern = (v === null || v === undefined) ? null : Math.max(0, Math.min(1, v)); },
      mikro,
      mikroAus,
      anhalten,
      weiter,

      partikelmodus(an) {
        modus = !!an;
        if (!modus) figur = null;
        return modus;
      },
      imPartikelmodus() { return modus; },
      zeige(spec) { if (!modus) modus = true; return zeige(spec); },

      /* Befehl aus AuraOrb.deuten() ausfuehren; liefert eine kurze Rueckmeldung */
      befolgen(b) {
        if (!b) return null;
        if (b.befehl === "an")  { api.partikelmodus(true);  zeige({text: "Aura"}); return "Partikelmodus an."; }
        if (b.befehl === "aus") { api.partikelmodus(false); return "Partikelmodus aus."; }
        if (b.befehl === "zeige") {
          api.zeige(b);
          if (b.text) return `„${b.text}“`;
          if (b.figur === "orb") return "Zurück zur Kugel.";
          return FIGUREN[b.figur] ? FIGUREN[b.figur].name : null;
        }
        return null;
      }
    };
    return api;
  }

  /* Satz deuten. Liefert {befehl:"an"|"aus"} jederzeit, im Partikelmodus
     zusaetzlich {befehl:"zeige", figur|text}; sonst null. */
  AuraOrb.deuten = function (satz, partikelmodus) {
    const roh = String(satz || "").toLowerCase();
    const kompakt = roh.replace(/[^a-zäöüß]/g, "");
    if (/partikelmodus(aus|ab|beenden|stopp|stop)/.test(kompakt)) return {befehl: "aus"};
    if (/partikelmodus(an|ein|starten)/.test(kompakt))            return {befehl: "an"};
    if (!partikelmodus) return null;

    const woerter = roh.replace(/[^a-zäöüß0-9 ]/g, " ").split(/\s+/).filter(Boolean);
    const s = woerter.findIndex(x => SCHREIB.has(x));
    if (s >= 0) {
      const rest = woerter.slice(s + 1).filter(x => !FUELL.has(x));
      if (rest.length) return {befehl: "zeige", text: rest.slice(0, 5).join(" ")};
    }
    if (woerter.some(x => ZUR_KUGEL.has(x))) return {befehl: "zeige", figur: "orb"};
    for (const name in FIGUREN)
      if (woerter.some(x => FIGUREN[name].worte.includes(x))) return {befehl: "zeige", figur: name};
    const kern = woerter.filter(x => !FUELL.has(x));
    return kern.length ? {befehl: "zeige", text: kern.slice(0, 4).join(" ")} : null;
  };
  AuraOrb.figuren = Object.keys(FIGUREN);

  window.AuraOrb = AuraOrb;
})();
