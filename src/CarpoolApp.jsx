import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "./supabaseClient.js";

// ── Design tokens ─────────────────────────────────────────────
// ── Brand (Ice Vision Solutions) ──────────────────────────────
// Colors sampled from the IVS logo: royal blue, ice-teal, deep navy.
const BRAND = { blue: "#4070e5", blueDeep: "#2f57c4", teal: "#6cd0d8", tealDeep: "#3aa6b0", navy: "#173f5f" };

function makeTheme(dark) {
  if (dark) return {
    ink: "#eef4fb", slate: "#c4d2e2", fog: "#8fa2b8", line: "#2b3a4d",
    paper: "#0f1826", card: "#172233", lane: BRAND.teal, laneDeep: BRAND.tealDeep,
    go: BRAND.blue, goSoft: "#1c2c46", today: "#1a2942",
    warn: "#e08a7a", warnSoft: "#3a2622", tentative: "#d8b46a",
    brand: BRAND.blue, brandDeep: BRAND.blueDeep, teal: BRAND.teal, navy: BRAND.navy,
  };
  return {
    ink: "#14212e", slate: "#3a4b5c", fog: "#6b7d8f", line: "#dbe6f0",
    paper: "#f2f7fc", card: "#ffffff", lane: BRAND.teal, laneDeep: BRAND.tealDeep,
    go: BRAND.blue, goSoft: "#e9f0fd", today: "#e6f0fb",
    warn: "#c15b47", warnSoft: "#fbecea", tentative: "#9a6b12",
    brand: BRAND.blue, brandDeep: BRAND.blueDeep, teal: BRAND.teal, navy: BRAND.navy,
  };
}
const FAMILY_COLORS = [
  "#3b6fb0", "#c15b47", "#4f9d69", "#8a5cb0",
  "#c98f16", "#3f9aa3", "#b0567f", "#6b7280",
];

// The shared password. Change this to whatever you want, then re-deploy.
const SHARED_PASSWORD = "esteem";
// Row id in the Supabase table that holds the whole shared calendar.
const DOC_ID = "main";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const uid = () => Math.random().toString(36).slice(2, 9);
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const parse = (s) => new Date(s + "T00:00:00");

