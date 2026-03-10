import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = "https://deepdive-backend-6nza.onrender.com";

// ─── LOCAL STORAGE ───────────────────────────────────────────────────────────
function lsGet(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } }
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

// ─── THEME ───────────────────────────────────────────────────────────────────
const DARK = {
  bg:         "#0a0c0f",
  surface:    "#0e1512",
  border:     "#1c2820",
  borderHover:"#4ade80",
  accent:     "#4ade80",
  accentDim:  "rgba(74,222,128,0.1)",
  text:       "#d4e0cc",
  textMuted:  "#5a6e52",
  textDim:    "#3a5040",
  warn:       "#f59e0b",
  error:      "#f87171",
  blue:       "#60a5fa",
  purple:     "#c084fc",
  pink:       "#f472b6",
  grid:       "rgba(74,222,128,0.03)",
};
const LIGHT = {
  bg:         "#f0f4f0",
  surface:    "#ffffff",
  border:     "#c8d8c0",
  borderHover:"#16a34a",
  accent:     "#16a34a",
  accentDim:  "rgba(22,163,74,0.08)",
  text:       "#1a2e18",
  textMuted:  "#4a6e42",
  textDim:    "#7a9a72",
  warn:       "#d97706",
  error:      "#dc2626",
  blue:       "#2563eb",
  purple:     "#7c3aed",
  pink:       "#db2777",
  grid:       "rgba(22,163,74,0.03)",
};

