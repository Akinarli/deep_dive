from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import bacdive
import re
import json
import gzip
import requests
import urllib.parse
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
CORS(app)

BACDIVE_WEB = "https://bacdive.dsmz.de/strain"
CDN_BASE    = "https://cdn.dsmz.de/genomes"
client      = bacdive.BacdiveClient()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://bacdive.dsmz.de/",
}

# ─── CACHE ───────────────────────────────────────────────────────────────────
_cache = {}
_cache_lock = threading.Lock()
CACHE_TTL = 6 * 3600

def cache_get(key):
    with _cache_lock:
        e = _cache.get(key)
        if e and time.time() - e["ts"] < CACHE_TTL:
            return e["val"]
    return None

def cache_set(key, val):
    with _cache_lock:
        _cache[key] = {"val": val, "ts": time.time()}

# ─── BacDive ─────────────────────────────────────────────────────────────────

def search_organism(name):
    count = client.search(taxonomy=name)
    if count == 0:
        parts = name.strip().split()
        if len(parts) >= 2:
            count = client.search(taxonomy=" ".join(parts[:2]))
    if count == 0:
        return []
    hits = []
    for strain in client.retrieve():
        bid = strain.get("General", {}).get("BacDive-ID")
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

def find_accession(strain_raw):
    text = json.dumps(strain_raw)
    m = re.search(r"GC[AF]_\d{9,}(?:\.\d+)?", text)
    return m.group(0) if m else None

def find_accession_via_ncbi(organism_name):
    try:
        es = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "assembly", "term": f"{organism_name}[Organism]",
                    "retmode": "json", "retmax": 5, "sort": "submissiondate desc"},
            timeout=15)
        if not es.ok:
            return None
        ids = es.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return None
        esummary = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
            params={"db": "assembly", "id": ids[0], "retmode": "json"}, timeout=15)
        if not esummary.ok:
            return None
        doc = esummary.json().get("result", {}).get(ids[0], {})
        return doc.get("assemblyaccession") or doc.get("synonym", {}).get("genbank")
    except Exception as e:
        print(f"[WARN] NCBI: {e}")
        return None

# ─── PARSERS ─────────────────────────────────────────────────────────────────

def parse_gbff(content, product_queries):
    queries_lc = [q.lower().strip() for q in product_queries]
    matches = []
    current_feature = None
    current_attrs = {}
    current_location = ""
    current_contig = ""
    lines = content.splitlines()
    i = 0

    def save():
        if current_feature and current_attrs.get("product"):
            product = current_attrs["product"]
            mq = [q for q in queries_lc if q in product.lower()]
            if mq:
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
                    "matched_query": mq[0],
                })

    while i < len(lines):
        line = lines[i]
        if line.startswith("LOCUS"):
            parts = line.split()
            if len(parts) > 1:
                current_contig = parts[1]
        feat_match = re.match(r'^     (\w+)\s+(.+)$', line)
        if feat_match:
            save()
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
    save()
    return matches

def parse_gff(content, product_queries):
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
        mq = [q for q in queries_lc if q in product.lower()]
        if not mq:
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
            "matched_query": mq[0],
        })
    return matches

def parse_content(content, product_queries):
    if "LOCUS" in content[:500] and "FEATURES" in content:
        return parse_gbff(content, product_queries)
    return parse_gff(content, product_queries)

# ─── ANNOTATION DOWNLOAD ─────────────────────────────────────────────────────

