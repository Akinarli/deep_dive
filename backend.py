from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
import bacdive
import re
import json
import gzip
import requests
import urllib.parse
import asyncio
import aiohttp
import threading
import time

app = Flask(__name__)
CORS(app)

BACDIVE_WEB = "https://bacdive.dsmz.de/strain"
CDN_BASE    = "https://cdn.dsmz.de/genomes"
client      = bacdive.BacdiveClient()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":    "https://bacdive.dsmz.de/",
}

# Cache yok - 512MB limit için memory tasarrufu
def cache_get(key): return None
def cache_set(key, val): pass

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
        print(f"[WARN] NCBI taxonomy: {e}")
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

# ─── ASYNC ANNOTATION DOWNLOAD ───────────────────────────────────────────────

async def fetch_url_async(session, url, timeout=40):
    try:
        async with session.get(url, headers=HEADERS, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            if r.status == 200:
                raw = await r.read()
                if url.endswith(".gz"):
                    return gzip.decompress(raw).decode("utf-8", errors="replace")
                return raw.decode("utf-8", errors="replace")
    except Exception:
        pass
    return None

async def find_ncbi_gff_url_async(session, accession):
    acc_base = accession.split(".")[0]
    # NCBI eSearch
    try:
        async with session.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
            params={"db": "assembly", "term": acc_base, "retmode": "json"},
            timeout=aiohttp.ClientTimeout(total=15)
        ) as r:
            data = await r.json(content_type=None)
            ids = data.get("esearchresult", {}).get("idlist", [])
            if ids:
                async with session.get(
                    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
                    params={"db": "assembly", "id": ids[0], "retmode": "json"},
                    timeout=aiohttp.ClientTimeout(total=15)
                ) as r2:
                    data2 = await r2.json(content_type=None)
                    doc = data2.get("result", {}).get(ids[0], {})
                    ftp = doc.get("ftppath_refseq") or doc.get("ftppath_genbank")
                    if ftp:
                        ftp = ftp.replace("ftp://", "https://")
                        async with session.get(ftp + "/", timeout=aiohttp.ClientTimeout(total=15)) as r3:
                            text = await r3.text()
                            files = re.findall(r'href="([^"]+genomic\.gff\.gz)"', text)
                            if files:
                                fname = files[0]
                                return fname if fname.startswith("http") else ftp + "/" + fname
    except Exception:
        pass

    # FTP doğrudan dene
    digits = re.sub(r"\D", "", acc_base)
    if len(digits) >= 9:
        d1, d2, d3 = digits[:3], digits[3:6], digits[6:9]
        for prefix in ["GCF", "GCA"]:
            ftp_base = f"https://ftp.ncbi.nlm.nih.gov/genomes/all/{prefix}/{d1}/{d2}/{d3}/"
            try:
                async with session.get(ftp_base, timeout=aiohttp.ClientTimeout(total=15)) as r:
                    if r.status != 200:
                        continue
                    text = await r.text()
                    folders = re.findall(r'href="([^"\']+/)"', text)
                    for folder in folders:
                        folder = folder.strip("/")
                        if acc_base in folder:
                            folder_url = ftp_base + folder + "/"
                            async with session.get(folder_url, timeout=aiohttp.ClientTimeout(total=15)) as r2:
                                text2 = await r2.text()
                                files = re.findall(r'href="([^"\']+genomic\.gff\.gz)"', text2)
                                if files:
                                    fname = files[0]
                                    return fname if fname.startswith("http") else folder_url + fname
            except Exception:
                continue
    return None