function buildStyles(t) { return `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }

  body { font-family:'IBM Plex Sans',sans-serif; background:${t.bg}; color:${t.text}; min-height:100vh; overflow-x:hidden; transition:background 0.3s,color 0.3s; }

  .app { min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:40px 16px 80px; position:relative; }
  .grid-bg { position:fixed; inset:0; pointer-events:none; z-index:0;
    background-image: linear-gradient(${t.grid} 1px,transparent 1px), linear-gradient(90deg,${t.grid} 1px,transparent 1px);
    background-size:40px 40px; }
  .scanline { position:fixed; left:0; right:0; height:2px;
    background:linear-gradient(90deg,transparent,${t.accentDim},transparent);
    pointer-events:none; z-index:1; animation:scanline 8s linear infinite; }
  .container { width:100%; max-width:900px; position:relative; z-index:2; }

  /* Header */
  .header { text-align:center; margin-bottom:40px; }
  .header-icon { display:inline-flex; align-items:center; justify-content:center;
    width:48px; height:48px; border:1px solid ${t.accentDim.replace("0.1","0.3")}; border-radius:4px;
    color:${t.accent}; margin-bottom:16px; background:${t.accentDim}; }
  .header h1 { font-family:'IBM Plex Mono',monospace; font-size:clamp(20px,4vw,28px); font-weight:600; color:${t.text}; }
  .header h1 span { color:${t.accent}; }
  .header-sub { font-size:12px; color:${t.textMuted}; margin-top:8px; font-family:'IBM Plex Mono',monospace; letter-spacing:0.5px; }
  .header-actions { display:flex; justify-content:center; gap:8px; margin-top:12px; }

  /* Buttons */
  .btn { display:flex; align-items:center; gap:6px; padding:10px 18px; border-radius:3px; border:none;
    font-family:'IBM Plex Mono',monospace; font-size:12px; font-weight:500; cursor:pointer; transition:all 0.2s; white-space:nowrap; }
  .btn-primary { background:${t.accent}; color:${t.bg === "#0a0c0f" ? "#061008" : "#fff"}; }
  .btn-primary:hover:not(:disabled) { filter:brightness(1.1); }
  .btn-primary:disabled { opacity:0.4; cursor:not-allowed; }
  .btn-ghost { background:transparent; border:1px solid ${t.border}; color:${t.textMuted}; }
  .btn-ghost:hover { border-color:${t.accent}; color:${t.accent}; }
  .btn-icon { background:transparent; border:1px solid ${t.border}; color:${t.textMuted}; padding:8px; border-radius:3px; cursor:pointer; transition:all 0.2s; }
  .btn-icon:hover { border-color:${t.accent}; color:${t.accent}; }

  /* Mode toggle */
  .mode-toggle { display:flex; margin-bottom:28px; border:1px solid ${t.border}; border-radius:4px; overflow:hidden; }
  .mode-btn { flex:1; padding:11px 16px; border:none; cursor:pointer; font-family:'IBM Plex Mono',monospace;
    font-size:11px; letter-spacing:0.5px; transition:all 0.2s; background:transparent; color:${t.textDim}; }
  .mode-btn.active { background:${t.accentDim}; color:${t.accent}; }
  .mode-btn:hover:not(.active) { color:${t.textMuted}; }
  .mode-divider { width:1px; background:${t.border}; flex-shrink:0; }

  /* Steps */
  .steps { display:flex; align-items:center; gap:0; margin-bottom:28px; flex-wrap:wrap; gap:8px; }
  .step-item { display:flex; align-items:center; gap:8px; }
  .step-num { width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center;
    font-family:'IBM Plex Mono',monospace; font-size:11px; font-weight:600; border:1px solid; transition:all 0.3s; }
  .step-num.active { border-color:${t.accent}; color:${t.accent}; background:${t.accentDim}; }
  .step-num.done { border-color:${t.accent}; color:${t.bg}; background:${t.accent}; }
  .step-num.pending { border-color:${t.border}; color:${t.textDim}; }
  .step-label { font-size:11px; letter-spacing:0.5px; }
  .step-label.active { color:${t.text}; }
  .step-label.done { color:${t.accent}; }
  .step-label.pending { color:${t.textDim}; }
  .step-connector { width:40px; height:1px; margin:0 8px; background:${t.border}; flex-shrink:0; }

  /* Card */
  .card { background:${t.surface}; border:1px solid ${t.border}; border-radius:4px; padding:24px; animation:fadeUp 0.35s ease both; }
  .card+.card { margin-top:12px; }
  .card-label { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:2px; color:${t.accent};
    text-transform:uppercase; margin-bottom:18px; display:flex; align-items:center; gap:8px; }
  .card-label::before { content:''; display:block; width:14px; height:1px; background:${t.accent}; }

  /* Input */
  .input-row { display:flex; gap:8px; flex-wrap:wrap; }
  .input-wrap { flex:1; min-width:140px; position:relative; }
  .input-wrap input, .input-wrap textarea {
    width:100%; background:${t.bg}; border:1px solid ${t.border}; border-radius:3px;
    padding:10px 14px; font-family:'IBM Plex Mono',monospace; font-size:13px;
    color:${t.text}; outline:none; transition:border-color 0.2s; }
  .input-wrap input:focus, .input-wrap textarea:focus { border-color:${t.accent}; }
  .input-wrap input::placeholder, .input-wrap textarea::placeholder { color:${t.textDim}; }
  .input-wrap input:disabled { opacity:0.5; cursor:not-allowed; }
  .input-hint { font-size:10px; color:${t.textDim}; margin-top:4px; font-family:'IBM Plex Mono',monospace; }

  /* Tags input */
  .tags-input { display:flex; flex-wrap:wrap; gap:4px; align-items:center;
    background:${t.bg}; border:1px solid ${t.border}; border-radius:3px; padding:6px 10px;
    min-height:42px; cursor:text; transition:border-color 0.2s; }
  .tags-input:focus-within { border-color:${t.accent}; }
  .tag { display:flex; align-items:center; gap:4px; padding:2px 8px; border-radius:2px;
    background:${t.accentDim}; border:1px solid ${t.accent}; font-family:'IBM Plex Mono',monospace;
    font-size:11px; color:${t.accent}; }
  .tag button { background:none; border:none; color:${t.accent}; cursor:pointer; font-size:12px; padding:0; line-height:1; }
  .tags-input input { border:none; background:transparent; outline:none; font-family:'IBM Plex Mono',monospace;
    font-size:12px; color:${t.text}; min-width:80px; flex:1; padding:2px 0; }
  .tags-input input::placeholder { color:${t.textDim}; }

  /* Status */
  .status { display:flex; align-items:flex-start; gap:10px; padding:12px 14px; border-radius:3px;
    margin-top:12px; font-size:12px; animation:fadeUp 0.3s ease; }
  .status-success { background:${t.accentDim}; border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.25)")}; color:${t.accent}; }
  .status-error { background:rgba(248,113,113,0.07); border:1px solid rgba(248,113,113,0.2); color:${t.error}; }
  .status-warn { background:rgba(251,191,36,0.07); border:1px solid rgba(251,191,36,0.2); color:${t.warn}; }

  /* Loading */
  .loading-row { display:flex; align-items:center; gap:10px; padding:12px 0; color:${t.textDim};
    font-family:'IBM Plex Mono',monospace; font-size:12px; }
  .loading-dots span { display:inline-block; width:4px; height:4px; border-radius:50%;
    background:${t.accent}; margin:0 2px; animation:pulse 1.4s ease infinite; }
  .loading-dots span:nth-child(2) { animation-delay:0.2s; }
  .loading-dots span:nth-child(3) { animation-delay:0.4s; }

  /* Examples */
  .examples { margin-top:8px; display:flex; flex-wrap:wrap; gap:5px; }
  .example-chip { font-family:'IBM Plex Mono',monospace; font-size:10px; padding:3px 8px;
    border:1px solid ${t.border}; border-radius:2px; color:${t.textDim}; cursor:pointer; transition:all 0.2s; }
  .example-chip:hover { border-color:${t.accent}; color:${t.accent}; }

  /* Organism result */
  .organism-result { margin-top:16px; padding:14px 16px; background:${t.bg};
    border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.2)")}; border-radius:3px; animation:fadeUp 0.3s ease; }
  .strain-card { padding:10px 12px; margin-bottom:6px; border-radius:4px; cursor:pointer; transition:all 0.15s; }
  .strain-card-selected-green { border:1px solid ${t.accent}; background:${t.accentDim}; }
  .strain-card-unselected-green { border:1px solid rgba(74,222,128,0.2); background:rgba(74,222,128,0.02); }
  .strain-card-selected-amber { border:1px solid ${t.warn}; background:rgba(245,158,11,0.08); }
  .strain-card-unselected-amber { border:1px solid rgba(245,158,11,0.2); background:rgba(245,158,11,0.02); }

  /* Table */
  .table-wrap { overflow-x:auto; margin-top:8px; }
  table { width:100%; border-collapse:collapse; }
  thead tr { border-bottom:1px solid ${t.border}; }
  th { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:1px; color:${t.textDim};
    font-weight:500; text-transform:uppercase; padding:8px 12px; text-align:left; white-space:nowrap; }
  td { font-family:'IBM Plex Mono',monospace; font-size:11px; padding:9px 12px; color:${t.textMuted};
    border-bottom:1px solid ${t.border}; }
  tr:hover td { background:${t.accentDim}; }
  td.product-cell { color:${t.text}; white-space:normal; max-width:220px; }
  td.locus-cell { color:${t.accent}; }

  /* Result header */
  .result-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap; gap:10px; }
  .result-count { font-family:'IBM Plex Mono',monospace; font-size:11px;
    background:${t.accentDim}; color:${t.accent}; padding:3px 10px; border-radius:2px;
    border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.25)")}; }

  /* History */
  .history-panel { margin-bottom:20px; animation:fadeUp 0.3s ease; }
  .history-label { font-family:'IBM Plex Mono',monospace; font-size:10px; letter-spacing:2px;
    color:${t.textDim}; text-transform:uppercase; margin-bottom:8px; }
  .history-list { display:flex; flex-wrap:wrap; gap:5px; }
  .history-item { font-family:'IBM Plex Mono',monospace; font-size:10px; padding:3px 10px;
    border:1px solid ${t.border}; border-radius:2px; color:${t.textMuted}; cursor:pointer;
    transition:all 0.2s; display:flex; align-items:center; gap:6px; }
  .history-item:hover { border-color:${t.accent}; color:${t.accent}; }
  .history-item button { background:none; border:none; color:inherit; cursor:pointer; font-size:11px; padding:0; }

  /* Scan items */
  .scan-toolbar { display:flex; align-items:center; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
  .scan-filter-btn { font-family:'IBM Plex Mono',monospace; font-size:10px; padding:4px 10px;
    border-radius:2px; cursor:pointer; transition:all 0.2s; border:1px solid ${t.border}; background:transparent; color:${t.textDim}; }
  .scan-filter-btn.active { border-color:${t.accent}; color:${t.accent}; background:${t.accentDim}; }

  .scan-list { display:flex; flex-direction:column; gap:6px; }
  .scan-item { border-radius:3px; padding:10px 14px; animation:fadeUp 0.25s ease both; font-family:'IBM Plex Mono',monospace; font-size:12px; }
  .scan-item-found { border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.3)")}; background:${t.accentDim}; }
  .scan-item-scanning { border:1px solid ${t.border}; background:${t.bg}; }
  .scan-item-skip { border:1px solid ${t.border}; background:transparent; opacity:0.35; }
  .scan-item-notfound { border:1px solid ${t.border}; background:transparent; opacity:0.3; }

  .scan-item-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px; }
  .scan-strain-name { color:${t.text}; font-weight:500; font-style:italic; }
  .scan-badge { font-size:10px; padding:2px 7px; border-radius:2px; letter-spacing:1px; }
  .scan-badge-found { background:${t.accentDim}; color:${t.accent}; border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.3)")}; }
  .scan-badge-scanning { color:${t.textDim}; border:1px solid ${t.border}; }
  .scan-badge-skip { color:${t.textDim}; }
  .scan-badge-notfound { color:${t.textDim}; }
  .scan-meta { display:flex; gap:10px; margin-top:5px; flex-wrap:wrap; }
  .scan-meta span { color:${t.textDim}; font-size:11px; }
  .scan-meta b { color:${t.accent}; font-weight:400; }
  .scan-meta .blue b { color:${t.blue}; }

  .scan-toggle-btn { margin-top:6px; background:transparent; border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.2)")};
    color:${t.accent}; font-family:'IBM Plex Mono',monospace; font-size:10px; padding:3px 10px;
    border-radius:2px; cursor:pointer; letter-spacing:0.5px; }
  .scan-toggle-btn:hover { background:${t.accentDim}; }

  .scan-progress-bar { height:2px; background:${t.border}; border-radius:1px; margin-top:12px; overflow:hidden; }
  .scan-progress-fill { height:100%; background:${t.accent}; border-radius:1px; transition:width 0.4s ease; }

  .scan-done-banner { padding:12px 14px; border:1px solid ${t.accent.replace("#","rgba(").replace("80","128,0.3)")};
    border-radius:3px; background:${t.accentDim}; font-family:'IBM Plex Mono',monospace;
    font-size:12px; color:${t.accent}; display:flex; align-items:center; gap:8px; margin-top:8px; }

  /* Protein modal */
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:100;
    display:flex; align-items:center; justify-content:center; padding:20px; }
  .modal { background:${t.surface}; border:1px solid ${t.border}; border-radius:6px;
    padding:24px; max-width:680px; width:100%; max-height:80vh; overflow-y:auto; animation:fadeUp 0.25s ease; }
  .modal-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; }
  .modal-title { font-family:'IBM Plex Mono',monospace; font-size:13px; color:${t.accent}; }
  .fasta-box { background:${t.bg}; border:1px solid ${t.border}; border-radius:3px; padding:14px;
    font-family:'IBM Plex Mono',monospace; font-size:11px; color:${t.textMuted};
    white-space:pre-wrap; word-break:break-all; max-height:340px; overflow-y:auto; line-height:1.6; margin-top:8px; }
  .fasta-box .fasta-header { color:${t.accent}; }

  /* Responsive */
  @media(max-width:600px) {
    .app { padding:24px 12px 60px; }
    .input-row { flex-direction:column; }
    .input-wrap { min-width:unset; }
    .btn { font-size:11px; padding:10px 14px; }
    .card { padding:16px; }
    .steps { gap:4px; }
    .step-connector { width:20px; }
    table { font-size:10px; }
    th, td { padding:7px 8px; }
  }
`; }

