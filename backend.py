from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import bacdive
import re
import json
import gzip
import requests
import urllib.parse
import time
import threading

app = Flask(__name__)
CORS(app)

BACDIVE_WEB = "https://bacdive.dsmz.de/strain"
CDN_BASE    = "https://cdn.dsmz.de/genomes"
client      = bacdive.BacdiveClient()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://bacdive.dsmz.de/",
}

# ─── DISK + MEMORY CACHE ─────────────────────────────────────────────────────
import os, hashlib, pickle

CACHE_DIR = "/tmp/deepdive_cache"
os.makedirs(CACHE_DIR, exist_ok=True)
_annotation_cache: dict = {}
_cache_lock = threading.Lock()
CACHE_TTL = 60 * 60 * 24 * 30  # 30 gün

def _cache_path(accession: str) -> str:
    key = hashlib.md5(accession.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{key}.pkl")

def cache_get(accession: str):
    with _cache_lock:
        # Önce memory
        entry = _annotation_cache.get(accession)
        if entry and (time.time() - entry["ts"]) < CACHE_TTL:
            return entry["content"]
        # Sonra disk
        path = _cache_path(accession)
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    entry = pickle.load(f)
                if (time.time() - entry["ts"]) < CACHE_TTL:
                    _annotation_cache[accession] = entry
                    return entry["content"]
            except Exception:
                pass
        return None

def cache_set(accession: str, content: str):
    with _cache_lock:
        entry = {"content": content, "ts": time.time()}
        _annotation_cache[accession] = entry
        try:
            path = _cache_path(accession)
            with open(path, "wb") as f:
                pickle.dump(entry, f)
        except Exception:
            pass

# ─── BacDive ──────────────────────────────────────────────────────────────────

def search_organism(name: str) -> list:
    count = client.search(taxonomy=name)
    if count == 0:
        parts = name.strip().split()
        if len(parts) >= 2:
            count = client.search(taxonomy=" ".join(parts[:2]))
    if count == 0:
        return []
    hits = []
    for strain in client.retrieve():
        bid     = strain.get("General", {}).get("BacDive-ID")
        species = ""
        for section in strain.values():
            if isinstance(section, dict):
                for f in ["species", "full_scientific_name", "full_name"]:
                    if section.get(f):
                        species = section[f]
                        break
            if species:
                break
        has_assembly = bool(re.search(r"GC[AF]_\d{9,}", json.dumps(strain)))
        hits.append({"id": bid, "name": species or name, "raw": strain, "has_assembly": has_assembly})
    hits.sort(key=lambda x: (0 if x["has_assembly"] else 1))
    return hits

def find_accession(strain_raw) -> str | None:
    text = json.dumps(strain_raw)
    m = re.search(r"GC[AF]_\d{9,}(?:\.\d+)?", text)
    return m.group(0) if m else None

def find_accession_via_ncbi(organism_name: str) -> str | None:
    try:
        es = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "assembly", "term": f"{organism_name}[Organism]",
                    "retmode": "json", "retmax": 5, "sort": "submissiondate desc"},
            timeout=(8, 15))
        if not es.ok:
            return None
        ids = es.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return None
        esummary = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={"db": "assembly", "id": ids[0], "retmode": "json"}, timeout=(8, 15))
        if not esummary.ok:
            return None
        doc = esummary.json().get("result", {}).get(ids[0], {})
        return doc.get("assemblyaccession") or doc.get("synonym", {}).get("genbank")
    except Exception as e:
        print(f"[WARN] NCBI taxonomy arama hatasi: {e}")
        return None

# ─── ANNOTATION DOWNLOAD (with cache) ────────────────────────────────────────