async def download_annotation_async(session, accession):
    """Cache → DSMZ CDN GBFF → NCBI GFF (max 50MB, 30s) sırasıyla dene."""
    cached = cache_get(accession)
    if cached:
        print(f"[CACHE] {accession}")
        return cached[0], cached[1]

    acc_base = accession.split(".")[0]

    # 1. DSMZ CDN Bakta GBFF
    for url in [f"{CDN_BASE}/{acc_base}.gbff", f"{CDN_BASE}/{accession}.gbff",
                f"{CDN_BASE}/{acc_base}.gbff.gz", f"{CDN_BASE}/{accession}.gbff.gz"]:
        content = await fetch_url_async(session, url, timeout=40)
        if content:
            cache_set(accession, (content, "BacDive Bakta annotation"))
            print(f"[GBFF] {accession}")
            return content, "BacDive Bakta annotation"

    # 2. NCBI GFF — max 50MB, 30s hard timeout
    gff_url = await find_ncbi_gff_url_async(session, accession)
    if gff_url:
        try:
            async with session.get(
                gff_url, headers=HEADERS,
                timeout=aiohttp.ClientTimeout(total=30, connect=10)
            ) as r:
                if r.status == 200:
                    MAX_BYTES = 20 * 1024 * 1024  # 20MB limit
                    chunks = []
                    total_bytes = 0
                    async for chunk in r.content.iter_chunked(65536):
                        chunks.append(chunk)
                        total_bytes += len(chunk)
                        if total_bytes > MAX_BYTES:
                            print(f"[WARN] GFF too large ({total_bytes//1024}KB), truncating: {accession}")
                            break
                    raw = b"".join(chunks)
                    del chunks  # free memory immediately
                    text = gzip.decompress(raw).decode("utf-8", errors="replace") \
                           if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
                    del raw  # free memory immediately
                    print(f"[GFF] {accession} ({total_bytes//1024}KB)")
                    return text, "NCBI GFF annotation"
        except Exception as e:
            print(f"[WARN] GFF error {accession}: {e}")

    return None, None

# ─── SYNC WRAPPERS (Mod 1) ───────────────────────────────────────────────────

def fetch_gbff_features(accession, product_query):
    acc_base = accession.split(".")[0]
    for url in [f"{CDN_BASE}/{acc_base}.gbff", f"{CDN_BASE}/{accession}.gbff",
                f"{CDN_BASE}/{acc_base}.gbff.gz", f"{CDN_BASE}/{accession}.gbff.gz"]:
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.ok:
                raw = r.content
                content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                          if url.endswith(".gz") else raw.decode("utf-8", errors="replace")
                return parse_gbff(content, [product_query]), None
        except Exception:
            continue
    return None, "GBFF indirilemedi"

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

def search_ncbi_gff(gff_url, product_query):
    r = requests.get(gff_url, headers=HEADERS, timeout=60)
    raw = r.content
    content = gzip.decompress(raw).decode("utf-8", errors="replace") \
              if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
    return parse_gff(content, [product_query])

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
                        "message": "Genome assembly bulunamadi."})

    product_queries = [p.strip() for p in product_q.split(",") if p.strip()]

    # Annotation'ı indir (cache'den veya CDN/NCBI'dan)
    content = None
    source  = None

    acc_base = accession.split(".")[0]
    for url in [f"{CDN_BASE}/{acc_base}.gbff", f"{CDN_BASE}/{accession}.gbff",
                f"{CDN_BASE}/{acc_base}.gbff.gz", f"{CDN_BASE}/{accession}.gbff.gz"]:
        try:
            r = requests.get(url, headers=HEADERS, timeout=40)
            if r.ok:
                raw = r.content
                content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                          if url.endswith(".gz") else raw.decode("utf-8", errors="replace")
                source = "BacDive Bakta annotation"
                break
        except Exception:
            continue

    if content is None:
        gff_url = find_ncbi_gff(accession)
        if not gff_url:
            return jsonify({"found": False, "error_code": "NO_GFF_URL",
                            "message": f"Annotation indirilemedi. Accession: {accession}",
                            "accession": accession})
        try:
            r = requests.get(gff_url, headers=HEADERS, timeout=60)
            raw = r.content
            content = gzip.decompress(raw).decode("utf-8", errors="replace") \
                      if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
            source = "NCBI GFF annotation"
        except Exception as e:
            return jsonify({"found": False, "error_code": "DOWNLOAD_ERROR",
                            "message": str(e), "accession": accession})

    # Multi-keyword parse
    matches = parse_content(content, product_queries)

    if not matches:
        return jsonify({"found": False, "error_code": "NO_PRODUCT",
                        "message": f"'{product_q}' bulunamadi.", "accession": accession})
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


# ─── MOD 2: Paralel async tarama (SSE) ───────────────────────────────────────