def find_ncbi_gff(accession):
    acc_base = accession.split(".")[0]
    try:
        es = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "assembly", "term": acc_base, "retmode": "json"}, timeout=15)
        ids = es.json().get("esearchresult", {}).get("idlist", [])
        if ids:
            esummary = requests.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                params={"db": "assembly", "id": ids[0], "retmode": "json"}, timeout=15)
            doc = esummary.json().get("result", {}).get(ids[0], {})
            ftp = doc.get("ftppath_refseq") or doc.get("ftppath_genbank")
            if ftp:
                ftp = ftp.replace("ftp://", "https://")
                r = requests.get(ftp + "/", timeout=15)
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
                r = requests.get(ftp_base, timeout=15)
                if not r.ok:
                    continue
                folders = re.findall(r'href="([^"\']+/)"', r.text)
                for folder in folders:
                    folder = folder.strip("/")
                    if acc_base in folder:
                        folder_url = ftp_base + folder + "/"
                        r2 = requests.get(folder_url, timeout=15)
                        files = re.findall(r'href="([^"\']+genomic\.gff\.gz)"', r2.text)
                        if files:
                            fname = files[0]
                            return fname if fname.startswith("http") else folder_url + fname
            except Exception:
                continue
    return None

def download_annotation(accession):
    """Cache → DSMZ CDN GBFF → NCBI GFF"""
    cached = cache_get(accession)
    if cached:
        return cached[0], cached[1]

    acc_base = accession.split(".")[0]

    # 1. DSMZ CDN Bakta GBFF
    for url in [f"{CDN_BASE}/{acc_base}.gbff", f"{CDN_BASE}/{accession}.gbff",
                f"{CDN_BASE}/{acc_base}.gbff.gz", f"{CDN_BASE}/{accession}.gbff.gz"]:
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.ok:
                raw = r.content
                content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                          if url.endswith(".gz") else raw.decode("utf-8", errors="replace")
                cache_set(accession, (content, "BacDive Bakta annotation"))
                return content, "BacDive Bakta annotation"
        except Exception:
            continue

    # 2. NCBI GFF
    gff_url = find_ncbi_gff(accession)
    if gff_url:
        try:
            r = requests.get(gff_url, headers=HEADERS, timeout=60)
            raw = r.content
            content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                      if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
            cache_set(accession, (content, "NCBI GFF annotation"))
            return content, "NCBI GFF annotation"
        except Exception as e:
            print(f"[WARN] GFF indirme: {e}")

    return None, None

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
        "found": True, "total_hits": len(strains), "strains": strains,
        "bacdive_id": strains[0]["bacdive_id"], "bacdive_url": strains[0]["bacdive_url"],
        "strain_name": strains[0]["strain_name"], "_strain": strains[0]["_strain"],
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
                             headers={"Accept": "application/json"}, timeout=15)
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
        return jsonify({"found": False, "error_code": "NO_ASSEMBLY",
                        "message": "Bu BacDive kaydinda genome assembly accession bulunamadi ve NCBI'da da bulunamadi."})

    product_queries = [p.strip() for p in product_q.split(",") if p.strip()]
    content, source = download_annotation(accession)

    if content is None:
        return jsonify({"found": False, "error_code": "NO_GFF_URL",
                        "message": f"Annotation indirilemedi. Accession: {accession}",
                        "accession": accession})

    matches = parse_content(content, product_queries)

    if not matches:
        return jsonify({"found": False, "error_code": "NO_PRODUCT",
                        "message": f"'{product_q}' bulunamadi.",
                        "accession": accession, "source": source})
    return jsonify({"found": True, "accession": accession, "bacdive_id": bid,
                    "product_query": product_q, "total": len(matches),
                    "source": source, "results": matches})


@app.route("/protein-sequence", methods=["POST"])
def protein_sequence():
    data       = request.get_json()
    protein_id = (data or {}).get("protein_id", "").strip()
    if not protein_id:
        return jsonify({"error": "protein_id gerekli"}), 400
    try:
        r = requests.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params={"db": "protein", "id": protein_id, "rettype": "fasta", "retmode": "text"},
            timeout=15)
        if r.ok and r.text.startswith(">"):
            return jsonify({"found": True, "protein_id": protein_id, "sequence": r.text.strip()})
    except Exception as e:
        return jsonify({"found": False, "message": str(e)})
    return jsonify({"found": False, "message": "Sekans bulunamadi."})