// ─── ICONS ───────────────────────────────────────────────────────────────────
const IconDNA      = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 2c0 0 4 2 8 4s8 6 8 10"/><path d="M22 22c0 0-4-2-8-4s-8-6-8-10"/><path d="M6 4.5h12M6 8h12M6 16h12M6 19.5h12"/></svg>;
const IconSearch   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>;
const IconCheck    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
const IconX        = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconLoader   = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{animation:"spin 1s linear infinite"}}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>;
const IconExternal = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;
const IconSun      = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IconMoon     = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const IconHistory  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4"/><polyline points="3 16 3 11 8 11"/></svg>;
const IconFlask    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3h6l1 9H8L9 3z"/><path d="M8 12l-4 6a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3l-4-6"/></svg>;

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function LoadingDots({ text }) {
  return <div className="loading-row"><IconLoader /><span>{text}</span><span className="loading-dots"><span/><span/><span/></span></div>;
}
function StatusMsg({ type, children }) {
  const icons = { success: <IconCheck/>, error: <IconX/>, warn: "⚠" };
  return <div className={`status status-${type}`}><span>{icons[type]}</span><span>{children}</span></div>;
}

// ─── TAGS INPUT ───────────────────────────────────────────────────────────────
function TagsInput({ tags, setTags, placeholder, disabled }) {
  const [val, setVal] = useState("");
  const inputRef = useRef();
  function addTag(v) {
    const trimmed = v.trim();
    if (trimmed && !tags.includes(trimmed)) setTags([...tags, trimmed]);
    setVal("");
  }
  function onKey(e) {
    if (["Enter", ",", "Tab"].includes(e.key)) { e.preventDefault(); addTag(val); }
    else if (e.key === "Backspace" && !val && tags.length) setTags(tags.slice(0, -1));
  }
  return (
    <div className="tags-input" onClick={() => inputRef.current?.focus()}>
      {tags.map(tag => (
        <span key={tag} className="tag">
          {tag}
          <button onClick={() => setTags(tags.filter(t => t !== tag))}><IconX/></button>
        </span>
      ))}
      <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={onKey} onBlur={() => val.trim() && addTag(val)}
        placeholder={tags.length === 0 ? placeholder : ""}
        disabled={disabled} />
    </div>
  );
}