export default function CarpoolApp() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("ivs_dark") === "1"; } catch { return false; }
  });
  const C = makeTheme(dark);
  const S = makeStyles(C);
  const toggleDark = () => { setDark((d) => { const n = !d; try { localStorage.setItem("ivs_dark", n ? "1" : "0"); } catch {} return n; }); };
  useEffect(() => {
    try { document.body.style.background = C.paper; } catch {}
  }, [C.paper]);

  // ── Password gate (per-device) ───────────────────────────────
  // "Remember me" stores unlock on THIS device only (localStorage).
  // It never affects anyone else — each person decides for their own phone.
  const [unlocked, setUnlocked] = useState(() => {
    try { return localStorage.getItem("ivs_remember") === "1"; } catch { return false; }
  });
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState(false);
  const [remember, setRemember] = useState(true);
  const tryUnlock = () => {
    if (pw === SHARED_PASSWORD) {
      setUnlocked(true); setPwError(false);
      try {
        if (remember) localStorage.setItem("ivs_remember", "1");
        else localStorage.removeItem("ivs_remember");
      } catch {}
    } else { setPwError(true); }
  };
  const forgetDevice = () => {
    try { localStorage.removeItem("ivs_remember"); } catch {}
    setUnlocked(false); setPw("");
  };

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connError, setConnError] = useState(false);
  const [data, setData] = useState({ families: [], shifts: [], schoolDaysOnly: true });
  const [me, setMe] = useState(null);
  const [nameInput, setNameInput] = useState("");
  const [driverInput, setDriverInput] = useState("");
  const [seatsInput, setSeatsInput] = useState("");
  const [vehNameInput, setVehNameInput] = useState("");
  const [vehSeatsInput, setVehSeatsInput] = useState("");
  const [memberInput, setMemberInput] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  const now = new Date();
  const [view, setView] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [tab, setTab] = useState("calendar");
  const [viewDate, setViewDate] = useState(null);
  const [editDate, setEditDate] = useState(null);
  const [draft, setDraft] = useState(null);

  // ── Shared state via Supabase ────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { data: row, error } = await supabase
        .from("carpool").select("payload").eq("id", DOC_ID).maybeSingle();
      if (error) throw error;
      if (row && row.payload) setData((prev) => ({ ...prev, ...row.payload }));
      setConnError(false);
    } catch (e) {
      console.error("Load failed:", e);
      setConnError(true);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates: refresh when anyone else saves, plus a slow poll as backup.
  useEffect(() => {
    const channel = supabase
      .channel("carpool-changes")
      .on("postgres_changes",
        { event: "*", schema: "public", table: "carpool", filter: `id=eq.${DOC_ID}` },
        (payload) => { if (payload.new && payload.new.payload) setData((p) => ({ ...p, ...payload.new.payload })); }
      )
      .subscribe();
    const t = setInterval(load, 8000);
    return () => { supabase.removeChannel(channel); clearInterval(t); };
  }, [load]);

  const persist = async (next) => {
    setData(next); setSaving(true);
    try {
      const { error } = await supabase
        .from("carpool")
        .upsert({ id: DOC_ID, payload: next, updated_at: new Date().toISOString() });
      if (error) throw error;
      setConnError(false);
    } catch (e) {
      console.error("Save failed:", e);
      setConnError(true);
    } finally { setTimeout(() => setSaving(false), 400); }
  };

  // ── Families ───────────────────────────────────────────────
  const addFamily = async () => {
    const family = nameInput.trim();
    if (!family) return;
    const id = uid();
    const color = FAMILY_COLORS[data.families.length % FAMILY_COLORS.length];
    const seats = Math.max(0, parseInt(seatsInput, 10) || 0);
    // If they gave a seat count up front, seed one starter vehicle.
    const vehicles = seats > 0 ? [{ id: uid(), name: "Car", seats }] : [];
    await persist({ ...data, families: [...data.families, { id, family, driver: driverInput.trim(), color, vehicles }] });
    setMe(id); setNameInput(""); setDriverInput(""); setSeatsInput("");
  };
  const removeFamily = async (id) => {
    const next = {
      ...data,
      families: data.families.filter((f) => f.id !== id),
      shifts: data.shifts.filter((s) => s.familyId !== id),
    };
    if (me === id) setMe(null);
    await persist(next);
  };

  // Vehicles belong to a family; older data may only have a `seats` number.
  const vehiclesOf = (fam) => {
    if (!fam) return [];
    if (Array.isArray(fam.vehicles)) return fam.vehicles;
    if (fam.seats > 0) return [{ id: "legacy", name: "Car", seats: fam.seats }];
    return [];
  };
  const addVehicle = async () => {
    if (!me) return;
    const name = vehNameInput.trim();
    if (!name) return;
    const seats = Math.max(0, parseInt(vehSeatsInput, 10) || 0);
    const next = {
      ...data,
      families: data.families.map((f) => f.id === me
        ? { ...f, vehicles: [...vehiclesOf(f), { id: uid(), name, seats }] }
        : f),
    };
    await persist(next);
    setVehNameInput(""); setVehSeatsInput("");
  };
  const removeVehicle = async (vehId) => {
    const next = {
      ...data,
      families: data.families.map((f) => f.id === me
        ? { ...f, vehicles: vehiclesOf(f).filter((v) => v.id !== vehId) }
        : f),
      // Clear that vehicle from any of this family's shifts
      shifts: data.shifts.map((s) => (s.familyId === me && s.vehicleId === vehId) ? { ...s, vehicleId: null } : s),
    };
    await persist(next);
  };
  const vehicleById = (fam, vehId) => vehiclesOf(fam).find((v) => v.id === vehId);

  // Family members (the kids who ride). Older data may not have any.
  const membersOf = (fam) => (fam && Array.isArray(fam.members)) ? fam.members : [];
  const addMember = async () => {
    if (!me) return;
    const name = memberInput.trim();
    if (!name) return;
    const next = {
      ...data,
      families: data.families.map((f) => f.id === me
        ? { ...f, members: [...membersOf(f), { id: uid(), name }] }
        : f),
    };
    await persist(next);
    setMemberInput("");
  };
  const removeMember = async (memId) => {
    const next = {
      ...data,
      families: data.families.map((f) => f.id === me
        ? { ...f, members: membersOf(f).filter((m) => m.id !== memId) }
        : f),
      // Remove that member from any shifts' rider lists
      shifts: data.shifts.map((s) => (s.familyId === me && Array.isArray(s.riders))
        ? { ...s, riders: s.riders.filter((r) => r !== memId) } : s),
    };
    await persist(next);
  };
  const memberById = (fam, memId) => membersOf(fam).find((m) => m.id === memId);
  const familyById = (id) => data.families.find((f) => f.id === id);
  const activeFamily = me ? familyById(me) : null;

  // ── Shift lookups ──────────────────────────────────────────
  const shiftsOn = useCallback((dateStr) => {
    const wd = parse(dateStr).getDay();
    return data.shifts.filter((s) =>
      (s.type === "single" && s.date === dateStr) ||
      (s.type === "weekly" && s.weekday === wd)
    );
  }, [data.shifts]);
  const myShiftOn = (dateStr) => shiftsOn(dateStr).find((s) => s.familyId === me);

  // ── Editor ─────────────────────────────────────────────────
  // Clicking a calendar date opens a read-only summary first.
  const openDay = (dateStr) => { setViewDate(dateStr); };
  // Opening the fill-out editor (from the summary, or the coverage/my-days lists).
  const openEditor = (dateStr) => {
    if (!me) { setTab("calendar"); setViewDate(dateStr); return; }
    const wd = parse(dateStr).getDay();
    const existing = myShiftOn(dateStr);
    setViewDate(null);
    setEditDate(dateStr);
    setDraft(existing ? { ...existing, riders: existing.riders || [] }
      : { type: "single", pickup: false, pickupTime: "", dropoff: false, dropoffTime: "", note: "", confirmed: false, vehicleId: null, riders: [], weekday: wd });
  };
  const setD = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const clearMineFor = (dateStr, list) => {
    const wd = parse(dateStr).getDay();
    return list.filter((s) => {
      if (s.familyId !== me) return true;
      if (s.type === "single" && s.date === dateStr) return false;
      if (s.type === "weekly" && s.weekday === wd) return false;
      return true;
    });
  };
  const saveShift = async () => {
    if (!me || !editDate || !draft) return;
    const kept = clearMineFor(editDate, data.shifts);
    if (!draft.pickup && !draft.dropoff) {
      await persist({ ...data, shifts: kept }); setEditDate(null); return;
    }
    const wd = parse(editDate).getDay();
    const base = {
      id: uid(), familyId: me,
      pickup: draft.pickup, pickupTime: draft.pickupTime.trim(),
      dropoff: draft.dropoff, dropoffTime: draft.dropoffTime.trim(),
      note: draft.note.trim(), confirmed: !!draft.confirmed, vehicleId: draft.vehicleId || null, riders: draft.riders || [],
    };
    const shift = draft.type === "weekly"
      ? { ...base, type: "weekly", weekday: wd }
      : { ...base, type: "single", date: editDate };
    await persist({ ...data, shifts: [...kept, shift] });
    setEditDate(null);
  };
  const removeMine = async () => {
    if (!me || !editDate) return;
    await persist({ ...data, shifts: clearMineFor(editDate, data.shifts) });
    setEditDate(null);
  };
  const toggleConfirm = async (shiftId) => {
    const next = data.shifts.map((s) => s.id === shiftId ? { ...s, confirmed: !s.confirmed } : s);
    await persist({ ...data, shifts: next });
  };

  // ── Calendar grid ──────────────────────────────────────────
  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const startPad = first.getDay();
    const dim = new Date(view.y, view.m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= dim; d++) cells.push(new Date(view.y, view.m, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [view]);
  const shiftMonth = (delta) => {
    let m = view.m + delta, y = view.y;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setView({ y, m }); setEditDate(null);
  };
  const goToday = () => { setView({ y: now.getFullYear(), m: now.getMonth() }); setEditDate(null); };
  const todayStr = ymd(new Date());
  const isSchoolDay = (date) => { const d = date.getDay(); return d >= 1 && d <= 5; };

  const uncovered = useMemo(() => grid.filter(Boolean).filter((date) => {
    if (data.schoolDaysOnly && !isSchoolDay(date)) return false;
    return shiftsOn(ymd(date)).length === 0;
  }), [grid, data.schoolDaysOnly, shiftsOn]);

  const myList = useMemo(() => {
    if (!me) return [];
    const out = [];
    grid.filter(Boolean).forEach((date) => {
      const ds = ymd(date);
      const s = shiftsOn(ds).find((x) => x.familyId === me);
      if (s) out.push({ date: ds, shift: s });
    });
    return out;
  }, [grid, me, shiftsOn]);

  const legs = (s) => {
    const p = [];
    if (s.pickup) p.push(`P${s.pickupTime ? " " + s.pickupTime : ""}`);
    if (s.dropoff) p.push(`D${s.dropoffTime ? " " + s.dropoffTime : ""}`);
    return p.join(" · ");
  };

  const exportText = () => {
    const lines = [`Carpool schedule — ${MONTHS[view.m]} ${view.y}`, ""];
    grid.filter(Boolean).forEach((date) => {
      const ds = ymd(date);
      const list = shiftsOn(ds);
      if (!list.length) return;
      lines.push(parse(ds).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }));
      list.forEach((s) => {
        const fam = familyById(s.familyId);
        const bits = legs(s);
        const v = vehicleById(fam, s.vehicleId);
        lines.push(`  • ${fam ? fam.family : "?"}${bits ? " — " + bits : ""}${v ? ` [${v.name}${v.seats > 0 ? ", " + v.seats + " seats" : ""}]` : ""}${s.confirmed ? " ✓confirmed" : " (tentative)"}${s.type === "weekly" ? " [weekly]" : ""}${s.note ? "\n      note: " + s.note : ""}`);
      });
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `carpool-${view.y}-${String(view.m+1).padStart(2,"0")}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  const [invited, setInvited] = useState(false);
  const shareInvite = async () => {
    const link = window.location.origin + window.location.pathname;
    const text = `Join our IVS Carpool calendar:\n${link}\nPassword: ${SHARED_PASSWORD}`;
    try {
      if (navigator.share) { await navigator.share({ title: "IVS Carpool", text }); return; }
      await navigator.clipboard.writeText(text);
      setInvited(true); setTimeout(() => setInvited(false), 2200);
    } catch (e) {
      try { await navigator.clipboard.writeText(text); setInvited(true); setTimeout(() => setInvited(false), 2200); } catch {}
    }
  };

  // ── Password screen ──────────────────────────────────────────
  if (!unlocked) {
    return (
      <div style={{ ...S.wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ ...S.panel, maxWidth: 380, width: "100%", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <img src="/logo.png" alt="Ice Vision Solutions" width={96} height={96}
              style={{ borderRadius: 20, boxShadow: "0 6px 20px rgba(23,63,95,0.25)" }} />
          </div>
          <h1 style={{ margin: "0 0 2px", fontSize: 24, fontWeight: 800, color: C.ink }}>IVS Carpool</h1>
          <p style={{ color: C.brand, margin: "0 0 14px", fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em" }}>ICE VISION SOLUTIONS</p>
          <p style={{ color: C.fog, margin: "0 0 18px", fontSize: 14 }}>Enter the shared password to open the calendar.</p>
          <input type="password" value={pw} autoFocus
            onChange={(e) => { setPw(e.target.value); setPwError(false); }}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Password"
            style={{ ...S.input, width: "100%", boxSizing: "border-box", marginBottom: 10, textAlign: "center" }} />
          {pwError && <p style={{ color: C.warn, fontSize: 13, margin: "0 0 10px" }}>That password didn't match. Try again.</p>}
          <label style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center", cursor: "pointer", margin: "0 0 14px", color: C.slate, fontSize: 14 }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device
          </label>
          <button onClick={tryUnlock} style={{ ...S.primaryBtn, width: "100%", background: C.go }}>Open calendar</button>
          <p style={{ color: C.fog, fontSize: 11.5, margin: "10px 0 0" }}>
            "Remember me" skips the password next time on <em>this</em> device only. It doesn't change anything for anyone else.
          </p>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div style={{ ...S.wrap, alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <span style={{ color: C.fog }}>Loading the shared calendar…</span>
    </div>;
  }
  const editWd = editDate ? parse(editDate).getDay() : null;

  return (
    <div style={S.wrap}>
      <style>{`
        .cp-day { transition: background .12s ease; cursor: pointer; }
        .cp-day:hover { background: ${C.paper}; }
        .cp-btn:active { transform: translateY(1px); }
        input:focus, textarea:focus, button:focus-visible { outline: 2px solid ${C.slate}; outline-offset: 2px; }
        @media (max-width: 640px) {
          .cp-cal { gap: 3px !important; padding: 4px !important; }
          .cp-daynum { font-size: 12px !important; }
          .cp-legs { flex-direction: column !important; }
          .cp-hidewrap { flex-wrap: wrap; }
        }
      `}</style>

      <header style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <img src="/logo.png" alt="Ice Vision Solutions" width={44} height={44}
            style={{ borderRadius: 11, boxShadow: "0 2px 8px rgba(23,63,95,0.2)", flexShrink: 0 }} />
          <div style={{ lineHeight: 1.1 }}>
            <h1 style={{ margin: 0, fontSize: 27, letterSpacing: "-0.02em", color: C.ink, fontWeight: 800 }}>IVS Carpool</h1>
            <span style={{ fontSize: 11, color: C.brand, fontWeight: 700, letterSpacing: ".05em" }}>ICE VISION SOLUTIONS</span>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            <button className="cp-btn" onClick={toggleDark} title="Toggle dark mode"
              style={{ ...S.navBtnSm, padding: "6px 10px" }}>{dark ? "☀️ Light" : "🌙 Dark"}</button>
            <span style={{ fontSize: 12, color: connError ? C.warn : saving ? C.go : C.fog, transition: "color .2s" }}>
              {connError ? "Can't reach the server" : saving ? "Saving…" : "All changes shared"}
            </span>
          </div>
        </div>
        <p style={{ margin: "10px 0 0", color: C.fog, fontSize: 15 }}>
          One shared month. Tap a day to set pickup, dropoff, or both — for that day or every week.
        </p>
      </header>

      {/* How-to banner — makes the selected family explicit */}
      <div style={{ ...S.howTo, borderColor: activeFamily ? (activeFamily.color) : C.brand,
        background: activeFamily ? C.goSoft : C.today }}>
        {activeFamily ? (
          <span>
            You're editing as <strong style={{ color: C.ink }}>{activeFamily.family}</strong>. Any day you add or change is saved under this family. Switch families with the buttons below.
          </span>
        ) : (
          <span>
            <strong style={{ color: C.ink }}>Start by selecting your family below</strong> (or add a new one). Whichever family is highlighted is the one you're adding or editing carpool days for.
          </span>
        )}
      </div>

      <section style={{ ...S.panel, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={S.eyebrow}>Driving as</div>
            {activeFamily ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ ...S.dot, background: activeFamily.color }} />
                <strong style={{ color: C.ink, fontSize: 17 }}>{activeFamily.family}</strong>
                {activeFamily.driver && <span style={{ color: C.fog }}>· {activeFamily.driver}</span>}
                {vehiclesOf(activeFamily).length > 0 && (
                  <span style={S.seatTag}>{vehiclesOf(activeFamily).length} {vehiclesOf(activeFamily).length === 1 ? "car" : "cars"}</span>
                )}
              </div>
            ) : <span style={{ color: C.fog }}>Pick your family, or add a new one below.</span>}
          </div>
          {data.families.length > 0 && (
            <div className="cp-hidewrap" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {data.families.map((f) => (
                <div key={f.id} style={{ display: "flex", alignItems: "center" }}>
                  <button className="cp-btn" onClick={() => { setMe(f.id); setEditDate(null); setShowSetup(false); }}
                    style={{ ...S.chip, borderColor: me === f.id ? f.color : C.line,
                      background: me === f.id ? f.color : C.card, color: me === f.id ? "#fff" : C.slate }}>
                    <span style={{ ...S.dot, background: me === f.id ? "#fff" : f.color }} />
                    {f.family}
                  </button>
                  {me === f.id && (
                    <button title="Remove this family" className="cp-btn"
                      onClick={() => { if (confirm(`Remove ${f.family} and all their driving days?`)) removeFamily(f.id); }}
                      style={S.xBtn}>×</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Add-family form: shown when no family is selected, or when explicitly adding */}
        {(!activeFamily || showSetup) && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <input value={nameInput} onChange={(e) => setNameInput(e.target.value)}
              placeholder="New family name (e.g. The Jacksons)" style={{ ...S.input, flex: "2 1 180px" }} />
            <input value={driverInput} onChange={(e) => setDriverInput(e.target.value)}
              placeholder="Driver (optional)" style={{ ...S.input, flex: "1 1 130px" }} />
            <button className="cp-btn" onClick={addFamily} style={S.primaryBtn}>Add family</button>
          </div>
        )}

        {/* When a family is selected: one clean toggle for their setup */}
        {activeFamily && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <button className="cp-btn" onClick={() => setShowSetup((v) => !v)}
              style={{ ...S.navBtnSm, background: showSetup ? C.goSoft : C.card, color: showSetup ? C.go : C.slate, borderColor: showSetup ? C.go : C.line }}>
              {showSetup ? "✓ Done editing family" : "⚙️ Manage cars & riders"}
            </button>
          </div>
        )}
      </section>

      {/* Garage — vehicles + riders for the active family (collapsible) */}
      {activeFamily && showSetup && (
        <section style={{ ...S.panel, marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={S.eyebrow}>{activeFamily.family}'s cars</div>
            <span style={{ color: C.fog, fontSize: 12.5 }}>
              Add each vehicle you might drive — you'll pick one per day.
            </span>
          </div>
          {vehiclesOf(activeFamily).length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {vehiclesOf(activeFamily).map((v) => (
                <div key={v.id} style={S.vehTag}>
                  <span style={{ fontWeight: 700, color: C.ink }}>{v.name}</span>
                  <span style={{ color: C.fog, fontSize: 12.5 }}>{v.seats > 0 ? `${v.seats} seats` : "seats n/a"}</span>
                  <button title="Remove car" className="cp-btn"
                    onClick={() => { if (confirm(`Remove ${v.name}?`)) removeVehicle(v.id); }}
                    style={S.vehX}>×</button>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: C.fog, fontSize: 13, margin: "0 0 12px" }}>No cars yet. Add one below.</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={vehNameInput} onChange={(e) => setVehNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addVehicle()}
              placeholder="Car name (e.g. Blue Van, Grandpa's SUV)" style={{ ...S.input, flex: "2 1 200px" }} />
            <input value={vehSeatsInput} onChange={(e) => setVehSeatsInput(e.target.value)} type="number" min="0"
              onKeyDown={(e) => e.key === "Enter" && addVehicle()}
              placeholder="Seats" style={{ ...S.input, flex: "0 1 90px" }} />
            <button className="cp-btn" onClick={addVehicle} style={{ ...S.primaryBtn, background: C.go }}>Add car</button>
          </div>

          {/* Family members / kids in the carpool */}
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={S.eyebrow}>{activeFamily.family}'s riders</div>
              <span style={{ color: C.fog, fontSize: 12.5 }}>Add each kid — you'll pick who's riding on each day.</span>
            </div>
            {membersOf(activeFamily).length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {membersOf(activeFamily).map((m) => (
                  <div key={m.id} style={S.vehTag}>
                    <span style={{ fontWeight: 700, color: C.ink }}>{m.name}</span>
                    <button title="Remove rider" className="cp-btn"
                      onClick={() => { if (confirm(`Remove ${m.name}?`)) removeMember(m.id); }} style={S.vehX}>×</button>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: C.fog, fontSize: 13, margin: "0 0 12px" }}>No riders added yet.</p>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={memberInput} onChange={(e) => setMemberInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addMember()}
                placeholder="Child's name (e.g. Maya)" style={{ ...S.input, flex: "2 1 200px" }} />
              <button className="cp-btn" onClick={addMember} style={{ ...S.primaryBtn, background: C.go }}>Add rider</button>
            </div>
          </div>
        </section>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={S.tabRow}>
          {[
            { k: "calendar", t: "Calendar" },
            { k: "coverage", t: `Coverage${uncovered.length ? ` · ${uncovered.length}` : ""}` },
            { k: "mine", t: "My days" },
          ].map((x) => (
            <button key={x.k} className="cp-btn" onClick={() => setTab(x.k)}
              style={{ ...S.tabBtn, background: tab === x.k ? C.brand : "transparent", color: tab === x.k ? "#fff" : C.slate }}>
              {x.t}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="cp-btn" onClick={goToday} style={S.navBtnSm}>Today</button>
          <button className="cp-btn" onClick={exportText} style={S.navBtnSm}>Export</button>
          <button className="cp-btn" onClick={shareInvite}
            style={{ ...S.navBtnSm, background: invited ? C.goSoft : C.card, color: invited ? C.go : C.slate, borderColor: invited ? C.go : C.line }}>
            {invited ? "Copied ✓" : "Invite"}
          </button>
          <button className="cp-btn" onClick={forgetDevice} title="Require the password again on this device"
            style={{ ...S.navBtnSm }}>
            🔒 Lock this device
          </button>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <button className="cp-btn" onClick={() => shiftMonth(-1)} style={S.navBtn}>‹ Prev</button>
        <h2 style={{ margin: 0, fontSize: 20, color: C.ink, fontWeight: 800 }}>{MONTHS[view.m]} {view.y}</h2>
        <button className="cp-btn" onClick={() => shiftMonth(1)} style={S.navBtn}>Next ›</button>
      </div>

      {tab === "calendar" && (
        <>
          <div className="cp-cal" style={S.cal}>
            {WD.map((d) => <div key={d} style={S.wdHead}>{d}</div>)}
            {grid.map((date, i) => {
              if (!date) return <div key={i} style={{ ...S.dayCell, background: C.paper, cursor: "default" }} />;
              const ds = ymd(date);
              const list = shiftsOn(ds);
              const mine = myShiftOn(ds);
              const isToday = ds === todayStr;
              const gap = list.length === 0 && (!data.schoolDaysOnly || isSchoolDay(date));
              return (
                <div key={i} className="cp-day" onClick={() => openDay(ds)}
                  style={{ ...S.dayCell,
                    background: isToday ? C.today : gap ? C.warnSoft : C.card,
                    boxShadow: mine ? `inset 0 0 0 2px ${activeFamily?.color || C.lane}` : "none" }}>
                  <div className="cp-daynum" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: isToday ? 800 : 600, fontSize: 13, color: isToday ? C.ink : C.slate }}>{date.getDate()}</span>
                    {gap && <span title="No driver yet" style={S.gapDot} />}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {list.slice(0, 5).map((s) => {
                      const fam = familyById(s.familyId);
                      if (!fam) return null;
                      const summary = legs(s);
                      const tip = `${fam.family}${summary ? " — " + summary : ""}${s.confirmed ? " (confirmed)" : " (tentative)"}${s.type === "weekly" ? " [weekly]" : ""}${s.note ? "\nNote: " + s.note : ""}`;
                      return (
                        <div key={s.id} title={tip}
                          style={{ ...S.pill, background: fam.color, opacity: s.confirmed ? 1 : 0.62,
                            border: s.confirmed ? "1px solid rgba(255,255,255,.5)" : "1px dashed rgba(255,255,255,.7)" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {s.confirmed ? "✓ " : ""}{fam.family}{summary ? ` · ${summary}` : ""}
                          </span>
                          {s.note && <span style={S.miniTag}>✎</span>}
                          {s.type === "weekly" && <span style={S.miniTag}>↻</span>}
                        </div>
                      );
                    })}
                    {list.length > 5 && <span style={{ fontSize: 10.5, color: C.fog }}>+{list.length - 5} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={S.legendRow}>
            <span><strong style={{ color: C.slate }}>P</strong> pickup</span>
            <span><strong style={{ color: C.slate }}>D</strong> dropoff</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>✓ confirmed · <em style={{ opacity: .7 }}>dashed = tentative</em></span>
            <span><span style={S.miniTagInline}>↻</span> weekly</span>
            <span><span style={S.miniTagInline}>✎</span> note</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={S.gapDotInline} /> no driver</span>
            <label style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={data.schoolDaysOnly}
                onChange={(e) => persist({ ...data, schoolDaysOnly: e.target.checked })} />
              Flag weekdays only
            </label>
          </div>
        </>
      )}

      {tab === "coverage" && (
        <section style={S.panel}>
          {uncovered.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.go }}>Every day is covered</div>
              <p style={{ color: C.fog, margin: "6px 0 0" }}>No open {data.schoolDaysOnly ? "weekdays" : "days"} left in {MONTHS[view.m]}.</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
                {uncovered.length} {data.schoolDaysOnly ? "weekday" : "day"}{uncovered.length > 1 ? "s" : ""} still need a driver
              </div>
              <p style={{ color: C.fog, fontSize: 13, margin: "0 0 14px" }}>Tap one to sign up.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {uncovered.map((date) => {
                  const ds = ymd(date);
                  return (
                    <button key={ds} className="cp-btn" onClick={() => { setTab("calendar"); openEditor(ds); }} style={S.coverRow}>
                      <span style={{ fontWeight: 700, color: C.ink }}>
                        {date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                      </span>
                      <span style={{ marginLeft: "auto", color: C.warn, fontWeight: 700, fontSize: 13 }}>Open →</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {tab === "mine" && (
        <section style={S.panel}>
          {!me ? (
            <p style={{ color: C.fog, textAlign: "center", padding: "20px 0" }}>Pick your family above to see your days.</p>
          ) : myList.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 8px" }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>No driving days yet this month</div>
              <p style={{ color: C.fog, margin: "6px 0 0" }}>Head to the calendar and tap a day to sign up.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {myList.map(({ date, shift }) => (
                <div key={shift.id + date} style={S.mineRow}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, color: C.ink }}>
                      {parse(date).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                      {shift.type === "weekly" && <span style={{ ...S.miniTagInline, marginLeft: 6 }}>↻</span>}
                    </span>
                    <span style={{ fontSize: 13, color: C.fog }}>{legs(shift) || "No legs set"}{shift.note ? ` — ${shift.note}` : ""}</span>
                  </div>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="cp-btn" onClick={() => toggleConfirm(shift.id)}
                      style={{ ...S.statusBtn, background: shift.confirmed ? C.goSoft : "#fff",
                        color: shift.confirmed ? C.go : C.tentative, borderColor: shift.confirmed ? C.go : C.line }}>
                      {shift.confirmed ? "✓ Confirmed" : "Tentative"}
                    </button>
                    <button className="cp-btn" onClick={() => { setTab("calendar"); openEditor(date); }} style={S.editSmall}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Read-only day summary (opens first when you tap a date) */}
      {viewDate && !editDate && (() => {
        const list = shiftsOn(viewDate);
        const mineHere = list.find((s) => s.familyId === me);
        return (
          <div style={S.overlay} onClick={() => setViewDate(null)}>
            <div style={S.modal} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, color: C.fog, fontWeight: 600 }}>Schedule for</div>
                  <h3 style={{ margin: "2px 0 0", fontSize: 19, color: C.ink }}>
                    {parse(viewDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                  </h3>
                </div>
                <button className="cp-btn" onClick={() => setViewDate(null)} style={S.xBtn} title="Close">×</button>
              </div>

              <div style={{ margin: "16px 0" }}>
                {list.length === 0 ? (
                  <div style={{ background: C.warnSoft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "14px 16px" }}>
                    <div style={{ fontWeight: 700, color: C.warn }}>No driver yet</div>
                    <p style={{ margin: "4px 0 0", color: C.fog, fontSize: 13 }}>Nobody has signed up for this day.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {list.map((s) => {
                      const fam = familyById(s.familyId);
                      if (!fam) return null;
                      const summary = legs(s);
                      return (
                        <div key={s.id} style={{ border: `1px solid ${C.line}`, borderLeft: `4px solid ${fam.color}`, borderRadius: 10, padding: "10px 12px", background: C.card }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <strong style={{ color: C.ink }}>{fam.family}</strong>
                            {fam.driver && <span style={{ color: C.fog, fontSize: 13 }}>· {fam.driver}</span>}
                            <span style={{ marginLeft: "auto", ...S.statusPill,
                              background: s.confirmed ? C.goSoft : "#fff", color: s.confirmed ? C.go : C.tentative,
                              border: `1px solid ${s.confirmed ? C.go : C.line}` }}>
                              {s.confirmed ? "✓ Confirmed" : "Tentative"}
                            </span>
                          </div>
                          <div style={{ marginTop: 6, fontSize: 13.5, color: C.slate }}>
                            {summary ? summary.replace(/\bP\b/g, "Pickup").replace(/\bD\b/g, "Dropoff") : "No pickup/dropoff set"}
                            {s.type === "weekly" && <span style={{ ...S.miniTagInline, marginLeft: 6 }} title="Repeats weekly">↻ weekly</span>}
                          </div>
                          {(() => { const v = vehicleById(fam, s.vehicleId); return v ? (
                            <div style={{ marginTop: 4, fontSize: 13, color: C.fog }}>
                              🚗 {v.name}{v.seats > 0 ? ` · ${v.seats} seats` : ""}
                            </div>
                          ) : null; })()}
                          {Array.isArray(s.riders) && s.riders.length > 0 && (
                            <div style={{ marginTop: 4, fontSize: 13, color: C.slate }}>
                              🎒 {s.riders.map((rid) => { const m = memberById(fam, rid); return m ? m.name : null; }).filter(Boolean).join(", ")}
                            </div>
                          )}
                          {s.note && <div style={{ marginTop: 6, fontSize: 13, color: C.fog, fontStyle: "italic" }}>“{s.note}”</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <button className="cp-btn" onClick={() => openEditor(viewDate)} style={{ ...S.primaryBtn, width: "100%", background: C.go }}>
                {!me ? "Pick your family to sign up" : mineHere ? "Edit my day" : "Add my day"}
              </button>
            </div>
          </div>
        );
      })()}

      {editDate && draft && (
        <div style={S.overlay} onClick={() => setEditDate(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 12, color: C.fog, fontWeight: 600 }}>
              {activeFamily ? `${activeFamily.family} can drive on` : "You can drive on"}
            </div>
            <h3 style={{ margin: "2px 0 16px", fontSize: 19, color: C.ink }}>
              {parse(editDate).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </h3>

            <div className="cp-legs" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
              {[
                { key: "pickup", timeKey: "pickupTime", label: "Pickup", ph: "e.g. 7:45 AM" },
                { key: "dropoff", timeKey: "dropoffTime", label: "Dropoff", ph: "e.g. 3:30 PM" },
              ].map((leg) => {
                const on = draft[leg.key];
                return (
                  <div key={leg.key} onClick={() => setD({ [leg.key]: !on })}
                    style={{ ...S.legBox, borderColor: on ? C.go : C.line, background: on ? C.goSoft : C.card }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ ...S.checkbox, borderColor: on ? C.go : C.fog, background: on ? C.go : "#fff" }}>
                        {on && <span style={{ color: "#fff", fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </span>
                      <strong style={{ color: C.ink, fontSize: 15 }}>{leg.label}</strong>
                    </div>
                    <input value={draft[leg.timeKey]} onClick={(e) => e.stopPropagation()}
                      onFocus={() => { if (!on) setD({ [leg.key]: true }); }}
                      onChange={(e) => setD({ [leg.timeKey]: e.target.value })}
                      placeholder={leg.ph}
                      style={{ ...S.input, width: "100%", marginTop: 10, fontSize: 13, padding: "8px 10px", boxSizing: "border-box" }} />
                  </div>
                );
              })}
            </div>

            {vehiclesOf(activeFamily).length > 0 && (
              <>
                <label style={S.fieldLabel}>Which car?</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {vehiclesOf(activeFamily).map((v) => {
                    const on = draft.vehicleId === v.id;
                    return (
                      <button key={v.id} className="cp-btn" onClick={() => setD({ vehicleId: on ? null : v.id })}
                        style={{ ...S.vehPick, borderColor: on ? C.go : C.line, background: on ? C.goSoft : C.card }}>
                        <span style={{ fontWeight: 700, color: C.ink }}>{v.name}</span>
                        {v.seats > 0 && <span style={{ fontSize: 12, color: C.fog }}>{v.seats} seats</span>}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {membersOf(activeFamily).length > 0 && (
              <>
                <label style={S.fieldLabel}>Who needs the carpool this day?</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                  {membersOf(activeFamily).map((m) => {
                    const on = (draft.riders || []).includes(m.id);
                    return (
                      <button key={m.id} className="cp-btn"
                        onClick={() => setD({ riders: on ? draft.riders.filter((r) => r !== m.id) : [...(draft.riders || []), m.id] })}
                        style={{ ...S.chip, borderColor: on ? C.go : C.line, background: on ? C.goSoft : C.card, color: on ? C.go : C.slate }}>
                        <span style={{ ...S.checkbox, width: 16, height: 16, borderColor: on ? C.go : C.fog, background: on ? C.go : "#fff" }}>
                          {on && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                        </span>
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <label style={S.fieldLabel}>Notes</label>
            <textarea value={draft.note} onChange={(e) => setD({ note: e.target.value })}
              placeholder="Details for the other families — meeting spot, which kids, running late, etc."
              rows={3}
              style={{ ...S.input, width: "100%", marginBottom: 16, resize: "vertical", boxSizing: "border-box", fontFamily: "inherit" }} />

            <label style={S.fieldLabel}>How often?</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {[
                { k: "single", t: "Just this day", s: "One-time" },
                { k: "weekly", t: "Every week", s: `Every ${WD[editWd]}` },
              ].map((o) => (
                <button key={o.k} className="cp-btn" onClick={() => setD({ type: o.k })}
                  style={{ ...S.typeBtn, borderColor: draft.type === o.k ? C.go : C.line,
                    background: draft.type === o.k ? C.goSoft : C.card }}>
                  <span style={{ fontWeight: 700, color: C.ink }}>{o.t}</span>
                  <span style={{ fontSize: 12, color: C.fog }}>{o.s}</span>
                </button>
              ))}
            </div>

            <label onClick={() => setD({ confirmed: !draft.confirmed })} style={S.confirmToggle}>
              <span style={{ ...S.checkbox, borderColor: draft.confirmed ? C.go : C.fog, background: draft.confirmed ? C.go : "#fff" }}>
                {draft.confirmed && <span style={{ color: "#fff", fontSize: 13, fontWeight: 900, lineHeight: 1 }}>✓</span>}
              </span>
              <span>
                <strong style={{ color: C.ink }}>Lock it in</strong>
                <span style={{ color: C.fog, fontSize: 13, display: "block" }}>Confirmed shows solid; tentative shows dashed.</span>
              </span>
            </label>

            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <button className="cp-btn" onClick={saveShift} style={{ ...S.primaryBtn, background: C.go, flex: 1 }}>Save</button>
              {myShiftOn(editDate) && <button className="cp-btn" onClick={removeMine} style={S.removeBtn}>Remove mine</button>}
              <button className="cp-btn" onClick={() => setEditDate(null)} style={S.ghostBtn}>Cancel</button>
            </div>
            {!draft.pickup && !draft.dropoff && (
              <p style={{ margin: "10px 0 0", fontSize: 12, color: C.fog }}>
                Check pickup or dropoff to save. Saving with neither checked clears your slot for this day.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────
function makeStyles(C) {
  const wrap = { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", background: C.paper, color: C.ink, padding: 24, maxWidth: 1080, margin: "0 auto", minHeight: "100%", display: "flex", flexDirection: "column" };
  const laneStrip = { height: 8, flex: "0 1 120px", minWidth: 60, borderRadius: 4, background: `repeating-linear-gradient(90deg, ${C.lane} 0 22px, transparent 22px 40px)` };
  const panel = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18 };
  const howTo = { border: "1.5px solid", borderRadius: 12, padding: "12px 16px", marginBottom: 14, fontSize: 14, color: C.slate, lineHeight: 1.5 };
  const eyebrow = { fontSize: 12, color: C.fog, marginBottom: 4, fontWeight: 600 };
  const seatTag = { fontSize: 11, fontWeight: 700, color: C.slate, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 6, padding: "2px 7px" };
  const vehTag = { display: "flex", alignItems: "center", gap: 8, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px" };
  const vehX = { width: 20, height: 20, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.card, color: C.warn, fontSize: 14, lineHeight: 1, cursor: "pointer", fontWeight: 800 };
  const vehPick = { display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", padding: "8px 12px", borderRadius: 10, border: "1.5px solid", cursor: "pointer", textAlign: "left" };
  const tabRow = { display: "flex", gap: 4, background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: 4 };
  const tabBtn = { border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
  const cal = { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, background: C.line, border: `1px solid ${C.line}`, borderRadius: 12, padding: 6 };
  const wdHead = { textAlign: "center", fontSize: 12, fontWeight: 700, color: C.fog, padding: "6px 0" };
  const dayCell = { background: C.card, borderRadius: 8, minHeight: 132, padding: 8, display: "flex", flexDirection: "column", overflow: "hidden" };
  const pill = { color: "#fff", fontSize: 11.5, fontWeight: 600, padding: "3px 7px", borderRadius: 6, display: "flex", alignItems: "center", gap: 4, lineHeight: 1.35 };
  const miniTag = { fontSize: 11, opacity: 0.95, flexShrink: 0 };
  const miniTagInline = { fontSize: 12, opacity: 0.9 };
  const dot = { width: 10, height: 10, borderRadius: "50%", display: "inline-block", flexShrink: 0 };
  const gapDot = { width: 8, height: 8, borderRadius: "50%", background: C.warn, display: "inline-block" };
  const gapDotInline = { width: 8, height: 8, borderRadius: "50%", background: C.warn, display: "inline-block" };
  const input = { border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 12px", fontSize: 14, color: C.ink, background: C.card, fontFamily: "inherit" };
  const primaryBtn = { background: C.brand, color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  const navBtn = { background: C.card, color: C.slate, border: `1px solid ${C.line}`, borderRadius: 9, padding: "7px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  const navBtnSm = { background: C.card, color: C.slate, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  const chip = { display: "flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999, border: "1.5px solid", fontSize: 13, fontWeight: 700, cursor: "pointer" };
  const xBtn = { marginLeft: 4, width: 22, height: 22, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.card, color: C.warn, fontSize: 15, lineHeight: 1, cursor: "pointer", fontWeight: 800 };
  const legendRow = { marginTop: 12, color: C.fog, fontSize: 12.5, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" };
  const coverRow = { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: C.warnSoft, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer" };
  const mineRow = { display: "flex", alignItems: "center", gap: 10, background: C.paper, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px" };
  const statusBtn = { border: "1px solid", borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
  const statusPill = { borderRadius: 999, padding: "3px 10px", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" };
  const editSmall = { background: C.card, color: C.slate, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
  const overlay = { position: "fixed", inset: 0, background: "rgba(28,34,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 };
  const modal = { background: C.card, borderRadius: 16, padding: 24, width: "100%", maxWidth: 460, boxShadow: "0 20px 50px rgba(0,0,0,0.25)", maxHeight: "90vh", overflowY: "auto" };
  const fieldLabel = { display: "block", fontSize: 13, fontWeight: 700, color: C.slate, marginBottom: 6 };
  const legBox = { flex: 1, border: "1.5px solid", borderRadius: 12, padding: 12, cursor: "pointer" };
  const checkbox = { width: 20, height: 20, borderRadius: 6, border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const typeBtn = { flex: 1, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, border: "1.5px solid", cursor: "pointer", textAlign: "left" };
  const confirmToggle = { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "12px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.paper };
  const removeBtn = { background: C.card, color: "#c15b47", border: "1px solid #e6c3bc", borderRadius: 9, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  const ghostBtn = { background: C.card, color: C.fog, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  return { wrap, laneStrip, panel, howTo, eyebrow, seatTag, vehTag, vehX, vehPick, tabRow, tabBtn, cal, wdHead, dayCell, pill, miniTag, miniTagInline, dot, gapDot, gapDotInline, input, primaryBtn, navBtn, navBtnSm, chip, xBtn, legendRow, coverRow, mineRow, statusBtn, statusPill, editSmall, overlay, modal, fieldLabel, legBox, checkbox, typeBtn, confirmToggle, removeBtn, ghostBtn };
}