def _download_annotation(accession: str) -> tuple[str | None, str]:
    """
    Önce cache'e bak; yoksa DSMZ CDN → NCBI FTP sırasıyla indir.
    Returns: (content_str | None, source_label)
    """
    cached = cache_get(accession)
    if cached:
        print(f"[CACHE HIT] {accession}")
        return cached, "cache"

    acc_base = accession.split(".")[0]

    # 1. DSMZ CDN Bakta GBFF
    for url in [f"{CDN_BASE}/{acc_base}.gbff", f"{CDN_BASE}/{accession}.gbff",
                f"{CDN_BASE}/{acc_base}.gbff.gz", f"{CDN_BASE}/{accession}.gbff.gz"]:
        try:
            r = requests.get(url, headers=HEADERS, timeout=(10, 20))
            if r.ok:
                raw = r.content
                content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                          if url.endswith(".gz") else raw.decode("utf-8", errors="replace")
                cache_set(accession, content)
                print(f"[GBFF] {accession} indirildi ({len(content)} chars)")
                return content, "BacDive Bakta annotation"
        except Exception:
            continue

    # 2. NCBI GFF
    try:
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FT
        with ThreadPoolExecutor(max_workers=1) as ex:
            gff_url = ex.submit(_find_ncbi_gff_url, accession).result(timeout=45)
    except Exception:
        gff_url = None
    if gff_url:
        try:
            from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
            def _download_gff():
                chunks = []
                with requests.get(gff_url, headers=HEADERS, timeout=(10, 90), stream=True) as r:
                    r.raise_for_status()
                    size = 0
                    for chunk in r.iter_content(chunk_size=65536):
                        chunks.append(chunk)
                        size += len(chunk)
                        if size > 80 * 1024 * 1024:
                            raise Exception("Dosya çok büyük (>80MB)")
                return b"".join(chunks)
            with ThreadPoolExecutor(max_workers=1) as ex:
                future = ex.submit(_download_gff)
                try:
                    raw = future.result(timeout=25)
                except FuturesTimeout:
                    future.cancel()
                    raise Exception("GFF indirme timeout (25s)")
            content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                      if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
            cache_set(accession, content)
            print(f"[GFF] {accession} indirildi ({len(content)} chars)")
            return content, "NCBI GFF annotation"
        except Exception as e:
            print(f"[WARN] GFF indirme hatasi ({accession}): {e}")

    return None, "indirilemedi"

def _find_ncbi_gff_url(accession: str) -> str | None:
    acc_base = accession.split(".")[0]
    try:
        es = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "assembly", "term": acc_base, "retmode": "json"}, timeout=(8, 15))
        ids = es.json().get("esearchresult", {}).get("idlist", [])
        if ids:
            esummary = requests.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                params={"db": "assembly", "id": ids[0], "retmode": "json"}, timeout=(8, 15))
            doc = esummary.json().get("result", {}).get(ids[0], {})
            ftp = doc.get("ftppath_refseq") or doc.get("ftppath_genbank")
            if ftp:
                ftp = ftp.replace("ftp://", "https://")
                r = requests.get(ftp + "/", timeout=(8, 15))
                files = re.findall(r'href="([^"]+genomic\.gff\.gz)"', r.text)
                if files:
                    fname = files[0]
                    return fname if fname.startswith("http") else ftp + "/" + fname
    except Exception:
        pass
    digits = re.sub(r"\D", "", acc_base)
    if len(digits) >= 9:
        d1, d2, d3 = digits[:3], digits[3:6], digits[6:9]
        for prefix in ["GCF", "GCA"]:
            ftp_base = f"https://ftp.ncbi.nlm.nih.gov/genomes/all/{prefix}/{d1}/{d2}/{d3}/"
            try:
                r = requests.get(ftp_base, timeout=(8, 15))
                if not r.ok:
                    continue
                folders = re.findall(r'href="([^"\']+/)"', r.text)
                for folder in folders:
                    folder = folder.strip("/")
                    if acc_base in folder:
                        folder_url = ftp_base + folder + "/"
                        r2 = requests.get(folder_url, timeout=(8, 15))
                        files = re.findall(r'href="([^"\']+genomic\.gff\.gz)"', r2.text)
                        if files:
                            fname = files[0]
                            return fname if fname.startswith("http") else folder_url + fname
            except Exception:
                continue
    return None

