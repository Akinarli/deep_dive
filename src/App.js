import { useState, useEffect, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const API_BASE = "http://localhost:5050";   // change to your backend URL
const DEMO_MODE = false;                      // set false when backend is running

// ─── DEMO DATA ─────────────────────────────────────────────────────────────
const DEMO_ORGANISMS = {
  "leuconostoc mesenteroides": { found: true, bacdive_id: 3432, bacdive_url: "https://bacdive.dsmz.de/strain/3432", strain_name: "Leuconostoc mesenteroides DSM 20343", total_hits: 3 },
  "pseudomonas aeruginosa": { found: true, bacdive_id: 1522, bacdive_url: "https://bacdive.dsmz.de/strain/1522", strain_name: "Pseudomonas aeruginosa DSM 1117", total_hits: 12 },
  "streptococcus mutans": { found: true, bacdive_id: 8982, bacdive_url: "https://bacdive.dsmz.de/strain/8982", strain_name: "Streptococcus mutans DSM 20523", total_hits: 7 },
  "bacillus subtilis": { found: true, bacdive_id: 3034, bacdive_url: "https://bacdive.dsmz.de/strain/3034", strain_name: "Bacillus subtilis subsp. subtilis DSM 10", total_hits: 45 },
  "xyz unknownus": { found: false, message: "BacDive'da kayıt bulunamadı." },
};

const DEMO_PRODUCTS = {
  "glucan": {
    found: true, accession: "GCF_000026045.1", total: 3,
    results: [
      { locus_tag: "LEUM_1823", contig: "CP001837.1", start: "1923401", stop: "1926700", strand: "+", type: "CDS", gene: "gtfB", product: "glucan biosynthesis protein B" },
      { locus_tag: "LEUM_0244", contig: "CP001837.1", start: "265810", stop: "267021", strand: "-", type: "CDS", gene: "gtfC", product: "glucan branching enzyme GtfC" },
      { locus_tag: "LEUM_1104", contig: "CP001837.1", start: "1178440", stop: "1179882", strand: "+", type: "CDS", gene: "", product: "1,3-beta-glucan synthase component" },
    ]
  },
  "transferase": {
    found: true, accession: "GCF_000026045.1", total: 5,
    results: [
      { locus_tag: "LEUM_0055", contig: "CP001837.1", start: "58211", stop: "59433", strand: "+", type: "CDS", gene: "aceA", product: "acetyltransferase" },
      { locus_tag: "LEUM_0312", contig: "CP001837.1", start: "337881", stop: "339100", strand: "-", type: "CDS", gene: "", product: "methyltransferase domain protein" },
      { locus_tag: "LEUM_0890", contig: "CP001837.1", start: "950220", stop: "951770", strand: "+", type: "CDS", gene: "mraY", product: "phospho-N-acetylmuramoyl-pentapeptide-transferase" },
      { locus_tag: "LEUM_1200", contig: "CP001837.1", start: "1289001", stop: "1290322", strand: "+", type: "CDS", gene: "sat", product: "sulfate adenylyltransferase" },
      { locus_tag: "LEUM_1675", contig: "CP001837.1", start: "1782500", stop: "1783900", strand: "-", type: "CDS", gene: "hemL", product: "glutamate-1-semialdehyde aminotransferase" },
    ]
  },
  "hypothetical": { found: false, error_code: "NO_PRODUCT", message: "'hypothetical' product feature table'da bulunamadı." },
  "ribosomal": {
    found: true, accession: "GCF_000026045.1", total: 2,
    results: [
      { locus_tag: "LEUM_r01", contig: "CP001837.1", start: "10100", stop: "11633", strand: "+", type: "rRNA", gene: "rrsA", product: "16S ribosomal RNA" },
      { locus_tag: "LEUM_r02", contig: "CP001837.1", start: "12000", stop: "14922", strand: "+", type: "rRNA", gene: "rrlA", product: "23S ribosomal RNA" },
    ]
  }
};

// ─── API CALLS ─────────────────────────────────────────────────────────────
async function apiCheckOrganism(name) {
  if (DEMO_MODE) {
    await new Promise(r => setTimeout(r, 900 + Math.random() * 600));
    const key = name.toLowerCase().trim();
    for (const [k, v] of Object.entries(DEMO_ORGANISMS)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    return { found: false, message: "BacDive'da kayıt bulunamadı." };
  }
  const res = await fetch(`${API_BASE}/check-organism`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

async function apiSearchProduct(bacdive_id, product, strainRaw) {
  if (DEMO_MODE) {
    await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
    const key = product.toLowerCase().trim();
    for (const [k, v] of Object.entries(DEMO_PRODUCTS)) {
      if (key.includes(k) || k.includes(key)) return { ...v, bacdive_id, product_query: product };
    }
    return { found: false, error_code: "NO_PRODUCT", message: `'${product}' product feature table'da bulunamadı.` };
  }
  const res = await fetch(`${API_BASE}/search-product`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bacdive_id, product, _strain: strainRaw }),
  });
  return res.json();
}

// ─── ICONS ──────────────────────────────────────────────────────────────────
const IconDNA = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M2 2c0 0 4 2 8 4s8 6 8 10"/>
    <path d="M22 22c0 0-4-2-8-4s-8-6-8-10"/>
    <path d="M6 4.5h12M6 8h12M6 16h12M6 19.5h12"/>
  </svg>
);

const IconSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);

const IconCheck = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const IconX = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const IconExternal = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const IconLoader = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{animation: "spin 1s linear infinite"}}>
    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
  </svg>
);

const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

// ─── STYLES ────────────────────────────────────────────────────────────────
const STYLE = `
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  @keyframes scanline {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100vh); }
  }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

  body {
    font-family: 'IBM Plex Sans', sans-serif;
    background: #0a0c0f;
    color: #d4e0cc;
    min-height: 100vh;
    overflow-x: hidden;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 20px 80px;
    position: relative;
  }

  .grid-bg {
    position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      linear-gradient(rgba(74, 222, 128, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(74, 222, 128, 0.03) 1px, transparent 1px);
    background-size: 40px 40px;
  }

  .scanline {
    position: fixed; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, rgba(74,222,128,0.08), transparent);
    pointer-events: none; z-index: 1;
    animation: scanline 8s linear infinite;
  }

  .container {
    width: 100%; max-width: 860px;
    position: relative; z-index: 2;
  }

  /* Header */
  .header { text-align: center; margin-bottom: 56px; }
  .header-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 52px; height: 52px; border: 1px solid rgba(74,222,128,0.3);
    border-radius: 4px; color: #4ade80; margin-bottom: 20px;
    background: rgba(74,222,128,0.05);
  }
  .header h1 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 28px; font-weight: 600; letter-spacing: -0.5px;
    color: #e8f5e2;
    line-height: 1;
  }
  .header h1 span { color: #4ade80; }
  .header-sub {
    font-size: 13px; color: #5a6e52; margin-top: 10px;
    font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.5px;
  }
  .demo-badge {
    display: inline-block; margin-top: 12px;
    padding: 3px 10px; border: 1px solid rgba(251,191,36,0.4);
    border-radius: 2px; font-size: 11px; color: #fbbf24;
    font-family: 'IBM Plex Mono', monospace; letter-spacing: 1px;
    background: rgba(251,191,36,0.06);
  }

  /* Step indicator */
  .steps { display: flex; align-items: center; gap: 0; margin-bottom: 36px; }
  .step-item { display: flex; align-items: center; gap: 10px; }
  .step-num {
    width: 28px; height: 28px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 600;
    border: 1px solid; transition: all 0.3s;
  }
  .step-num.active { border-color: #4ade80; color: #4ade80; background: rgba(74,222,128,0.1); }
  .step-num.done { border-color: #4ade80; color: #0a0c0f; background: #4ade80; }
  .step-num.pending { border-color: #2a3530; color: #3a4a42; }
  .step-label { font-size: 12px; letter-spacing: 0.5px; transition: color 0.3s; }
  .step-label.active { color: #d4e0cc; }
  .step-label.done { color: #4ade80; }
  .step-label.pending { color: #3a4a42; }
  .step-connector {
    width: 60px; height: 1px; margin: 0 16px;
    background: #1a2520; flex-shrink: 0;
    position: relative; overflow: hidden;
  }
  .step-connector.active::after {
    content: ''; position: absolute; inset: 0;
    background: linear-gradient(90deg, transparent, #4ade80, transparent);
    animation: scanline 2s linear infinite;
  }

  /* Card */
  .card {
    background: #0e1512; border: 1px solid #1c2820;
    border-radius: 4px; padding: 32px;
    animation: fadeUp 0.4s ease both;
  }
  .card + .card { margin-top: 16px; }

  .card-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: 2px; color: #4ade80;
    text-transform: uppercase; margin-bottom: 20px;
    display: flex; align-items: center; gap: 8px;
  }
  .card-label::before {
    content: ''; display: block; width: 16px; height: 1px; background: #4ade80;
  }

  /* Input */
  .input-row { display: flex; gap: 12px; }
  .input-wrap { flex: 1; position: relative; }
  .input-wrap input {
    width: 100%;
    background: #090c0a; border: 1px solid #1c2820;
    border-radius: 3px; padding: 12px 16px;
    font-family: 'IBM Plex Mono', monospace; font-size: 14px;
    color: #d4e0cc; outline: none;
    transition: border-color 0.2s;
  }
  .input-wrap input:focus { border-color: #4ade80; }
  .input-wrap input::placeholder { color: #2a3a30; }
  .input-wrap input:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 20px; border-radius: 3px; border: none;
    font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all 0.2s; white-space: nowrap;
  }
  .btn-primary {
    background: #4ade80; color: #061008;
  }
  .btn-primary:hover:not(:disabled) { background: #86efac; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-ghost {
    background: transparent; border: 1px solid #1c2820; color: #5a6e52;
    font-size: 12px; padding: 8px 14px;
  }
  .btn-ghost:hover { border-color: #4ade80; color: #4ade80; }

  /* Status messages */
  .status {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 14px 16px; border-radius: 3px; margin-top: 16px;
    font-size: 13px; animation: fadeUp 0.3s ease;
  }
  .status-success { background: rgba(74,222,128,0.07); border: 1px solid rgba(74,222,128,0.2); color: #86efac; }
  .status-error { background: rgba(248,113,113,0.07); border: 1px solid rgba(248,113,113,0.2); color: #fca5a5; }
  .status-warn { background: rgba(251,191,36,0.07); border: 1px solid rgba(251,191,36,0.2); color: #fde68a; }
  .status-icon { flex-shrink: 0; margin-top: 1px; }

  /* BacDive result card */
  .organism-result {
    margin-top: 20px; padding: 16px 20px;
    background: #090c0a; border: 1px solid rgba(74,222,128,0.2);
    border-radius: 3px; animation: fadeUp 0.3s ease;
  }
  .organism-result-name {
    font-size: 15px; font-weight: 500; color: #d4e0cc; font-style: italic;
    margin-bottom: 8px;
  }
  .organism-meta { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 12px; }
  .meta-item {
    font-family: 'IBM Plex Mono', monospace; font-size: 12px;
  }
  .meta-key { color: #3a5040; }
  .meta-val { color: #4ade80; margin-left: 6px; }
  .bacdive-link {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    color: #4ade80; text-decoration: none; padding: 6px 12px;
    border: 1px solid rgba(74,222,128,0.3); border-radius: 2px;
    transition: all 0.2s;
  }
  .bacdive-link:hover { background: rgba(74,222,128,0.1); }

  /* Table */
  .table-wrap { overflow-x: auto; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; }
  thead tr { border-bottom: 1px solid #1c2820; }
  th {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px; letter-spacing: 1px;
    color: #3a5040; font-weight: 500; text-transform: uppercase;
    padding: 10px 14px; text-align: left; white-space: nowrap;
  }
  td {
    font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    padding: 11px 14px; color: #8ab09a; border-bottom: 1px solid #111810;
    white-space: nowrap;
  }
  tr:hover td { background: rgba(74,222,128,0.03); color: #b8d4be; }
  td.product-cell { color: #d4e0cc; white-space: normal; max-width: 240px; }
  td.locus-cell { color: #4ade80; }
  td.type-cell {
    font-size: 10px; font-weight: 600; letter-spacing: 1px;
  }
  td.type-CDS { color: #60a5fa; }
  td.type-rRNA { color: #c084fc; }
  td.type-tRNA { color: #f472b6; }

  /* Result header */
  .result-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px; flex-wrap: wrap; gap: 12px;
  }
  .result-title {
    font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: #d4e0cc;
  }
  .result-count {
    font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    background: rgba(74,222,128,0.1); color: #4ade80;
    padding: 4px 10px; border-radius: 2px; border: 1px solid rgba(74,222,128,0.2);
  }
  .accession-tag {
    font-size: 12px; color: #5a7060;
    font-family: 'IBM Plex Mono', monospace;
  }
  .accession-tag a { color: #4ade80; text-decoration: none; }
  .accession-tag a:hover { text-decoration: underline; }

  /* Loading dots */
  .loading-row {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 0; color: #3a5040;
    font-family: 'IBM Plex Mono', monospace; font-size: 13px;
  }
  .loading-dots span {
    display: inline-block; width: 4px; height: 4px;
    border-radius: 50%; background: #4ade80; margin: 0 2px;
    animation: pulse 1.4s ease infinite;
  }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  /* Hint examples */
  .examples { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
  .example-chip {
    font-family: 'IBM Plex Mono', monospace; font-size: 11px;
    padding: 4px 10px; border: 1px solid #1c2820; border-radius: 2px;
    color: #3a5040; cursor: pointer; transition: all 0.2s;
  }
  .example-chip:hover { border-color: #4ade80; color: #4ade80; }
`;

