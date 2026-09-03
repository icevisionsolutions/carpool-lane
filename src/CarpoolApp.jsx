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

// Password required to CREATE a new carpool (not to join one). Change if needed.
const CREATE_PASSWORD = "1234";

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

  // ── Carpool gate ─────────────────────────────────────────────
  // Each carpool is its own Supabase row keyed by a slug of its name.
  // People create a new carpool or join an existing one by name + password.
  const slugify = (str) => "cp-" + str.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const [carpoolId, setCarpoolId] = useState(null);   // slug of the active carpool, or null
  const [carpoolName, setCarpoolName] = useState(""); // display name of the active carpool
  const [mode, setMode] = useState("choose");         // choose | create | join
  const [cpNameInput, setCpNameInput] = useState("");
  const [cpPwInput, setCpPwInput] = useState("");
  const [cpAdminInput, setCpAdminInput] = useState("");
  const [gateError, setGateError] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [remember, setRemember] = useState(true);

  // Try to auto-rejoin a remembered carpool on this device.
  const [lastHint, setLastHint] = useState(null); // { name } shortcut for returning users
  useEffect(() => {
    let saved = null, hint = null;
    try { saved = JSON.parse(localStorage.getItem("ivs_carpool") || "null"); } catch {}
    try { hint = JSON.parse(localStorage.getItem("ivs_last") || "null"); } catch {}
    if (saved && saved.id) {
      setCarpoolId(saved.id);
      setCarpoolName(saved.name || "");
    } else if (hint && hint.name) {
      setLastHint(hint);
    }
  }, []);

  const rememberCarpool = (id, name) => {
    try {
      // Always remember the name as a quick-continue hint (not the password).
      localStorage.setItem("ivs_last", JSON.stringify({ name }));
      if (remember) localStorage.setItem("ivs_carpool", JSON.stringify({ id, name }));
      else localStorage.removeItem("ivs_carpool");
    } catch {}
  };

  const createCarpool = async () => {
    const name = cpNameInput.trim();
    const pass = cpPwInput.trim();
    if (cpAdminInput.trim() !== CREATE_PASSWORD) { setGateError("The admin password is incorrect."); return; }
    if (!name) { setGateError("Give your carpool a name."); return; }
    if (pass.length < 3) { setGateError("Choose a password (at least 3 characters)."); return; }
    const id = slugify(name);
    if (!id || id === "cp-") { setGateError("Please use letters or numbers in the name."); return; }
    setGateBusy(true); setGateError("");
    try {
      const { data: existing } = await supabase.from("carpool").select("id").eq("id", id).maybeSingle();
      if (existing) { setGateError("A carpool with that name already exists. Try Join, or pick a different name."); setGateBusy(false); return; }
      const fresh = { name, password: pass, families: [], shifts: [], noRides: [], schoolDaysOnly: true };
      const { error } = await supabase.from("carpool").upsert({ id, payload: fresh, updated_at: new Date().toISOString() });
      if (error) throw error;
      setData(fresh); setCarpoolName(name); setCarpoolId(id);
      rememberCarpool(id, name);
    } catch (e) {
      console.error(e); setGateError("Couldn't create the carpool — check your connection and try again.");
    }
    setGateBusy(false);
  };

  const joinCarpool = async () => {
    const name = cpNameInput.trim();
    const pass = cpPwInput.trim();
    if (!name || !pass) { setGateError("Enter the carpool name and password."); return; }
    const id = slugify(name);
    setGateBusy(true); setGateError("");
    try {
      const { data: row } = await supabase.from("carpool").select("payload").eq("id", id).maybeSingle();
      if (!row || !row.payload) { setGateError("No carpool found with that name. Check the spelling, or Create it."); setGateBusy(false); return; }
      if ((row.payload.password || "") !== pass) { setGateError("That password doesn't match this carpool."); setGateBusy(false); return; }
      setData(row.payload); setCarpoolName(row.payload.name || name); setCarpoolId(id);
      rememberCarpool(id, row.payload.name || name);
    } catch (e) {
      console.error(e); setGateError("Couldn't reach the carpool — check your connection and try again.");
    }
    setGateBusy(false);
  };

  const leaveCarpool = () => {
    try { localStorage.removeItem("ivs_carpool"); } catch {}
    setCarpoolId(null); setCarpoolName(""); setMode("choose");
    setCpNameInput(""); setCpPwInput(""); setGateError("");
    setData({ families: [], shifts: [], noRides: [], schoolDaysOnly: true });
    setMe(null); setLoaded(false);
  };

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connError, setConnError] = useState(false);
  const [data, setData] = useState({ families: [], shifts: [], noRides: [], schoolDaysOnly: true });
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
  const [expandedFam, setExpandedFam] = useState(null); // which other family is expanded in the rider picker
  const [scopeAsk, setScopeAsk] = useState(null); // { action, resolve } for the weekly all/day dialog
  const askWeeklyScope = (action) => new Promise((resolve) => setScopeAsk({ action, resolve }));
  const answerScope = (val) => { if (scopeAsk) scopeAsk.resolve(val); setScopeAsk(null); };

  // ── Shared state via Supabase (scoped to the active carpool) ─
  const load = useCallback(async () => {
    if (!carpoolId) return;
    try {
      const { data: row, error } = await supabase
        .from("carpool").select("payload").eq("id", carpoolId).maybeSingle();
      if (error) throw error;
      if (row && row.payload) {
        setData((prev) => ({ ...prev, ...row.payload }));
        if (row.payload.name) setCarpoolName(row.payload.name);
      } else {
        // Remembered carpool no longer exists — clear it and go back to choose.
        try { localStorage.removeItem("ivs_carpool"); } catch {}
        setCarpoolId(null); setCarpoolName(""); setMode("choose");
        setGateError("That carpool couldn't be found anymore. Create or join one below.");
      }
      setConnError(false);
    } catch (e) {
      console.error("Load failed:", e);
      setConnError(true);
    }
    setLoaded(true);
  }, [carpoolId]);

  useEffect(() => { if (carpoolId) load(); }, [carpoolId, load]);

  // Live updates: refresh when anyone else in THIS carpool saves.
  useEffect(() => {
    if (!carpoolId) return;
    const channel = supabase
      .channel("carpool-" + carpoolId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "carpool", filter: `id=eq.${carpoolId}` },
        (payload) => { if (payload.new && payload.new.payload) setData((p) => ({ ...p, ...payload.new.payload })); }
      )
      .subscribe();
    const t = setInterval(load, 8000);
    return () => { supabase.removeChannel(channel); clearInterval(t); };
  }, [carpoolId, load]);

  const persist = async (next) => {
    if (!carpoolId) return;
    setData(next); setSaving(true);
    try {
      const { error } = await supabase
        .from("carpool")
        .upsert({ id: carpoolId, payload: next, updated_at: new Date().toISOString() });
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
  // Find a rider anywhere across all families; returns { member, family } or null.
  const findMember = (memId) => {
    for (const f of data.families) {
      const m = membersOf(f).find((x) => x.id === memId);
      if (m) return { member: m, family: f };
    }
    return null;
  };
  const familyById = (id) => data.families.find((f) => f.id === id);
  const activeFamily = me ? familyById(me) : null;

  // ── Shift lookups ──────────────────────────────────────────
  const shiftsOn = useCallback((dateStr) => {
    const wd = parse(dateStr).getDay();
    return data.shifts.filter((s) => {
      if (s.type === "single") return s.date === dateStr;
      if (s.type === "weekly") return s.weekday === wd && !(Array.isArray(s.exceptions) && s.exceptions.includes(dateStr));
      return false;
    });
  }, [data.shifts]);
  const myShiftOn = (dateStr) => shiftsOn(dateStr).find((s) => s.familyId === me);

  // "No ride needed" markers — carpool-wide, single date or weekly weekday.
  const noRideOn = useCallback((dateStr) => {
    const wd = parse(dateStr).getDay();
    return (data.noRides || []).find((n) =>
      (n.type === "single" && n.date === dateStr) || (n.type === "weekly" && n.weekday === wd)
    );
  }, [data.noRides]);
  const setNoRide = async (dateStr, kind) => {
    const wd = parse(dateStr).getDay();
    const entry = kind === "weekly" ? { id: uid(), type: "weekly", weekday: wd } : { id: uid(), type: "single", date: dateStr };
    // Remove any existing marker covering this date, then add.
    const kept = (data.noRides || []).filter((n) =>
      !((n.type === "single" && n.date === dateStr) || (n.type === "weekly" && n.weekday === wd)));
    await persist({ ...data, noRides: [...kept, entry] });
    setEditDate(null); setViewDate(null);
  };
  const clearNoRide = async (dateStr) => {
    const wd = parse(dateStr).getDay();
    const kept = (data.noRides || []).filter((n) =>
      !((n.type === "single" && n.date === dateStr) || (n.type === "weekly" && n.weekday === wd)));
    await persist({ ...data, noRides: kept });
    setEditDate(null); setViewDate(null);
  };

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
    setExpandedFam(null);
    setDraft(existing ? { ...existing, riders: existing.riders || [], pickupLoc: existing.pickupLoc || "", dropoffLoc: existing.dropoffLoc || "", origType: existing.type, origId: existing.id }
      : { type: "single", pickup: false, pickupTime: "", pickupLoc: "", dropoff: false, dropoffTime: "", dropoffLoc: "", note: "", confirmed: false, vehicleId: null, riders: [], weekday: wd, origType: null, origId: null });
  };
  const setD = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const clearMineFor = (dateStr, list) => {
    return list.filter((s) => {
      if (s.familyId !== me) return true;
      if (s.type === "single" && s.date === dateStr) return false;
      return true; // weekly shifts are handled via the scope dialog, never bulk-cleared here
    });
  };
  const buildBase = () => ({
    id: uid(), familyId: me,
    pickup: draft.pickup, pickupTime: draft.pickupTime.trim(), pickupLoc: (draft.pickupLoc || "").trim(),
    dropoff: draft.dropoff, dropoffTime: draft.dropoffTime.trim(), dropoffLoc: (draft.dropoffLoc || "").trim(),
    note: draft.note.trim(), confirmed: !!draft.confirmed, vehicleId: draft.vehicleId || null, riders: draft.riders || [],
  });

  // Add a skip-date to a weekly shift so it doesn't apply on that day.
  const addExceptionTo = (shifts, weeklyId, dateStr) => shifts.map((s) =>
    s.id === weeklyId ? { ...s, exceptions: Array.from(new Set([...(s.exceptions || []), dateStr])) } : s);

  const saveShift = async () => {
    if (!me || !editDate || !draft) return;
    const wd = parse(editDate).getDay();
    const editingWeekly = draft.origType === "weekly" && draft.origId;

    // Editing an existing weekly shift → ask scope.
    if (editingWeekly) {
      const scope = await askWeeklyScope("save");
      if (scope === "cancel") return;
      if (scope === "all") {
        // Update the weekly shift in place (keep its exceptions & type/weekday).
        if (!draft.pickup && !draft.dropoff) {
          await persist({ ...data, shifts: data.shifts.filter((s) => s.id !== draft.origId) });
        } else {
          const updated = data.shifts.map((s) => s.id === draft.origId
            ? { ...s, ...buildBase(), id: s.id, type: "weekly", weekday: s.weekday, exceptions: s.exceptions || [] } : s);
          await persist({ ...data, shifts: updated });
        }
        setEditDate(null); return;
      }
      // scope === "day": skip this date on the weekly, add a one-off for today.
      let shifts = addExceptionTo(data.shifts, draft.origId, editDate);
      if (draft.pickup || draft.dropoff) shifts = [...shifts, { ...buildBase(), type: "single", date: editDate }];
      await persist({ ...data, shifts });
      setEditDate(null); return;
    }

    // Normal (single, or new) save.
    const kept = clearMineFor(editDate, data.shifts);
    if (!draft.pickup && !draft.dropoff) { await persist({ ...data, shifts: kept }); setEditDate(null); return; }
    const shift = draft.type === "weekly"
      ? { ...buildBase(), type: "weekly", weekday: wd, exceptions: [] }
      : { ...buildBase(), type: "single", date: editDate };
    await persist({ ...data, shifts: [...kept, shift] });
    setEditDate(null);
  };

  const removeMine = async () => {
    if (!me || !editDate || !draft) return;
    if (draft.origType === "weekly" && draft.origId) {
      const scope = await askWeeklyScope("remove");
      if (scope === "cancel") return;
      if (scope === "all") {
        await persist({ ...data, shifts: data.shifts.filter((s) => s.id !== draft.origId) });
      } else {
        await persist({ ...data, shifts: addExceptionTo(data.shifts, draft.origId, editDate) });
      }
      setEditDate(null); return;
    }
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
  const goToday = () => {
    const t = new Date();
    setView({ y: t.getFullYear(), m: t.getMonth() });
    setTab("calendar");
    setEditDate(null);
    setViewDate(ymd(t));
  };
  const todayStr = ymd(new Date());
  const isSchoolDay = (date) => { const d = date.getDay(); return d >= 1 && d <= 5; };

  const uncovered = useMemo(() => grid.filter(Boolean).filter((date) => {
    if (noRideOn(ymd(date))) return false;
    if (data.schoolDaysOnly && !isSchoolDay(date)) return false;
    return shiftsOn(ymd(date)).length === 0;
  }), [grid, data.schoolDaysOnly, shiftsOn, noRideOn]);

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
        const legParts = [];
        if (s.pickup) legParts.push(`Pickup${s.pickupTime ? " " + s.pickupTime : ""}${s.pickupLoc ? " @ " + s.pickupLoc : ""}`);
        if (s.dropoff) legParts.push(`Dropoff${s.dropoffTime ? " " + s.dropoffTime : ""}${s.dropoffLoc ? " @ " + s.dropoffLoc : ""}`);
        const bits = legParts.join(" · ");
        const v = vehicleById(fam, s.vehicleId);
        const riderNames = (Array.isArray(s.riders) ? s.riders : []).map((rid) => {
          const found = findMember(rid);
          if (!found) return null;
          return found.family.id === s.familyId ? found.member.name : `${found.member.name} (${found.family.family})`;
        }).filter(Boolean);
        lines.push(`  • ${fam ? fam.family : "?"}${bits ? " — " + bits : ""}${v ? ` [${v.name}${v.seats > 0 ? ", " + v.seats + " seats" : ""}]` : ""}${s.confirmed ? " ✓confirmed" : " (tentative)"}${s.type === "weekly" ? " [weekly]" : ""}${riderNames.length ? "\n      riders: " + riderNames.join(", ") : ""}${s.note ? "\n      note: " + s.note : ""}`);
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
    const text = `Join our IVS Carpool: "${carpoolName}"\nOpen ${link}, tap "Join a carpool", and enter:\nCarpool name: ${carpoolName}\nPassword: ${data.password || ""}`;
    try {
      if (navigator.share) { await navigator.share({ title: "IVS Carpool — " + carpoolName, text }); return; }
      await navigator.clipboard.writeText(text);
      setInvited(true); setTimeout(() => setInvited(false), 2200);
    } catch (e) {
      try { await navigator.clipboard.writeText(text); setInvited(true); setTimeout(() => setInvited(false), 2200); } catch {}
    }
  };

  // ── Carpool entry screen (create or join) ───────────────────
  if (!carpoolId) {
    const labelStyle = { display: "block", fontSize: 12.5, fontWeight: 700, color: C.slate, marginBottom: 5 };
    const fieldWrap = { textAlign: "left", marginBottom: 12 };
    return (
      <div style={{ ...S.wrap, alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ ...S.panel, maxWidth: 400, width: "100%", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <img src="/logo.png" alt="Ice Vision Solutions" width={88} height={88}
              style={{ borderRadius: 18, boxShadow: "0 6px 20px rgba(23,63,95,0.25)" }} />
          </div>
          <h1 style={{ margin: "0 0 2px", fontSize: 24, fontWeight: 800, color: C.ink }}>IVS Carpool</h1>
          <p style={{ color: C.brand, margin: "0 0 18px", fontSize: 12.5, fontWeight: 700, letterSpacing: ".04em" }}>ICE VISION SOLUTIONS</p>

          {mode === "choose" && (
            <>
              {lastHint && lastHint.name && (
                <div style={{ marginBottom: 16, padding: 12, background: C.goSoft, border: `1px solid ${C.go}`, borderRadius: 12 }}>
                  <div style={{ fontSize: 12.5, color: C.slate, marginBottom: 8 }}>Last time you were in <strong style={{ color: C.ink }}>{lastHint.name}</strong></div>
                  <button onClick={() => { setMode("join"); setCpNameInput(lastHint.name); setGateError(""); }}
                    style={{ ...S.primaryBtn, width: "100%", background: C.brand }}>Continue in {lastHint.name}</button>
                </div>
              )}
              <p style={{ color: C.fog, margin: "0 0 18px", fontSize: 14 }}>Start a new carpool for your group, or join one you were invited to.</p>
              <button onClick={() => { setMode("create"); setGateError(""); }} style={{ ...S.primaryBtn, width: "100%", background: C.go, marginBottom: 10 }}>Create a carpool</button>
              <button onClick={() => { setMode("join"); setGateError(""); }} style={{ ...S.ghostBtn, width: "100%", boxSizing: "border-box" }}>Join an existing carpool</button>
            </>
          )}

          {(mode === "create" || mode === "join") && (
            <>
              <p style={{ color: C.fog, margin: "0 0 16px", fontSize: 14 }}>
                {mode === "create"
                  ? "Enter the admin password, then name your carpool and set a password to share with your families."
                  : "Enter the carpool name and password exactly as they were shared with you."}
              </p>
              {mode === "create" && (
                <div style={fieldWrap}>
                  <label style={labelStyle}>Admin password</label>
                  <input type="password" value={cpAdminInput}
                    onChange={(e) => { setCpAdminInput(e.target.value); setGateError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && createCarpool()}
                    placeholder="Admin password"
                    style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
                </div>
              )}
              <div style={fieldWrap}>
                <label style={labelStyle}>Carpool name</label>
                <input type="text" value={cpNameInput} autoFocus={mode === "join"}
                  onChange={(e) => { setCpNameInput(e.target.value); setGateError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && (mode === "create" ? createCarpool() : joinCarpool())}
                  placeholder="e.g. Lincoln Elementary Group"
                  style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>{mode === "create" ? "Create a password" : "Password"}</label>
                <input type="password" value={cpPwInput}
                  onChange={(e) => { setCpPwInput(e.target.value); setGateError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && (mode === "create" ? createCarpool() : joinCarpool())}
                  placeholder={mode === "create" ? "Members will need this to join" : "The carpool's password"}
                  style={{ ...S.input, width: "100%", boxSizing: "border-box" }} />
              </div>
              {gateError && <p style={{ color: C.warn, fontSize: 13, margin: "0 0 10px", textAlign: "left" }}>{gateError}</p>}
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", margin: "2px 0 14px", color: C.slate, fontSize: 13.5 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Remember this carpool on my device
              </label>
              <button onClick={mode === "create" ? createCarpool : joinCarpool} disabled={gateBusy}
                style={{ ...S.primaryBtn, width: "100%", background: C.go, opacity: gateBusy ? 0.6 : 1 }}>
                {gateBusy ? (mode === "create" ? "Creating…" : "Joining…") : (mode === "create" ? "Create & open" : "Join carpool")}
              </button>
              <button onClick={() => { setMode("choose"); setGateError(""); setCpNameInput(""); setCpPwInput(""); setCpAdminInput(""); }}
                style={{ ...S.ghostBtn, width: "100%", marginTop: 8, boxSizing: "border-box" }}>← Back</button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!loaded) {
    return <div style={{ ...S.wrap, alignItems: "center", justifyContent: "center", minHeight: 300 }}>
      <span style={{ color: C.fog }}>Loading {carpoolName || "your carpool"}…</span>
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
            <span style={{ fontSize: 11, color: C.brand, fontWeight: 700, letterSpacing: ".05em" }}>{carpoolName || "ICE VISION SOLUTIONS"}</span>
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
        ) : data.families.length > 0 ? (
          <span>
            <strong style={{ color: C.ink }}>Just viewing</strong> — browse the calendar freely. To add or edit driving days, tap your family above.
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
              <button className="cp-btn" onClick={() => { setMe(null); setEditDate(null); setShowSetup(false); }}
                title="Browse the calendar without editing"
                style={{ ...S.chip, borderColor: !me ? C.brand : C.line,
                  background: !me ? C.brand : C.card, color: !me ? "#fff" : C.slate }}>
                👁 Just viewing
              </button>
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
        {/* Add-family form: when no families exist yet, or when managing a selected family */}
        {(data.families.length === 0 || showSetup) && (
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

        {/* View-only mode (families exist, none selected): quiet way to add another */}
        {!activeFamily && data.families.length > 0 && !showSetup && (
          <div style={{ marginTop: 14 }}>
            <button className="cp-btn" onClick={() => setShowSetup(true)} style={{ ...S.navBtnSm }}>+ Add a family</button>
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
          <button className="cp-btn" onClick={goToday} style={S.navBtnSm}>Today's plan</button>
          <button className="cp-btn" onClick={exportText} style={S.navBtnSm}>Export</button>
          <button className="cp-btn" onClick={shareInvite}
            style={{ ...S.navBtnSm, background: invited ? C.goSoft : C.card, color: invited ? C.go : C.slate, borderColor: invited ? C.go : C.line }}>
            {invited ? "Copied ✓" : "Invite"}
          </button>
          <button className="cp-btn" onClick={() => { if (confirm("Leave this carpool on this device? You'll need the name and password to get back in.")) leaveCarpool(); }}
            title="Switch to a different carpool" style={{ ...S.navBtnSm }}>
            ⇄ Switch carpool
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
              const noRide = noRideOn(ds);
              const list = shiftsOn(ds);
              const mine = myShiftOn(ds);
              const isToday = ds === todayStr;
              const gap = !noRide && list.length === 0 && (!data.schoolDaysOnly || isSchoolDay(date));
              if (noRide) {
                return (
                  <div key={i} className="cp-day" onClick={() => openDay(ds)}
                    style={{ ...S.dayCell, background: dark ? "#0b1220" : "#eceef1", position: "relative" }}>
                    <div className="cp-daynum" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontWeight: isToday ? 800 : 600, fontSize: 13, color: C.fog }}>{date.getDate()}</span>
                      {noRide.type === "weekly" && <span style={{ fontSize: 11, color: C.fog }} title="Every week">↻</span>}
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
                      <span style={{ fontSize: 30, fontWeight: 900, color: dark ? "#5b6472" : "#1c2230", lineHeight: 1 }}>✕</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: C.fog, textAlign: "center" }}>No ride</span>
                    </div>
                  </div>
                );
              }
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
        const marker = noRideOn(viewDate);
        const list = shiftsOn(viewDate);
        const mineHere = list.find((s) => s.familyId === me);
        const wdName = WD[parse(viewDate).getDay()];
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

              {marker ? (
                <div style={{ margin: "16px 0" }}>
                  <div style={{ textAlign: "center", padding: "20px 12px", background: dark ? "#0b1220" : "#eceef1", borderRadius: 12 }}>
                    <div style={{ fontSize: 40, fontWeight: 900, color: dark ? "#5b6472" : "#1c2230", lineHeight: 1 }}>✕</div>
                    <div style={{ marginTop: 8, fontWeight: 800, color: C.ink }}>No ride needed</div>
                    <p style={{ margin: "4px 0 0", color: C.fog, fontSize: 13 }}>
                      {marker.type === "weekly" ? `No carpool every ${wdName}.` : "No carpool on this day."}
                    </p>
                  </div>
                  <button className="cp-btn" onClick={() => clearNoRide(viewDate)} style={{ ...S.ghostBtn, width: "100%", marginTop: 12, boxSizing: "border-box" }}>
                    Undo — allow rides again
                  </button>
                </div>
              ) : (
                <>
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
                              <div style={{ marginTop: 6, fontSize: 13.5, color: C.slate, display: "flex", flexDirection: "column", gap: 3 }}>
                                {!s.pickup && !s.dropoff && <span>No pickup/dropoff set</span>}
                                {s.pickup && (
                                  <span><strong style={{ color: C.ink }}>Pickup</strong>{s.pickupTime ? ` · ${s.pickupTime}` : ""}{s.pickupLoc ? <span style={{ color: C.fog }}> — 📍 {s.pickupLoc}</span> : null}</span>
                                )}
                                {s.dropoff && (
                                  <span><strong style={{ color: C.ink }}>Dropoff</strong>{s.dropoffTime ? ` · ${s.dropoffTime}` : ""}{s.dropoffLoc ? <span style={{ color: C.fog }}> — 📍 {s.dropoffLoc}</span> : null}</span>
                                )}
                                {s.type === "weekly" && <span style={{ ...S.miniTagInline }} title="Repeats weekly">↻ weekly</span>}
                              </div>
                              {(() => { const v = vehicleById(fam, s.vehicleId); return v ? (
                                <div style={{ marginTop: 4, fontSize: 13, color: C.fog }}>
                                  🚗 {v.name}{v.seats > 0 ? ` · ${v.seats} seats` : ""}
                                </div>
                              ) : null; })()}
                              {Array.isArray(s.riders) && s.riders.length > 0 && (
                                <div style={{ marginTop: 4, fontSize: 13, color: C.slate }}>
                                  🎒 {s.riders.map((rid) => {
                                    const found = findMember(rid);
                                    if (!found) return null;
                                    return found.family.id === s.familyId ? found.member.name : `${found.member.name} (${found.family.family})`;
                                  }).filter(Boolean).join(", ")}
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

                  {/* No-ride-needed controls (carpool-wide) */}
                  <div style={{ marginTop: 10, paddingTop: 12, borderTop: `1px solid ${C.line}` }}>
                    <div style={{ fontSize: 12.5, color: C.fog, marginBottom: 8, textAlign: "center" }}>Mark this day as no carpool for everyone:</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="cp-btn" onClick={() => setNoRide(viewDate, "single")} style={{ ...S.navBtnSm, flex: 1 }}>✕ Just this day</button>
                      <button className="cp-btn" onClick={() => setNoRide(viewDate, "weekly")} style={{ ...S.navBtnSm, flex: 1 }}>✕ Every {wdName}</button>
                    </div>
                  </div>
                </>
              )}
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
                { key: "pickup", timeKey: "pickupTime", locKey: "pickupLoc", label: "Pickup", ph: "e.g. 7:45 AM", locPh: "Where? e.g. school front gate" },
                { key: "dropoff", timeKey: "dropoffTime", locKey: "dropoffLoc", label: "Dropoff", ph: "e.g. 3:30 PM", locPh: "Where? e.g. 12 Oak St" },
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
                    <input value={draft[leg.locKey] || ""} onClick={(e) => e.stopPropagation()}
                      onFocus={() => { if (!on) setD({ [leg.key]: true }); }}
                      onChange={(e) => setD({ [leg.locKey]: e.target.value })}
                      placeholder={leg.locPh}
                      style={{ ...S.input, width: "100%", marginTop: 8, fontSize: 13, padding: "8px 10px", boxSizing: "border-box" }} />
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

            {(() => {
              const toggleRider = (id) => {
                const on = (draft.riders || []).includes(id);
                setD({ riders: on ? draft.riders.filter((r) => r !== id) : [...(draft.riders || []), id] });
              };
              const RiderChip = ({ m, famName }) => {
                const on = (draft.riders || []).includes(m.id);
                return (
                  <button key={m.id} className="cp-btn" onClick={() => toggleRider(m.id)}
                    style={{ ...S.chip, borderColor: on ? C.go : C.line, background: on ? C.goSoft : C.card, color: on ? C.go : C.slate }}>
                    <span style={{ ...S.checkbox, width: 16, height: 16, borderColor: on ? C.go : C.fog, background: on ? C.go : "#fff" }}>
                      {on && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                    </span>
                    {m.name}{famName ? <span style={{ color: on ? C.go : C.fog, fontWeight: 600, fontSize: 11 }}>· {famName}</span> : null}
                  </button>
                );
              };
              const others = data.families.filter((f) => f.id !== me && membersOf(f).length > 0);
              const hasOwn = membersOf(activeFamily).length > 0;
              if (!hasOwn && others.length === 0) return null;
              return (
                <>
                  {hasOwn && (
                    <>
                      <label style={S.fieldLabel}>Who needs the carpool this day?</label>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {membersOf(activeFamily).map((m) => <RiderChip key={m.id} m={m} />)}
                      </div>
                    </>
                  )}
                  {others.length > 0 && (
                    <>
                      <label style={S.fieldLabel}>Also picking up from another family?</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                        {others.map((f) => {
                          const open = expandedFam === f.id;
                          const picked = membersOf(f).filter((m) => (draft.riders || []).includes(m.id)).length;
                          return (
                            <div key={f.id} style={{ border: `1px solid ${open ? C.go : C.line}`, borderRadius: 10, overflow: "hidden" }}>
                              <button className="cp-btn" onClick={() => setExpandedFam(open ? null : f.id)}
                                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                                  background: open ? C.goSoft : C.card, border: "none", padding: "10px 12px", cursor: "pointer" }}>
                                <span style={{ ...S.dot, width: 10, height: 10, background: f.color }} />
                                <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{f.family}</span>
                                {picked > 0 && <span style={{ ...S.seatTag, color: C.go, borderColor: C.go }}>{picked} added</span>}
                                <span style={{ marginLeft: "auto", color: C.fog, fontSize: 13 }}>{open ? "▲" : `▼ ${membersOf(f).length} kid${membersOf(f).length > 1 ? "s" : ""}`}</span>
                              </button>
                              {open && (
                                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 12px", borderTop: `1px solid ${C.line}` }}>
                                  {membersOf(f).map((m) => <RiderChip key={m.id} m={m} />)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

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

            <div style={{ position: "sticky", bottom: 0, background: C.card, paddingTop: 12, paddingBottom: 20, marginTop: 8, marginLeft: -24, marginRight: -24, paddingLeft: 24, paddingRight: 24, borderTop: `1px solid ${C.line}` }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="cp-btn" onClick={saveShift} style={{ ...S.primaryBtn, background: C.go, flex: 1 }}>Save</button>
                {myShiftOn(editDate) && <button className="cp-btn" onClick={removeMine} style={S.removeBtn}>Remove</button>}
                <button className="cp-btn" onClick={() => setEditDate(null)} style={S.ghostBtn}>Cancel</button>
              </div>
              {!draft.pickup && !draft.dropoff && (
                <p style={{ margin: "8px 0 0", fontSize: 12, color: C.fog }}>
                  Check pickup or dropoff to save. Saving with neither checked clears your slot for this day.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Weekly all/just-this-day dialog */}
      {scopeAsk && (
        <div style={{ ...S.overlay, zIndex: 60 }} onClick={() => answerScope("cancel")}>
          <div style={{ ...S.modal, maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: "0 0 6px", fontSize: 18, color: C.ink }}>
              {scopeAsk.action === "remove" ? "Remove this weekly day" : "Change this weekly day"}
            </h3>
            <p style={{ margin: "0 0 18px", color: C.fog, fontSize: 14 }}>
              This shift repeats every week. {scopeAsk.action === "remove" ? "Remove it from every week, or just skip this one day?" : "Apply your changes to every week, or just this one day?"}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 20 }}>
              <button className="cp-btn" onClick={() => answerScope("day")} style={{ ...S.primaryBtn, background: C.go, width: "100%" }}>
                {scopeAsk.action === "remove" ? "Just this day" : "Just this day"}
              </button>
              <button className="cp-btn" onClick={() => answerScope("all")} style={{ ...S.removeBtn, width: "100%", boxSizing: "border-box" }}>
                {scopeAsk.action === "remove" ? "Remove all weeks" : "Change all weeks"}
              </button>
              <button className="cp-btn" onClick={() => answerScope("cancel")} style={{ ...S.ghostBtn, width: "100%", boxSizing: "border-box" }}>Cancel</button>
            </div>
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
  const modal = { background: C.card, borderRadius: 16, padding: "24px 24px 0", width: "100%", maxWidth: 460, boxShadow: "0 20px 50px rgba(0,0,0,0.25)", maxHeight: "90vh", overflowY: "auto" };
  const fieldLabel = { display: "block", fontSize: 13, fontWeight: 700, color: C.slate, marginBottom: 6 };
  const legBox = { flex: 1, border: "1.5px solid", borderRadius: 12, padding: 12, cursor: "pointer" };
  const checkbox = { width: 20, height: 20, borderRadius: 6, border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
  const typeBtn = { flex: 1, display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, border: "1.5px solid", cursor: "pointer", textAlign: "left" };
  const confirmToggle = { display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "12px", border: `1px solid ${C.line}`, borderRadius: 10, background: C.paper };
  const removeBtn = { background: C.card, color: "#c15b47", border: "1px solid #e6c3bc", borderRadius: 9, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  const ghostBtn = { background: C.card, color: C.fog, border: `1px solid ${C.line}`, borderRadius: 9, padding: "9px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
  return { wrap, laneStrip, panel, howTo, eyebrow, seatTag, vehTag, vehX, vehPick, tabRow, tabBtn, cal, wdHead, dayCell, pill, miniTag, miniTagInline, dot, gapDot, gapDotInline, input, primaryBtn, navBtn, navBtnSm, chip, xBtn, legendRow, coverRow, mineRow, statusBtn, statusPill, editSmall, overlay, modal, fieldLabel, legBox, checkbox, typeBtn, confirmToggle, removeBtn, ghostBtn };
}