# ─── PARSERS ──────────────────────────────────────────────────────────────────

def _parse_content(content: str, source: str, product_queries: list[str]) -> list[dict]:
    """content'in tipine göre doğru parser'ı çağır, birden fazla keyword destekle."""
    if "LOCUS" in content[:200] and "FEATURES" in content:
        return _parse_gbff(content, product_queries)
    else:
        return _parse_gff(content, product_queries)

def _parse_gbff(content: str, product_queries: list[str]) -> list[dict]:
    queries_lc = [q.lower().strip() for q in product_queries]
    matches = []
    current_feature = None
    current_attrs   = {}
    current_location = ""
    current_contig  = ""
    lines = content.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("LOCUS"):
            parts = line.split()
            if len(parts) > 1:
                current_contig = parts[1]
        feat_match = re.match(r'^     (\w+)\s+(.+)$', line)
        if feat_match:
            if current_feature and current_attrs.get("product"):
                product = current_attrs.get("product", "")
                matched_queries = [q for q in queries_lc if q in product.lower()]
                if matched_queries:
                    loc = current_location
                    strand = "-" if "complement" in loc else "+"
                    coords = re.findall(r'\d+', loc)
                    matches.append({
                        "locus_tag":      current_attrs.get("locus_tag", ""),
                        "contig":         current_contig,
                        "start":          coords[0] if coords else "",
                        "stop":           coords[-1] if len(coords) > 1 else "",
                        "strand":         strand,
                        "type":           current_feature,
                        "gene":           current_attrs.get("gene", ""),
                        "product":        product,
                        "protein_id":     current_attrs.get("protein_id", ""),
                        "matched_query":  matched_queries[0],
                    })
            current_feature  = feat_match.group(1)
            current_location = feat_match.group(2).strip()
            current_attrs    = {}
        elif line.startswith('                     /'):
            attr_line = line.strip().lstrip('/')
            if '="' in attr_line:
                key, val = attr_line.split('="', 1)
                val = val.rstrip('"')
                while (i + 1 < len(lines)
                       and not lines[i+1].strip().startswith('/')
                       and lines[i+1].startswith('                     ')
                       and not re.match(r'^     \w+\s+', lines[i+1])):
                    i += 1
                    val = val + " " + lines[i].strip().rstrip('"')
                current_attrs[key.strip()] = val.strip()
        i += 1
    # son feature
    if current_feature and current_attrs.get("product"):
        product = current_attrs.get("product", "")
        matched_queries = [q for q in queries_lc if q in product.lower()]
        if matched_queries:
            loc = current_location
            strand = "-" if "complement" in loc else "+"
            coords = re.findall(r'\d+', loc)
            matches.append({
                "locus_tag":     current_attrs.get("locus_tag", ""),
                "contig":        current_contig,
                "start":         coords[0] if coords else "",
                "stop":          coords[-1] if len(coords) > 1 else "",
                "strand":        strand,
                "type":          current_feature,
                "gene":          current_attrs.get("gene", ""),
                "product":       product,
                "protein_id":    current_attrs.get("protein_id", ""),
                "matched_query": matched_queries[0],
            })
    return matches