// ─── SUBCOMPONENTS ──────────────────────────────────────────────────────────
function StepIndicator({ step }) {
  const steps = ["Organizma Ara", "Product Sorgula"];
  return (
    <div className="steps">
      {steps.map((label, i) => {
        const num = i + 1;
        const state = num < step ? "done" : num === step ? "active" : "pending";
        return (
          <>
            <div className="step-item" key={num}>
              <div className={`step-num ${state}`}>
                {state === "done" ? <IconCheck /> : num}
              </div>
              <span className={`step-label ${state}`}>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-connector ${step === 2 ? "active" : ""}`} key={`c${i}`} />
            )}
          </>
        );
      })}
    </div>
  );
}

function LoadingDots({ text }) {
  return (
    <div className="loading-row">
      <IconLoader />
      <span>{text}</span>
      <span className="loading-dots"><span/><span/><span/></span>
    </div>
  );
}

function StatusMsg({ type, children }) {
  const icons = {
    success: <span style={{color:"#4ade80"}}><IconCheck /></span>,
    error: <span style={{color:"#f87171"}}><IconX /></span>,
    warn: <span style={{color:"#fbbf24"}}>⚠</span>,
  };
  return (
    <div className={`status status-${type}`}>
      <span className="status-icon">{icons[type]}</span>
      <span>{children}</span>
    </div>
  );
}

function FeatureTable({ rows, bacdiveId }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Locus Tag</th>
            <th>Contig</th>
            <th>Start</th>
            <th>Stop</th>
            <th>Strand</th>
            <th>Type</th>
            <th>Gene</th>
            <th>Product</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="locus-cell">
                {r.locus_tag ? (
                  <a
                    href={"https://www.ncbi.nlm.nih.gov/nuccore/" + r.contig + "?from=" + r.start + "&to=" + r.stop + "&strand=" + (r.strand === "-" ? "2" : "1")}
                    target="_blank"
                    rel="noreferrer"
                    style={{color:"#4ade80",textDecoration:"none",borderBottom:"1px dashed rgba(74,222,128,0.4)"}}
                    title={"NCBI Nucleotide: " + r.contig + ":" + r.start + "-" + r.stop}
                  >
                    {r.locus_tag}
                  </a>
                ) : "—"}
              </td>
              <td>{r.contig}</td>
              <td>{Number(r.start).toLocaleString()}</td>
              <td>{Number(r.stop).toLocaleString()}</td>
              <td style={{color: r.strand === "+" ? "#4ade80" : "#f472b6"}}>{r.strand}</td>
              <td className={`type-cell type-${r.type}`}>{r.type}</td>
              <td style={{color:"#93c5fd"}}>{r.gene || "—"}</td>
              <td className="product-cell">{r.product}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(1);
  const [orgInput, setOrgInput] = useState("");
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgResult, setOrgResult] = useState(null);
  const [productInput, setProductInput] = useState("");
  const [productLoading, setProductLoading] = useState(false);
  const [productResult, setProductResult] = useState(null);

  const orgRef = useRef(null);
  const prodRef = useRef(null);

  async function handleCheckOrganism() {
    if (!orgInput.trim()) return;
    setOrgLoading(true);
    setOrgResult(null);
    setProductResult(null);
    try {
      const data = await apiCheckOrganism(orgInput.trim());
      setOrgResult(data);
      if (data.found) {
        setStep(2);
        setTimeout(() => prodRef.current?.focus(), 400);
      }
    } catch (e) {
      setOrgResult({ error: true, message: `Bağlantı hatası: ${e.message}` });
    } finally {
      setOrgLoading(false);
    }
  }

  async function handleSearchProduct() {
    if (!productInput.trim() || !orgResult?.bacdive_id) return;
    setProductLoading(true);
    setProductResult(null);
    try {
      const data = await apiSearchProduct(orgResult.bacdive_id, productInput.trim(), orgResult._strain);
      setProductResult(data);
    } catch (e) {
      setProductResult({ error: true, message: `Bağlantı hatası: ${e.message}` });
    } finally {
      setProductLoading(false);
    }
  }

  function resetAll() {
    setStep(1);
    setOrgInput("");
    setOrgResult(null);
    setProductInput("");
    setProductResult(null);
    setTimeout(() => orgRef.current?.focus(), 100);
  }

  const ORG_EXAMPLES = ["Leuconostoc mesenteroides", "Pseudomonas aeruginosa", "Bacillus subtilis"];
  const PROD_EXAMPLES = ["glucan", "transferase", "ribosomal"];

  return (
    <>
      <style>{STYLE}</style>
      <div className="app">
        <div className="grid-bg" />
        <div className="scanline" />
        <div className="container">
          {/* Header */}
          <div className="header">
            <div className="header-icon"><IconDNA /></div>
            <h1>Bac<span>Dive</span> Feature Search</h1>
            <div className="header-sub">BacDive API v2 · NCBI GFF Annotation · Feature Table Query</div>
            {DEMO_MODE && <div className="demo-badge">DEMO MODE — Backend'i başlatınca DEMO_MODE=false yap</div>}
          </div>

          <StepIndicator step={step} />

          {/* ── STEP 1: Organism ── */}
          <div className="card">
            <div className="card-label">01 — Organizma Sorgulama</div>

            <div className="input-row">
              <div className="input-wrap">
                <input
                  ref={orgRef}
                  value={orgInput}
                  onChange={e => setOrgInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleCheckOrganism()}
                  placeholder="Genus species veya strain adı girin…"
                  disabled={orgLoading}
                  autoFocus
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCheckOrganism}
                disabled={!orgInput.trim() || orgLoading}
              >
                {orgLoading ? <IconLoader /> : <IconSearch />}
                {orgLoading ? "Sorgulanıyor" : "BacDive'da Ara"}
              </button>
              {orgResult && (
                <button className="btn btn-ghost" onClick={resetAll}>Sıfırla</button>
              )}
            </div>

            {!orgResult && !orgLoading && (
              <div className="examples">
                <span style={{fontSize:"11px", color:"#2a3a30", fontFamily:"'IBM Plex Mono', monospace", marginRight: 4}}>örnek:</span>
                {ORG_EXAMPLES.map(e => (
                  <span key={e} className="example-chip" onClick={() => setOrgInput(e)}>{e}</span>
                ))}
              </div>
            )}

            {orgLoading && <LoadingDots text="BacDive API sorgulanıyor" />}

            {orgResult?.error && (
              <StatusMsg type="error">{orgResult.message}</StatusMsg>
            )}

            {orgResult && !orgResult.error && !orgResult.found && (
              <StatusMsg type="error">
                <strong>Kayıt bulunamadı:</strong> "{orgInput}" için BacDive'da herhangi bir kayıt mevcut değil.
              </StatusMsg>
            )}

            {orgResult?.found && (
              <div className="organism-result">
                <div className="organism-result-name">{orgResult.strain_name}</div>
                <div className="organism-meta">
                  <div className="meta-item"><span className="meta-key">BacDive ID</span><span className="meta-val">{orgResult.bacdive_id}</span></div>
                  <div className="meta-item"><span className="meta-key">Toplam kayıt</span><span className="meta-val">{orgResult.total_hits}</span></div>
                </div>
                <a className="bacdive-link" href={orgResult.bacdive_url} target="_blank" rel="noreferrer">
                  <IconExternal /> {orgResult.bacdive_url}
                </a>
              </div>
            )}
          </div>

          {/* ── STEP 2: Product ── */}
          {orgResult?.found && (
            <div className="card" style={{animationDelay:"0.1s"}}>
              <div className="card-label">02 — Product Sorgulama</div>

              <div className="input-row">
                <div className="input-wrap">
                  <input
                    ref={prodRef}
                    value={productInput}
                    onChange={e => setProductInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearchProduct()}
                    placeholder="Product adı girin (ör: glucan, transferase…)"
                    disabled={productLoading}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleSearchProduct}
                  disabled={!productInput.trim() || productLoading}
                >
                  {productLoading ? <IconLoader /> : <IconSearch />}
                  {productLoading ? "Aranıyor" : "Feature Table'da Ara"}
                </button>
              </div>

              {!productResult && !productLoading && (
                <div className="examples">
                  <span style={{fontSize:"11px", color:"#2a3a30", fontFamily:"'IBM Plex Mono', monospace", marginRight: 4}}>örnek:</span>
                  {PROD_EXAMPLES.map(e => (
                    <span key={e} className="example-chip" onClick={() => setProductInput(e)}>{e}</span>
                  ))}
                </div>
              )}

              {productLoading && <LoadingDots text="NCBI annotation indiriliyor ve taranıyor" />}

              {/* Product results */}
              {productResult && !productResult.error && (
                <div style={{marginTop: 20, animation: "fadeUp 0.4s ease"}}>
                  {/* Error states */}
                  {productResult.error_code === "NO_ASSEMBLY" && (
                    <StatusMsg type="warn">Bu BacDive kaydında genome assembly accession bilgisi bulunamadı. Feature table erişilemiyor.</StatusMsg>
                  )}
                  {productResult.error_code === "NO_GFF_URL" && (
                    <StatusMsg type="warn">
                      Assembly <strong>{productResult.accession}</strong> için NCBI'da annotation (GFF) dosyası bulunamadı.
                    </StatusMsg>
                  )}
                  {productResult.error_code === "DOWNLOAD_ERROR" && (
                    <StatusMsg type="error">Annotation dosyası indirilemedi: {productResult.message}</StatusMsg>
                  )}
                  {productResult.error_code === "NO_PRODUCT" && (
                    <StatusMsg type="error">
                      <strong>"{productResult.product_query || productInput}"</strong> bu organizmaya ait feature table'da hiçbir kaydla eşleşmedi.
                    </StatusMsg>
                  )}

                  {/* Success */}
                  {productResult.found && (
                    <>
                      <div className="result-header">
                        <div>
                          <div className="result-title">
                            "<span style={{color:"#4ade80"}}>{productResult.product_query}</span>" içeren feature'lar
                          </div>
                          <div className="accession-tag" style={{marginTop:4}}>
                            Assembly:{" "}
                            <a href={`https://www.ncbi.nlm.nih.gov/datasets/genome/${productResult.accession}/`} target="_blank" rel="noreferrer">
                              {productResult.accession}
                            </a>
                            {" · "} BacDive ID: {productResult.bacdive_id}
                          </div>
                        </div>
                        <div className="result-count">{productResult.total} eşleşme</div>
                      </div>
                      <FeatureTable rows={productResult.results} bacdiveId={productResult.bacdive_id} />
                    </>
                  )}
                </div>
              )}

              {productResult?.error && (
                <StatusMsg type="error">{productResult.message}</StatusMsg>
              )}
            </div>
          )}

          {/* Footer note */}
          <div style={{textAlign:"center", marginTop:40, fontFamily:"'IBM Plex Mono', monospace", fontSize:"11px", color:"#1e2e24", letterSpacing:"0.5px"}}>
            BacDive API v2 · NCBI Datasets · Feature Table via GFF3 annotation
          </div>
        </div>
      </div>
    </>
  );
}