# ─── MOD 2: SSE stream + ThreadPoolExecutor ───────────────────────────────────

def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"

def scan_one_strain(h, accession, product_queries, org):
    """Tek strain tara — thread içinde çağrılır."""
    content, source = download_annotation(accession)
    if content is None:
        return {"status": "skip", "strain_name": h["name"], "accession": accession,
                "bacdive_id": h["id"], "organism": org, "reason": "Annotation indirilemedi"}
    matches = parse_content(content, product_queries)
    if not matches:
        return {"status": "not_found", "strain_name": h["name"], "accession": accession,
                "bacdive_id": h["id"], "organism": org}
    return {"status": "found", "strain_name": h["name"], "accession": accession,
            "bacdive_id": h["id"], "organism": org,
            "bacdive_url": f"{BACDIVE_WEB}/{h['id']}",
            "source": source, "match_count": len(matches), "results": matches}


@app.route("/scan-organism", methods=["GET"])
def scan_organism():
    organism_raw = request.args.get("organism", "").strip()
    product_raw  = request.args.get("product", "").strip()
    if not organism_raw or not product_raw:
        return jsonify({"error": "organism ve product gerekli"}), 400

    organisms       = [o.strip() for o in organism_raw.split(",") if o.strip()]
    product_queries = [p.strip() for p in product_raw.split(",") if p.strip()]

    def generate():
        for org in organisms:
            yield sse_event({"type": "status", "message": f"'{org}' BacDive'da aranıyor..."})

            try:
                hits = search_organism(org)
            except Exception as e:
                yield sse_event({"type": "error", "message": f"BacDive hatası: {e}"})
                continue

            if not hits:
                yield sse_event({"type": "error", "message": f"'{org}' bulunamadı."})
                continue

            with_asm, no_asm = [], []
            for h in hits:
                acc = find_accession(h["raw"])
                if acc:
                    with_asm.append((h, acc))
                else:
                    no_asm.append(h)

            yield sse_event({
                "type": "summary", "organism": org,
                "total_strains": len(hits),
                "with_assembly": len(with_asm),
                "no_assembly":   len(no_asm),
            })

            for h in no_asm:
                yield sse_event({"type": "skip", "organism": org,
                                 "strain_name": h["name"], "bacdive_id": h["id"],
                                 "reason": "Assembly yok"})

            total       = len(with_asm)
            found_count = 0
            done_count  = 0

            # Paralel indir, sonuç geldikçe SSE'ye yaz
            with ThreadPoolExecutor(max_workers=5) as executor:
                future_to_strain = {
                    executor.submit(scan_one_strain, h, acc, product_queries, org): (h, acc)
                    for h, acc in with_asm
                }

                # Önce hepsini "scanning" olarak bildir
                for h, acc in with_asm:
                    yield sse_event({
                        "type": "scanning", "organism": org,
                        "strain_name": h["name"], "accession": acc,
                        "bacdive_id": h["id"], "progress": 0, "total": total,
                    })

                # Sonuçlar geldikçe yaz
                for future in as_completed(future_to_strain):
                    done_count += 1
                    try:
                        result = future.result()
                    except Exception as e:
                        h, acc = future_to_strain[future]
                        result = {"status": "skip", "strain_name": h["name"],
                                  "accession": acc, "bacdive_id": h["id"],
                                  "organism": org, "reason": str(e)}

                    result["progress"] = done_count
                    result["total"]    = total
                    if result["status"] == "found":
                        found_count += 1
                    yield sse_event(result)

            yield sse_event({
                "type": "done", "organism": org,
                "total_scanned": total, "found_count": found_count,
                "message": f"'{org}' tamamlandı: {total} strain, {found_count} pozitif.",
            })

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "Access-Control-Allow-Origin": "*"}
    )


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    print(f"DeepDive backend http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