def _parse_gff(content: str, product_queries: list[str]) -> list[dict]:
    queries_lc = [q.lower().strip() for q in product_queries]
    matches = []
    for line in content.splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 9:
            continue
        contig, _, feat_type, start, stop, _, strand, _, attrs = parts[:9]
        attr_dict = {}
        for attr in attrs.split(";"):
            if "=" in attr:
                k, v = attr.split("=", 1)
                attr_dict[k.strip()] = urllib.parse.unquote(v.strip())
        product = attr_dict.get("product", "")
        matched_queries = [q for q in queries_lc if q in product.lower()]
        if not matched_queries:
            continue
        matches.append({
            "locus_tag":     attr_dict.get("locus_tag", ""),
            "contig":        contig,
            "start":         start,
            "stop":          stop,
            "strand":        strand,
            "type":          feat_type,
            "gene":          attr_dict.get("gene", ""),
            "product":       product,
            "protein_id":    attr_dict.get("protein_id", ""),
            "matched_query": matched_queries[0],
        })
    return matches

# ─── PROTEIN SEQUENCE ─────────────────────────────────────────────────────────

def fetch_protein_sequence(protein_id: str) -> str | None:
    """NCBI Protein'den amino asit dizisini FASTA formatında getir."""
    if not protein_id:
        return None
    try:
        r = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params={"db": "protein", "id": protein_id, "rettype": "fasta", "retmode": "text"},
            timeout=(8, 15))
        if r.ok and r.text.startswith(">"):
            return r.text.strip()
    except Exception as e:
        print(f"[WARN] Protein sekans hatasi: {e}")
    return None

# ─── LEGACY HELPERS (Mod 1 uyumluluğu için) ──────────────────────────────────

def fetch_gbff_features(accession, product_query):
    content, source = _download_annotation(accession)
    if content is None:
        return None, source
    matches = _parse_content(content, source, [product_query])
    return matches, None

def search_ncbi_gff(gff_url, product_query):
    r = requests.get(gff_url, headers=HEADERS, timeout=(10, 30))
    raw = r.content
    content = gzip.decompress(raw).decode("utf-8", errors="replace") \
              if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
    return _parse_gff(content, [product_query])

def find_ncbi_gff(accession):
    return _find_ncbi_gff_url(accession)

# ─── ENDPOINTS ────────────────────────────────────────────────────────────────

@app.route("/check-organism", methods=["POST"])
def check_organism():
    data = request.get_json()
    name = (data or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "name gerekli"}), 400
    try:
        hits = search_organism(name)
    except Exception as e:
        return jsonify({"error": f"BacDive hatasi: {str(e)}"}), 502
    if not hits:
        return jsonify({"found": False, "message": "BacDive'da kayit bulunamadi."})
    strains = []
    for h in hits:
        accession = find_accession(h["raw"])
        strains.append({
            "bacdive_id":   h["id"],
            "bacdive_url":  f"{BACDIVE_WEB}/{h['id']}",
            "strain_name":  h["name"],
            "accession":    accession,
            "has_assembly": bool(accession),
            "_strain":      h["raw"],
        })
    return jsonify({
        "found":        True,
        "total_hits":   len(strains),
        "strains":      strains,
        "bacdive_id":   strains[0]["bacdive_id"],
        "bacdive_url":  strains[0]["bacdive_url"],
        "strain_name":  strains[0]["strain_name"],
        "_strain":      strains[0]["_strain"],
    })


