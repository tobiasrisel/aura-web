/* Aura · Anmeldung
 *
 * Schmale Hülle um Supabase Auth (E-Mail + Passwort), ohne Bibliothek.
 * Die Sitzung liegt im localStorage; Overlay und Wand teilen ihn, weil beide
 * Fenster denselben Ursprung haben. Meldet sich das Overlay an, erfährt die
 * Wand es über das storage-Ereignis.
 *
 * Zweiter Weg: mit Microsoft (mitMicrosoft). Die Function "m365-verbinden"
 * prüft das Microsoft-Konto und schickt die Seite mit einem Einmal-Schlüssel
 * im Fragment (#anmeldung=…) zurück; einloesen() tauscht ihn gegen die Sitzung.
 *
 * Aufruf:  await AuraAnmeldung.anmelden(email, passwort);
 *          const token = await AuraAnmeldung.token();   // null = abgemeldet
 *          AuraAnmeldung.abmelden();
 *          AuraAnmeldung.beiAenderung(fn);
 */
window.AuraAnmeldung = (() => {
  "use strict";

  const {SUPABASE, SCHLUESSEL} = window.AURA_KONFIG;
  const ABLAGE = "aura.sitzung";
  // So lange vor Ablauf wird das Token erneuert.
  const VORLAUF_S = 90;

  const lesen = () => {
    try { return JSON.parse(localStorage.getItem(ABLAGE) || "null"); }
    catch { return null; }
  };
  const schreiben = s => {
    if(s) localStorage.setItem(ABLAGE, JSON.stringify(s));
    else localStorage.removeItem(ABLAGE);
    melden();
  };

  const hoerer = new Set();
  const melden = () => hoerer.forEach(fn => { try{ fn(!!lesen()); }catch{} });
  addEventListener("storage", e => { if(e.key === ABLAGE) melden(); });

  async function tokenAnfrage(art, rumpf){
    return sitzungAus(await fetch(`${SUPABASE}/auth/v1/token?grant_type=${art}`, {
      method: "POST",
      headers: {"apikey": SCHLUESSEL, "Content-Type": "application/json"},
      body: JSON.stringify(rumpf)
    }));
  }

  async function sitzungAus(antwort){
    const daten = await antwort.json().catch(() => ({}));
    if(!antwort.ok){
      const e = new Error(daten.error_description || daten.msg || `HTTP ${antwort.status}`);
      e.status = antwort.status;
      throw e;
    }
    return {
      access_token: daten.access_token,
      refresh_token: daten.refresh_token,
      laeuft_ab: daten.expires_at ?? Math.floor(Date.now()/1000) + (daten.expires_in ?? 3600),
      email: daten.user?.email ?? null
    };
  }

  async function anmelden(email, passwort){
    const s = await tokenAnfrage("password", {email: email.trim(), password: passwort});
    schreiben(s);
    return s.email;
  }

  async function mitMicrosoft(){
    const antwort = await fetch(`${SUPABASE}/functions/v1/m365-verbinden`, {
      method: "POST",
      headers: {"apikey": SCHLUESSEL, "Content-Type": "application/json"},
      body: JSON.stringify({aktion: "anmelden"})
    });
    const daten = await antwort.json().catch(() => ({}));
    if(!antwort.ok || !daten.url) throw new Error(daten.fehler || `HTTP ${antwort.status}`);
    location.href = daten.url;
  }

  async function einloesen(schluessel){
    const s = await sitzungAus(await fetch(`${SUPABASE}/auth/v1/verify`, {
      method: "POST",
      headers: {"apikey": SCHLUESSEL, "Content-Type": "application/json"},
      body: JSON.stringify({type: "magiclink", token_hash: schluessel})
    }));
    schreiben(s);
    return s.email;
  }

  function abmelden(){
    const s = lesen();
    schreiben(null);
    if(s) fetch(`${SUPABASE}/auth/v1/logout`, {
      method: "POST",
      headers: {"apikey": SCHLUESSEL, "Authorization": `Bearer ${s.access_token}`}
    }).catch(() => {});
  }

  // Eine laufende Erneuerung je Fenster; die zweite Anfrage wartet auf sie.
  let laufend = null;
  async function token(){
    const s = lesen();
    if(!s) return null;
    if(s.laeuft_ab - VORLAUF_S > Date.now()/1000) return s.access_token;

    laufend ??= (async () => {
      try{
        // Das andere Fenster kann inzwischen erneuert haben.
        const jetzt = lesen();
        if(jetzt && jetzt.laeuft_ab - VORLAUF_S > Date.now()/1000) return jetzt.access_token;
        const neu = await tokenAnfrage("refresh_token", {refresh_token: (jetzt ?? s).refresh_token});
        schreiben({...neu, email: neu.email ?? s.email});
        return neu.access_token;
      }catch(e){
        // Nur eine ausdrückliche Ablehnung beendet die Sitzung, kein Netzfehler.
        if(e.status === 400 || e.status === 401) schreiben(null);
        return null;
      }finally{
        laufend = null;
      }
    })();
    return laufend;
  }

  /* Aufruf einer Edge Function mit der Anmeldung. Bei 401 wird abgemeldet. */
  async function rufen(funktion, rumpf){
    const t = await token();
    if(!t){
      // Abgemeldet (401) oder Sitzung da, aber Erneuerung gerade nicht erreichbar (0).
      const drin = !!lesen();
      const e = new Error(drin ? "Keine Verbindung." : "Nicht angemeldet.");
      e.status = drin ? 0 : 401;
      throw e;
    }
    // Ein Blob (Aufnahme) geht roh, alles andere als JSON.
    const roh = rumpf instanceof Blob;
    const antwort = await fetch(`${SUPABASE}/functions/v1/${funktion}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${t}`, "apikey": SCHLUESSEL,
        "Content-Type": roh ? (rumpf.type || "application/octet-stream") : "application/json"
      },
      body: roh ? rumpf : JSON.stringify(rumpf)
    });
    if(antwort.status === 401) schreiben(null);
    if(!antwort.ok){
      const daten = await antwort.json().catch(() => ({}));
      const e = new Error(daten.fehler || `HTTP ${antwort.status}`);
      e.status = antwort.status;
      throw e;
    }
    return antwort;
  }

  return {
    anmelden, abmelden, token, rufen, mitMicrosoft, einloesen,
    angemeldet: () => !!lesen(),
    email: () => lesen()?.email ?? null,
    beiAenderung: fn => hoerer.add(fn)
  };
})();