def sse_event(data):
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def scan_all_async(organisms, product_queries, queue):
    """
    Tüm strainleri async olarak tara.
    Sonuçları queue'ya koy — Flask SSE generator oradan okur.
    """
    connector = aiohttp.TCPConnector(limit=10)
    async with aiohttp.ClientSession(connector=connector) as session:

        for org in organisms:
            await queue.put(sse_event({"type": "status",
                                       "message": f"'{org}' BacDive'da aranıyor..."}))
            try:
                hits = search_organism(org)  # sync, BacDive client thread-safe değil
            except Exception as e:
                await queue.put(sse_event({"type": "error",
                                           "message": f"BacDive hatası ({org}): {e}"}))
                continue

            if not hits:
                await queue.put(sse_event({"type": "error",
                                           "message": f"'{org}' için kayıt bulunamadı."}))
                continue

            with_asm, no_asm = [], []
            for h in hits:
                acc = find_accession(h["raw"])
                if acc:
                    with_asm.append((h, acc))
                else:
                    no_asm.append(h)

            await queue.put(sse_event({
                "type": "summary", "organism": org,
                "total_strains": len(hits),
                "with_assembly": len(with_asm),
                "no_assembly":   len(no_asm),
            }))

            for h in no_asm:
                await queue.put(sse_event({
                    "type": "skip", "organism": org,
                    "strain_name": h["name"], "bacdive_id": h["id"],
                    "reason": "Assembly yok",
                }))

            total = len(with_asm)
            found_count = 0

            # Tüm strainleri aynı anda async indir, sonuç geldikçe SSE'ye yaz
            async def scan_one(h, accession, idx):
                nonlocal found_count
                strain_name = h["name"]
                bid         = h["id"]

                await queue.put(sse_event({
                    "type":        "scanning",
                    "organism":    org,
                    "strain_name": strain_name,
                    "accession":   accession,
                    "bacdive_id":  bid,
                    "progress":    idx + 1,
                    "total":       total,
                }))
                try:
                    content, source = await asyncio.wait_for(
                        download_annotation_async(session, accession), timeout=60
                    )
                except asyncio.TimeoutError:
                    content, source = None, None

                if content is None:
                    await queue.put(sse_event({
                        "type": "not_found", "organism": org,
                        "strain_name": strain_name, "accession": accession,
                        "bacdive_id": bid,
                    }))
                    return
                    return

                matches = parse_content(content, product_queries)

                if not matches:
                    await queue.put(sse_event({
                        "type": "not_found", "organism": org,
                        "strain_name": strain_name, "accession": accession,
                        "bacdive_id": bid,
                    }))
                    return

                found_count += 1
                await queue.put(sse_event({
                    "type":        "found",
                    "organism":    org,
                    "strain_name": strain_name,
                    "accession":   accession,
                    "bacdive_id":  bid,
                    "bacdive_url": f"{BACDIVE_WEB}/{bid}",
                    "source":      source,
                    "match_count": len(matches),
                    "results":     matches,
                }))

            # Paralel tara — hepsi aynı anda, 60s timeout ile
            async def scan_one_safe(h, acc, idx):
                try:
                    await asyncio.wait_for(scan_one(h, acc, idx), timeout=60)
                except asyncio.TimeoutError:
                    await queue.put(sse_event({
                        "type": "not_found", "organism": org,
                        "strain_name": h["name"], "accession": acc,
                        "bacdive_id": h["id"],
                    }))

            # Sırayla tara — her strain biter bitmez (veya 60s timeout) sonrakine geç
            for idx, (h, acc) in enumerate(with_asm):
                await scan_one_safe(h, acc, idx)

            await queue.put(sse_event({
                "type":          "done",
                "organism":      org,
                "total_scanned": total,
                "found_count":   found_count,
                "message":       f"'{org}' tamamlandı: {total} strain, {found_count} pozitif.",
            }))

    await queue.put(None)  # sentinel — bitti


@app.route("/scan-organism", methods=["GET"])
def scan_organism():
    organism_raw = request.args.get("organism", "").strip()
    product_raw  = request.args.get("product", "").strip()
    if not organism_raw or not product_raw:
        return jsonify({"error": "organism ve product gerekli"}), 400

    organisms       = [o.strip() for o in organism_raw.split(",") if o.strip()]
    product_queries = [p.strip() for p in product_raw.split(",") if p.strip()]

    def generate():
        # asyncio event loop'u ayrı thread'de çalıştır
        q = None
        loop = asyncio.new_event_loop()

        import queue as stdlib_queue
        q = stdlib_queue.Queue()

        async def run():
            aqueue = asyncio.Queue()
            # async queue → sync queue köprüsü
            async def bridge():
                while True:
                    item = await aqueue.get()
                    q.put(item)
                    if item is None:
                        break
            await asyncio.gather(
                scan_all_async(organisms, product_queries, aqueue),
                bridge()
            )

        def run_loop():
            loop.run_until_complete(run())

        t = threading.Thread(target=run_loop, daemon=True)
        t.start()

        while True:
            item = q.get()
            if item is None:
                break
            yield item

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":             "no-cache",
            "X-Accel-Buffering":         "no",
            "Access-Control-Allow-Origin":"*",
        }
    )


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    print(f"DeepDive async backend http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