@app.route("/search-product", methods=["POST"])
def search_product():
    data       = request.get_json()
    bid        = (data or {}).get("bacdive_id")
    product_q  = (data or {}).get("product", "").strip()
    strain_raw = (data or {}).get("_strain")

    if not bid or not product_q:
        return jsonify({"error": "bacdive_id ve product gerekli"}), 400

    accession = find_accession(strain_raw) if strain_raw else None
    if not accession:
        try:
            r = requests.get(f"https://api.bacdive.dsmz.de/strain/{bid}",
                             headers={"Accept": "application/json"}, timeout=(8, 15))
            if r.ok:
                accession = find_accession(r.json())
        except Exception:
            pass

    if not accession:
        strain_name = ""
        if strain_raw:
            for section in strain_raw.values():
                if isinstance(section, dict):
                    for f in ["species", "full_scientific_name", "full_name"]:
                        if section.get(f):
                            strain_name = section[f]
                            break
                if strain_name:
                    break
        if strain_name:
            accession = find_accession_via_ncbi(strain_name)

    if not accession:
        return jsonify({
            "found": False, "error_code": "NO_ASSEMBLY",
            "message": "Bu BacDive kaydinda genome assembly accession bulunamadi.",
        })

    # multi-product desteği: virgülle ayır
    product_queries = [p.strip() for p in product_q.split(",") if p.strip()]

    content, source = _download_annotation(accession)
    if content is None:
        return jsonify({
            "found": False, "error_code": "NO_GFF_URL",
            "message": f"Annotation indirilemedi. Accession: {accession}",
            "accession": accession,
        })

    matches = _parse_content(content, source, product_queries)

    if not matches:
        return jsonify({
            "found": False, "error_code": "NO_PRODUCT",
            "message": f"'{product_q}' feature table'da bulunamadi.",
            "accession": accession, "source": source,
        })

    return jsonify({
        "found":         True,
        "accession":     accession,
        "bacdive_id":    bid,
        "product_query": product_q,
        "total":         len(matches),
        "source":        source,
        "results":       matches,
    })


@app.route("/protein-sequence", methods=["POST"])
def protein_sequence():
    """Locus tag veya protein_id için NCBI'dan amino asit dizisi getir."""
    data       = request.get_json()
    protein_id = (data or {}).get("protein_id", "").strip()
    if not protein_id:
        return jsonify({"error": "protein_id gerekli"}), 400
    seq = fetch_protein_sequence(protein_id)
    if seq:
        return jsonify({"found": True, "protein_id": protein_id, "sequence": seq})
    return jsonify({"found": False, "message": "Sekans bulunamadı."})


# ─── MOD 2: Paralel cins tarama (SSE) ────────────────────────────────────────

def sse_event(data: dict) -> str:
    # Render proxy buffer'ını kırmak için padding (en az 1KB)
    payload = json.dumps(data, ensure_ascii=False)
    padding = " " * max(0, 1024 - len(payload))
    return f"data: {payload}{padding}\n\n"


def _worker(accession, product_queries, result_queue):
    """Ayrı process'te çalışır."""
    try:
        content, source = _download_annotation(accession)
        if content is None:
            result_queue.put(("skip", None, None))
        else:
            matches = _parse_content(content, source, product_queries)
            result_queue.put(("ok", matches, source))
    except Exception as e:
        result_queue.put(("error", str(e), None))


def _scan_single(h, accession, product_queries, org_label):
    """Tek bir strain'i tara — ayrı process ile 90s hard timeout."""
    from multiprocessing import Process, Queue

    strain_name = h["name"]
    bid         = h["id"]

    q = Queue()
    p = Process(target=_worker, args=(accession, product_queries, q))
    p.start()
    p.join(timeout=90)

    if p.is_alive():
        p.kill()
        p.join()
        print(f"[TIMEOUT] {strain_name} ({accession}) 90s aşıldı")
        return {"status": "skip", "strain_name": strain_name,
                "accession": accession, "bacdive_id": bid,
                "reason": "Timeout (90s)", "organism": org_label}

    if q.empty():
        return {"status": "skip", "strain_name": strain_name,
                "accession": accession, "bacdive_id": bid,
                "reason": "Sonuç alınamadı", "organism": org_label}

    status, data, source = q.get()

    if status == "skip":
        return {"status": "skip", "strain_name": strain_name,
                "accession": accession, "bacdive_id": bid,
                "reason": "Annotation indirilemedi", "organism": org_label}
    if status == "error":
        return {"status": "skip", "strain_name": strain_name,
                "accession": accession, "bacdive_id": bid,
                "reason": data, "organism": org_label}

    matches = data
    if not matches:
        return {"status": "not_found", "strain_name": strain_name,
                "accession": accession, "bacdive_id": bid, "organism": org_label}

    return {
        "status":      "found",
        "strain_name": strain_name,
        "accession":   accession,
        "bacdive_id":  bid,
        "bacdive_url": f"{BACDIVE_WEB}/{bid}",
        "source":      source,
        "match_count": len(matches),
        "results":     matches,
        "organism":    org_label,
    }