// ─── PROTEIN MODAL ────────────────────────────────────────────────────────────
function ProteinModal({ proteinId, onClose }) {
  const [loading, setLoading] = useState(true);
  const [seq, setSeq]         = useState(null);
  const [err, setErr]         = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/protein-sequence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protein_id: proteinId }),
    })
      .then(r => r.json())
      .then(d => { if (d.found) setSeq(d.sequence); else setErr(d.message); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [proteinId]);

  const lines = seq ? seq.split("\n") : [];
  const header = lines[0] || "";
  const body   = lines.slice(1).join("\n");

  function copySeq() {
    if (seq) navigator.clipboard.writeText(seq);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">🧪 Protein Sequence — {proteinId}</span>
          <button className="btn-icon" onClick={onClose}><IconX/></button>
        </div>
        {loading && <LoadingDots text="NCBI Protein'den sekans alınıyor" />}
        {err && <StatusMsg type="error">{err}</StatusMsg>}
        {seq && (
          <>
            <div style={{display:"flex",gap:8,marginBottom:8}}>
              <button className="btn btn-ghost" style={{fontSize:"10px"}} onClick={copySeq}>Kopyala</button>
              <a href={`https://www.ncbi.nlm.nih.gov/protein/${proteinId}`} target="_blank" rel="noreferrer"
                className="btn btn-ghost" style={{fontSize:"10px",textDecoration:"none"}}>
                NCBI'da Aç <IconExternal/>
              </a>
            </div>
            <div className="fasta-box">
              <span className="fasta-header">{header}</span>{"\n"}{body}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── FEATURE TABLE ────────────────────────────────────────────────────────────
function FeatureTable({ rows, t }) {
  const [proteinModal, setProteinModal] = useState(null);

  return (
    <>
      {proteinModal && <ProteinModal proteinId={proteinModal} onClose={() => setProteinModal(null)} />}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {["Locus Tag","Contig","Start","Stop","St","Type","Gene","Product","Protein"].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="locus-cell">
                  {r.locus_tag
                    ? <a href={`https://www.ncbi.nlm.nih.gov/nuccore/${r.contig}?from=${r.start}&to=${r.stop}&strand=${r.strand==="-"?"2":"1"}`}
                        target="_blank" rel="noreferrer"
                        style={{color:t.accent,textDecoration:"none",borderBottom:`1px dashed ${t.accentDim.replace("0.1","0.4")}`}}>
                        {r.locus_tag}
                      </a>
                    : "—"}
                </td>
                <td>{r.contig}</td>
                <td>{Number(r.start).toLocaleString()}</td>
                <td>{Number(r.stop).toLocaleString()}</td>
                <td style={{color: r.strand==="+" ? t.accent : t.pink}}>{r.strand}</td>
                <td style={{fontSize:"10px",fontWeight:600,letterSpacing:"1px",color: r.type==="CDS"?t.blue:r.type==="rRNA"?t.purple:t.pink}}>{r.type}</td>
                <td style={{color:t.blue}}>{r.gene||"—"}</td>
                <td className="product-cell">{r.product}</td>
                <td>
                  {r.protein_id
                    ? <button onClick={() => setProteinModal(r.protein_id)}
                        style={{background:"transparent",border:`1px solid ${t.accentDim.replace("0.1","0.3")}`,
                          color:t.accent,cursor:"pointer",borderRadius:"2px",fontSize:"10px",padding:"2px 6px",
                          fontFamily:"IBM Plex Mono,monospace"}}>
                        <IconFlask/>
                      </button>
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── STEP INDICATOR ──────────────────────────────────────────────────────────
function StepIndicator({ step, t }) {
  const steps = ["Organizma Ara", "Product Sorgula"];
  return (
    <div className="steps">
      {steps.map((label, i) => {
        const num   = i + 1;
        const state = num < step ? "done" : num === step ? "active" : "pending";
        return (
          <div key={num} style={{display:"flex",alignItems:"center"}}>
            <div className="step-item">
              <div className={`step-num ${state}`}>{state==="done" ? <IconCheck/> : num}</div>
              <span className={`step-label ${state}`}>{label}</span>
            </div>
            {i < steps.length-1 && <div className="step-connector" />}
          </div>
        );
      })}
    </div>
  );
}

// ─── HISTORY PANEL ───────────────────────────────────────────────────────────
function HistoryPanel({ history, onSelect, onRemove, t }) {
  if (!history.length) return null;
  return (
    <div className="history-panel">
      <div className="history-label"><IconHistory/> Son Aramalar</div>
      <div className="history-list">
        {history.map((h, i) => (
          <span key={i} className="history-item" onClick={() => onSelect(h)}>
            <span>{h.organism} / {h.product}</span>
            <button onClick={e => { e.stopPropagation(); onRemove(i); }}>×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── MOD 2 ───────────────────────────────────────────────────────────────────
function ScanMode2({ t, addHistory }) {
  const [orgTags,  setOrgTags]  = useState([]);
  const [prodTags, setProdTags] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [items,    setItems]    = useState([]);  // tüm strainler, kalıcı liste
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [done,     setDone]     = useState(null);
  const [filter,   setFilter]   = useState("all"); // all | found | notfound | skip
  const esRef     = useRef(null);
  const bottomRef = useRef(null);

  function reset() {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setScanning(false); setItems([]); setProgress({ current: 0, total: 0 }); setDone(null);
  }

  function startScan() {
    if (!orgTags.length || !prodTags.length) return;
    reset();
    setScanning(true);
    addHistory({ organism: orgTags.join(", "), product: prodTags.join(", "), mode: 2 });

    const params = new URLSearchParams({ organism: orgTags.join(","), product: prodTags.join(",") });
    const es = new EventSource(`${API_BASE}/scan-organism?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      const id = `s_${data.bacdive_id}`;

      if (data.type === "scan_start") {
        setProgress({ current: 0, total: data.total });

      } else if (data.type === "scanning") {
        // Strain listeye eklenir, "taranıyor" durumunda
        setProgress(p => ({ ...p, current: data.progress }));
        setItems(prev => {
          if (prev.find(i => i.id === id)) return prev; // zaten varsa ekleme
          return [...prev, {
            id, status: "scanning",
            strain_name: data.strain_name,
            accession: data.accession,
            bacdive_id: data.bacdive_id,
            organism: data.organism,
          }];
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

      } else if (data.type === "found") {
        setProgress(p => ({ ...p, current: data.progress || p.current }));
        setItems(prev => prev.map(i => i.id === id
          ? { ...i, status: "found", match_count: data.match_count, results: data.results,
              source: data.source, bacdive_url: data.bacdive_url }
          : i
        ));

      } else if (data.type === "not_found") {
        setProgress(p => ({ ...p, current: data.progress || p.current }));
        setItems(prev => prev.map(i => i.id === id ? { ...i, status: "notfound" } : i));

      } else if (data.type === "skip") {
        // Assembly yoksa scanning eventi gelmez, direkt skip gelir — listeye ekle
        setItems(prev => {
          const exists = prev.find(i => i.id === id);
          const item = { id, status: "skip", strain_name: data.strain_name,
            accession: data.accession, bacdive_id: data.bacdive_id,
            reason: data.reason, organism: data.organism };
          return exists
            ? prev.map(i => i.id === id ? item : i)
            : [...prev, item];
        });

      } else if (data.type === "done") {
        setDone(data); setScanning(false); es.close(); esRef.current = null;

      } else if (data.type === "error") {
        setDone({ error: true, message: data.message });
        setScanning(false); es.close(); esRef.current = null;
      }
    };

    es.onerror = () => { setScanning(false); es.close(); esRef.current = null; };
  }

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const counts = {
    all:      items.length,
    found:    items.filter(i => i.status === "found").length,
    notfound: items.filter(i => i.status === "notfound").length,
    skip:     items.filter(i => i.status === "skip").length,
  };

  const filtered = filter === "all"      ? items
    : filter === "found"    ? items.filter(i => i.status === "found")
    : filter === "notfound" ? items.filter(i => i.status === "notfound")
    : items.filter(i => i.status === "skip");

  return (
    <div className="card">
      <div className="card-label">02 — Cins Taraması</div>

      {/* Input */}
      <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
        <div>
          <TagsInput tags={orgTags} setTags={setOrgTags}
            placeholder="Organizma ekle, Enter'a bas… (örn: halomonas)" disabled={scanning} />
          <div className="input-hint">Birden fazla organizma için her birini girdikten sonra Enter'a bas</div>
        </div>
        <div>
          <TagsInput tags={prodTags} setTags={setProdTags}
            placeholder="Product ekle, Enter'a bas… (örn: levan)" disabled={scanning} />
          <div className="input-hint">Birden fazla keyword girilebilir</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn btn-primary"
            style={{flex:1, justifyContent:"center", ...(scanning ? {background:t.error,color:"#fff"} : {})}}
            onClick={scanning ? reset : startScan}
            disabled={!scanning && (!orgTags.length || !prodTags.length)}>
            {scanning ? <><IconX/> Durdur</> : <><IconSearch/> Tara</>}
          </button>
          {items.length > 0 && !scanning && (
            <button className="btn btn-ghost" onClick={reset}>Temizle</button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div style={{marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",
            fontFamily:"IBM Plex Mono,monospace",fontSize:10,color:t.textDim,marginBottom:4}}>
            <span>{scanning ? `Taranıyor… ${progress.current}/${progress.total}` : `Tamamlandı — ${progress.total} strain`}</span>
            <span style={{color:t.accent}}>{pct}%</span>
          </div>
          <div className="scan-progress-bar">
            <div className="scan-progress-fill" style={{width:`${pct}%`}} />
          </div>
        </div>
      )}

      {/* Filter toolbar */}
      {items.length > 0 && (
        <div className="scan-toolbar">
          {[
            ["all",      "Tümü",       counts.all],
            ["found",    "✓ Bulundu",  counts.found],
            ["notfound", "∅ Yok",      counts.notfound],
            ["skip",     "— Atlandı",  counts.skip],
          ].map(([v, l, c]) => (
            <button key={v} className={`scan-filter-btn ${filter===v?"active":""}`}
              onClick={() => setFilter(v)}>
              {l} ({c})
            </button>
          ))}
        </div>
      )}

      {/* Strain listesi */}
      {filtered.length > 0 && (
        <div className="scan-list">
          {filtered.map(item => (
            <div key={item.id} className={`scan-item scan-item-${item.status}`}>

              {/* Strain başlık satırı */}
              <div className="scan-item-header">
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  {item.organism && (
                    <span style={{fontSize:10,color:t.textDim,fontFamily:"IBM Plex Mono,monospace"}}>
                      [{item.organism}]
                    </span>
                  )}
                  <span className="scan-strain-name">{item.strain_name}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {item.status === "scanning"  && <span className="scan-badge scan-badge-scanning">⏳ taranıyor</span>}
                  {item.status === "found"     && <span className="scan-badge scan-badge-found">✓ {item.match_count} gen</span>}
                  {item.status === "notfound"  && <span className="scan-badge scan-badge-notfound">∅ eşleşme yok</span>}
                  {item.status === "skip"      && <span className="scan-badge scan-badge-skip">— {item.reason || "atlandı"}</span>}
                </div>
              </div>

              {/* Meta bilgiler */}
              {(item.bacdive_id || item.accession) && (
                <div className="scan-meta">
                  {item.bacdive_id && <span>BacDive: <b>{item.bacdive_id}</b></span>}
                  {item.accession  && <span className="blue">Assembly: <b>{item.accession}</b></span>}
                  {item.source     && <span>Kaynak: <b style={{color:t.blue}}>{item.source}</b></span>}
                  {item.bacdive_url && (
                    <a href={item.bacdive_url} target="_blank" rel="noreferrer"
                      style={{color:t.accent,textDecoration:"none",
                        borderBottom:`1px dashed ${t.accentDim.replace("0.1","0.4")}`}}>
                      BacDive ↗
                    </a>
                  )}
                </div>
              )}

              {/* Gen tablosu — bulununca otomatik açık */}
              {item.status === "found" && item.results && (
                <div style={{marginTop:10}}>
                  <FeatureTable rows={item.results} t={t} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Tamamlandı banner */}
      {done && !done.error && (
        <div className="scan-done-banner">
          <IconCheck/>
          <span>
            Tamamlandı — <b>{done.total_scanned}</b> strain tarandı,{" "}
            <b style={{color:t.accent}}>{done.found_count}</b> pozitif.
          </span>
        </div>
      )}
      {done?.error && <StatusMsg type="error">{done.message}</StatusMsg>}

      <div ref={bottomRef} />
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────────────────
export default function App() {
  const [darkMode, setDarkMode]   = useState(() => lsGet("deepdive_dark", true));
  const [mode,     setMode]       = useState(1);
  const [history,  setHistory]    = useState(() => lsGet("deepdive_history", []));

  // Mod 1 state
  const [step,          setStep]          = useState(1);
  const [orgInput,      setOrgInput]      = useState("");
  const [orgLoading,    setOrgLoading]    = useState(false);
  const [orgResult,     setOrgResult]     = useState(null);
  const [selectedStrain,setSelectedStrain]= useState(null);
  const [prodTags,      setProdTags]      = useState([]);
  const [productLoading,setProductLoading]= useState(false);
  const [productResult, setProductResult] = useState(null);

  const orgRef  = useRef(null);
  const prodRef = useRef(null);
  const t       = darkMode ? DARK : LIGHT;

  useEffect(() => { lsSet("deepdive_dark", darkMode); }, [darkMode]);
  useEffect(() => { lsSet("deepdive_history", history.slice(0,10)); }, [history]);

  function addHistory(entry) {
    setHistory(prev => [entry, ...prev.filter(h => h.organism!==entry.organism||h.product!==entry.product)].slice(0,10));
  }

  async function handleCheckOrganism() {
    if (!orgInput.trim()) return;
    setOrgLoading(true); setOrgResult(null); setProductResult(null);
    try {
      const data = await fetch(`${API_BASE}/check-organism`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({name: orgInput.trim()}),
      }).then(r => r.json());
      setOrgResult(data);
      if (data.found) {
        setSelectedStrain(data.strains ? data.strains[0] : data);
        setStep(2);
        setTimeout(() => prodRef.current?.focus(), 400);
      }
    } catch(e) {
      setOrgResult({error:true, message:`Bağlantı hatası: ${e.message}`});
    } finally { setOrgLoading(false); }
  }

  async function handleSearchProduct() {
    const active = selectedStrain || orgResult;
    if (!prodTags.length || !active?.bacdive_id) return;
    setProductLoading(true); setProductResult(null);
    addHistory({ organism: orgInput, product: prodTags.join(", "), mode: 1 });
    try {
      const data = await fetch(`${API_BASE}/search-product`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ bacdive_id: active.bacdive_id, product: prodTags.join(","), _strain: active._strain }),
      }).then(r => r.json());
      setProductResult(data);
    } catch(e) {
      setProductResult({error:true, message:`Bağlantı hatası: ${e.message}`});
    } finally { setProductLoading(false); }
  }

  function resetAll() {
    setStep(1); setOrgInput(""); setOrgResult(null); setSelectedStrain(null);
    setProdTags([]); setProductResult(null);
    setTimeout(() => orgRef.current?.focus(), 100);
  }

  const ORG_EXAMPLES  = ["Leuconostoc mesenteroides", "Pseudomonas aeruginosa", "Bacillus subtilis"];
  const PROD_EXAMPLES = ["levan", "glucan", "transferase", "cellulose"];

  return (
    <>
      <style>{buildStyles(t)}</style>
      <div className="app">
        <div className="grid-bg"/>
        <div className="scanline"/>
        <div className="container">

          {/* Header */}
          <div className="header">
            <div className="header-icon"><IconDNA/></div>
            <h1>Bac<span>Dive</span> Feature Search</h1>
            <div className="header-sub">BacDive API v2 · NCBI GFF Annotation · Feature Table Query</div>
            <div className="header-actions">
              <button className="btn-icon" onClick={() => setDarkMode(d => !d)} title="Tema değiştir">
                {darkMode ? <IconSun/> : <IconMoon/>}
              </button>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="mode-toggle">
            <button className={`mode-btn ${mode===1?"active":""}`} onClick={() => setMode(1)}>
              MOD 1 — Strain Sorgula
            </button>
            <div className="mode-divider"/>
            <button className={`mode-btn ${mode===2?"active":""}`} onClick={() => setMode(2)}>
              MOD 2 — Cins Tara
            </button>
          </div>

          {/* History */}
          <HistoryPanel
            history={history.filter(h => h.mode === mode || !h.mode)}
            onSelect={h => { if (mode===1) { setOrgInput(h.organism); setProdTags(h.product.split(", ")); }}}
            onRemove={i => setHistory(prev => prev.filter((_,idx) => idx!==i))}
            t={t}
          />

          {/* MOD 2 */}
          {mode === 2 && <ScanMode2 t={t} addHistory={addHistory} />}

          {/* MOD 1 */}
          {mode === 1 && (
            <>
              <StepIndicator step={step} t={t} />

              {/* Step 1: Organism */}
              <div className="card">
                <div className="card-label">01 — Organizma Sorgulama</div>
                <div className="input-row">
                  <div className="input-wrap">
                    <input ref={orgRef} value={orgInput} onChange={e => setOrgInput(e.target.value)}
                      onKeyDown={e => e.key==="Enter" && handleCheckOrganism()}
                      placeholder="Genus species veya strain adı girin…" disabled={orgLoading} autoFocus />
                  </div>
                  <button className="btn btn-primary" onClick={handleCheckOrganism}
                    disabled={!orgInput.trim() || orgLoading}>
                    {orgLoading ? <IconLoader/> : <IconSearch/>}
                    {orgLoading ? "Sorgulanıyor" : "BacDive'da Ara"}
                  </button>
                  {orgResult && <button className="btn btn-ghost" onClick={resetAll}>Sıfırla</button>}
                </div>

                {!orgResult && !orgLoading && (
                  <div className="examples">
                    <span style={{fontSize:"10px",color:t.textDim,fontFamily:"IBM Plex Mono,monospace",marginRight:4}}>örnek:</span>
                    {ORG_EXAMPLES.map(e => <span key={e} className="example-chip" onClick={() => setOrgInput(e)}>{e}</span>)}
                  </div>
                )}

                {orgLoading && <LoadingDots text="BacDive API sorgulanıyor" />}
                {orgResult?.error && <StatusMsg type="error">{orgResult.message}</StatusMsg>}
                {orgResult && !orgResult.error && !orgResult.found && (
                  <StatusMsg type="error">"{orgInput}" için BacDive'da kayıt bulunamadı.</StatusMsg>
                )}

                {orgResult?.found && (
                  <div className="organism-result">
                    <div style={{fontSize:10,color:t.accent,fontFamily:"IBM Plex Mono",marginBottom:10,letterSpacing:"0.05em"}}>
                      {orgResult.total_hits} STRAIN — BİRİNİ SEÇ
                    </div>

                    {/* With assembly */}
                    {orgResult.strains?.filter(s => s.has_assembly).length > 0 && (
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:9,color:t.accent,fontFamily:"IBM Plex Mono",marginBottom:5,opacity:0.7}}>✓ GENOME ASSEMBLY MEVCUT</div>
                        {orgResult.strains.filter(s => s.has_assembly).map(s => (
                          <div key={s.bacdive_id}
                            className={`strain-card ${selectedStrain?.bacdive_id===s.bacdive_id ? "strain-card-selected-green" : "strain-card-unselected-green"}`}
                            onClick={() => { setSelectedStrain(s); setProductResult(null); }}>
                            <div style={{color:t.text,fontSize:13,fontWeight:600,marginBottom:4}}>{s.strain_name}</div>
                            <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                              <span style={{fontSize:11,color:t.textMuted}}>BacDive: <span style={{color:t.accent}}>{s.bacdive_id}</span></span>
                              <span style={{fontSize:11,color:t.textMuted}}>Assembly: <span style={{color:t.blue}}>{s.accession}</span></span>
                              <a href={s.bacdive_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
                                style={{fontSize:11,color:t.textMuted,textDecoration:"none",borderBottom:`1px dashed ${t.border}`}}>BacDive ↗</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Without assembly */}
                    {orgResult.strains?.filter(s => !s.has_assembly).length > 0 && (
                      <div>
                        <div style={{fontSize:9,color:t.warn,fontFamily:"IBM Plex Mono",marginBottom:5,opacity:0.7}}>⚠ GENOME ASSEMBLY YOK</div>
                        {orgResult.strains.filter(s => !s.has_assembly).map(s => (
                          <div key={s.bacdive_id}
                            className={`strain-card ${selectedStrain?.bacdive_id===s.bacdive_id ? "strain-card-selected-amber" : "strain-card-unselected-amber"}`}
                            onClick={() => { setSelectedStrain(s); setProductResult(null); }}>
                            <div style={{color:t.text,fontSize:13,fontWeight:600,marginBottom:4}}>{s.strain_name}</div>
                            <div style={{display:"flex",gap:12,alignItems:"center"}}>
                              <span style={{fontSize:11,color:t.textMuted}}>BacDive: <span style={{color:t.warn}}>{s.bacdive_id}</span></span>
                              <a href={s.bacdive_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}
                                style={{fontSize:11,color:t.textMuted,textDecoration:"none",borderBottom:`1px dashed ${t.border}`}}>BacDive ↗</a>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedStrain && (
                      <div style={{marginTop:8,padding:"7px 10px",borderRadius:3,background:t.accentDim,border:`1px solid ${t.accentDim.replace("0.1","0.2")}`}}>
                        <span style={{fontSize:10,color:t.accent,fontFamily:"IBM Plex Mono"}}>SEÇİLİ: </span>
                        <span style={{fontSize:11,color:t.text}}>{selectedStrain.strain_name}</span>
                        {selectedStrain.accession && <span style={{fontSize:11,color:t.blue,marginLeft:8}}>({selectedStrain.accession})</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 2: Product */}
              {orgResult?.found && (
                <div className="card" style={{animationDelay:"0.1s"}}>
                  <div className="card-label">02 — Product Sorgulama</div>
                  <div style={{marginBottom:8}}>
                    <TagsInput tags={prodTags} setTags={setProdTags}
                      placeholder="Product ekle, Enter'a bas… (ör: levan, glucan)" disabled={productLoading} />
                    <div className="input-hint">Birden fazla keyword: her birini girdikten sonra Enter veya virgül</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button className="btn btn-primary" onClick={handleSearchProduct}
                      disabled={!prodTags.length || productLoading}>
                      {productLoading ? <IconLoader/> : <IconSearch/>}
                      {productLoading ? "Aranıyor" : "Feature Table'da Ara"}
                    </button>
                  </div>

                  {!productResult && !productLoading && (
                    <div className="examples">
                      <span style={{fontSize:"10px",color:t.textDim,fontFamily:"IBM Plex Mono,monospace",marginRight:4}}>örnek:</span>
                      {PROD_EXAMPLES.map(e => <span key={e} className="example-chip" onClick={() => setProdTags(prev => prev.includes(e)?prev:[...prev,e])}>{e}</span>)}
                    </div>
                  )}

                  {productLoading && <LoadingDots text="Annotation indiriliyor ve taranıyor" />}

                  {productResult && !productResult.error && (
                    <div style={{marginTop:16, animation:"fadeUp 0.4s ease"}}>
                      {productResult.error_code === "NO_ASSEMBLY" && <StatusMsg type="warn">Genome assembly bulunamadı.</StatusMsg>}
                      {productResult.error_code === "NO_GFF_URL"  && <StatusMsg type="warn">Annotation dosyası bulunamadı. Accession: {productResult.accession}</StatusMsg>}
                      {productResult.error_code === "DOWNLOAD_ERROR" && <StatusMsg type="error">İndirilemedi: {productResult.message}</StatusMsg>}
                      {productResult.error_code === "NO_PRODUCT"  && (
                        <StatusMsg type="error">"{productResult.product_query || prodTags.join(", ")}" bu organism'da bulunamadı.</StatusMsg>
                      )}
                      {productResult.found && (
                        <>
                          <div className="result-header">
                            <div>
                              <div style={{fontFamily:"IBM Plex Mono,monospace",fontSize:12,color:t.text}}>
                                "<span style={{color:t.accent}}>{productResult.product_query}</span>" içeren feature'lar
                              </div>
                              <div style={{fontSize:11,color:t.textMuted,marginTop:3,fontFamily:"IBM Plex Mono,monospace"}}>
                                <a href={`https://www.ncbi.nlm.nih.gov/datasets/genome/${productResult.accession}/`}
                                  target="_blank" rel="noreferrer" style={{color:t.accent,textDecoration:"none"}}>
                                  {productResult.accession}
                                </a>
                                {" · "} BacDive ID: {productResult.bacdive_id}
                                {" · "} <span style={{color:t.blue}}>{productResult.source}</span>
                              </div>
                            </div>
                            <div className="result-count">{productResult.total} eşleşme</div>
                          </div>
                          <FeatureTable rows={productResult.results} t={t} />
                        </>
                      )}
                    </div>
                  )}
                  {productResult?.error && <StatusMsg type="error">{productResult.message}</StatusMsg>}
                </div>
              )}
            </>
          )}

          {/* Footer */}
          <div style={{textAlign:"center",marginTop:36,fontFamily:"IBM Plex Mono,monospace",fontSize:10,color:t.textDim,letterSpacing:"0.5px"}}>
            BacDive API v2 · NCBI Datasets · Bakta annotation · DeepDive
          </div>

        </div>
      </div>
    </>
  );
}