@app.route("/scan-organism", methods=["GET"])
def scan_organism():
    """
    Mod 2: Bir veya birden fazla organizma cinsini sırayla tara.
    Virgülle ayrılmış organism ve product destekler.
    SSE ile her sonuç geldiğinde stream edilir.

    Query params:
        organism: str  — "halomonas" veya "halomonas,pseudomonas"
        product:  str  — "levan" veya "levan,sucrase,fructan"
    """
    organism_raw = request.args.get("organism", "").strip()
    product_raw  = request.args.get("product", "").strip()

    if not organism_raw or not product_raw:
        return jsonify({"error": "organism ve product gerekli"}), 400

    organisms       = [o.strip() for o in organism_raw.split(",") if o.strip()]
    product_queries = [p.strip() for p in product_raw.split(",") if p.strip()]

    def generate():
        yield sse_event({"type": "status",
                         "message": f"{len(organisms)} organizma aranıyor, {len(product_queries)} keyword..."})

        all_pairs = []  # [(h, acc, org_label), ...]
        for org in organisms:
            yield sse_event({"type": "status", "message": f"'{org}' BacDive'da aranıyor..."})
            try:
                hits = search_organism(org)
            except Exception as e:
                yield sse_event({"type": "error", "message": f"BacDive hatası ({org}): {e}"})
                continue

            if not hits:
                yield sse_event({"type": "error", "message": f"'{org}' için kayıt bulunamadı."})
                continue

            with_asm, no_asm = [], []
            for h in hits:
                acc = find_accession(h["raw"])
                if acc:
                    with_asm.append((h, acc))
                else:
                    no_asm.append(h)

            yield sse_event({
                "type": "organism_summary", "organism": org,
                "total_strains": len(hits), "with_assembly": len(with_asm), "no_assembly": len(no_asm),
            })

            # Assembly'si olmayanları direkt atla
            for h in no_asm:
                yield sse_event({"type": "skip", "organism": org,
                                 "strain_name": h["name"], "bacdive_id": h["id"],
                                 "reason": "Assembly yok"})

            all_pairs.extend([(h, acc, org) for h, acc in with_asm])

        total = len(all_pairs)
        yield sse_event({"type": "scan_start", "total": total,
                         "message": f"Toplam {total} strain sırayla taranıyor..."})

        if total == 0:
            yield sse_event({"type": "done", "total_scanned": 0, "found_count": 0,
                             "message": "Taranacak assembly bulunamadı."})
            return

        found_count = 0

        # Sırayla tara — her strain bittikten sonra hemen SSE'ye gönder
        for idx, (h, acc, org) in enumerate(all_pairs):
            # Taranıyor sinyali
            yield sse_event({
                "type":        "scanning",
                "strain_name": h["name"],
                "accession":   acc,
                "bacdive_id":  h["id"],
                "organism":    org,
                "progress":    idx + 1,
                "total":       total,
            })

            # Annotation indir ve tara
            result = _scan_single(h, acc, product_queries, org)
            result["progress"] = idx + 1
            result["total"]    = total
            result["type"]     = result["status"]  # frontend data.type bekliyor

            if result["status"] == "found":
                found_count += 1

            yield sse_event(result)

        yield sse_event({"type": "done", "total_scanned": total, "found_count": found_count,
                         "message": f"Tamamlandı: {total} strain, {found_count} pozitif."})

    return Response(stream_with_context(generate()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                             "Access-Control-Allow-Origin": "*"})


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    print(f"DeepDive backend http://localhost:{port} adresinde calisiyor...")
    app.run(host="0.0.0.0", port=port, debug=False)
