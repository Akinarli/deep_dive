from flask import Flask, request, jsonify
from flask_cors import CORS
import bacdive
import re
import json
import gzip
import requests
import urllib.parse

app = Flask(__name__)
CORS(app)

BACDIVE_WEB = "https://bacdive.dsmz.de/strain"
CDN_BASE = "https://cdn.dsmz.de/genomes"
client = bacdive.BacdiveClient()

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://bacdive.dsmz.de/",
}

# ─── BacDive organizma arama ─────────────────────────────────────────────────

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
        hits.append({"id": bid, "name": species or name, "raw": strain})
    return hits

def find_accession(strain_raw):
    text = json.dumps(strain_raw)
    m = re.search(r"GC[AF]_\d{9,}(?:\.\d+)?", text)
    return m.group(0) if m else None

# ─── DSMZ CDN'den GBFF indir ve parse et ─────────────────────────────────────

def fetch_gbff_features(accession, product_query):
    """
    BacDive'ın CDN'inden GBFF dosyasını indir ve product alanında ara.
    URL formatı: https://cdn.dsmz.de/genomes/GCA_XXXXXXXXX.gbff
    """
    acc_base = accession.split(".")[0]
    
    # Farklı formatları dene
    urls_to_try = [
        f"{CDN_BASE}/{acc_base}.gbff",
        f"{CDN_BASE}/{accession}.gbff",
        f"{CDN_BASE}/{acc_base}.gbff.gz",
        f"{CDN_BASE}/{accession}.gbff.gz",
    ]
    
    content = None
    used_url = None
    
    for url in urls_to_try:
        try:
            r = requests.get(url, headers=HEADERS, timeout=60)
            if r.ok:
                raw = r.content
                if url.endswith(".gz"):
                    content = gzip.decompress(raw).decode("utf-8", errors="replace")
                else:
                    content = raw.decode("utf-8", errors="replace")
                used_url = url
                print(f"[INFO] GBFF indirildi: {url} ({len(content)} chars)")
                break
        except Exception as e:
            print(f"[WARN] {url} basarisiz: {e}")
            continue
    
    if not content:
        return None, "DSMZ CDN'den GBFF indirilemedi"
    
    # GBFF parse et
    matches = parse_gbff(content, product_query)
    return matches, None

def parse_gbff(content, product_query):
    """
    GenBank flat file (GBFF) formatını parse et.
    Her CDS/rRNA/tRNA feature'ı için product alanını kontrol et.
    """
    query_lc = product_query.lower()
    matches = []
    
    # GBFF'de her feature bloğunu işle
    # Format:
    # FEATURES             Location/Qualifiers
    #      CDS             complement(214100..217600)
    #                      /locus_tag="Loc_01909"
    #                      /gene="bcsC"
    #                      /product="cellulose synthase complex outer membrane..."
    
    current_feature = None
    current_attrs = {}
    current_location = ""
    current_contig = ""
    
    lines = content.splitlines()
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Contig/locus satırı
        if line.startswith("LOCUS"):
            parts = line.split()
            if len(parts) > 1:
                current_contig = parts[1]
        
        # Feature satırı (5 boşlukla başlar, sonra feature tipi)
        feat_match = re.match(r'^     (\w+)\s+(.+)$', line)
        if feat_match:
            # Önceki feature'ı kaydet
            if current_feature and current_attrs.get("product"):
                product = current_attrs.get("product", "")
                if query_lc in product.lower():
                    loc = current_location
                    strand = "-" if "complement" in loc else "+"
                    coords = re.findall(r'\d+', loc)
                    start = coords[0] if coords else ""
                    stop = coords[-1] if len(coords) > 1 else ""
                    matches.append({
                        "locus_tag": current_attrs.get("locus_tag", ""),
                        "contig": current_contig,
                        "start": start,
                        "stop": stop,
                        "strand": strand,
                        "type": current_feature,
                        "gene": current_attrs.get("gene", ""),
                        "product": product,
                    })
            
            current_feature = feat_match.group(1)
            current_location = feat_match.group(2).strip()
            current_attrs = {}
        
        # Attribute satırı (/key="value")
        elif line.startswith('                     /'):
            attr_line = line.strip().lstrip('/')
            if '="' in attr_line:
                key, val = attr_line.split('="', 1)
                val = val.rstrip('"')
                # Çok satırlı değerleri birleştir
                while i + 1 < len(lines) and not lines[i+1].strip().startswith('/') and not lines[i+1].strip().startswith('CDS') and lines[i+1].startswith('                     ') and not re.match(r'^     \w+\s+', lines[i+1]):
                    i += 1
                    val = val + " " + lines[i].strip().rstrip('"')
                current_attrs[key.strip()] = val.strip()
        
        i += 1
    
    # Son feature'ı da kaydet
    if current_feature and current_attrs.get("product"):
        product = current_attrs.get("product", "")
        if query_lc in product.lower():
            loc = current_location
            strand = "-" if "complement" in loc else "+"
            coords = re.findall(r'\d+', loc)
            start = coords[0] if coords else ""
            stop = coords[-1] if len(coords) > 1 else ""
            matches.append({
                "locus_tag": current_attrs.get("locus_tag", ""),
                "contig": current_contig,
                "start": start,
                "stop": stop,
                "strand": strand,
                "type": current_feature,
                "gene": current_attrs.get("gene", ""),
                "product": product,
            })
    
    return matches

# ─── NCBI GFF fallback ────────────────────────────────────────────────────────

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
    r = requests.get(gff_url, headers=HEADERS, timeout=180)
    raw = r.content
    content = gzip.decompress(raw).decode("utf-8", errors="replace") \
        if gff_url.endswith(".gz") else raw.decode("utf-8", errors="replace")
    query_lc = product_query.lower()
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
        if query_lc not in product.lower():
            continue
        matches.append({
            "locus_tag": attr_dict.get("locus_tag", ""),
            "contig": contig, "start": start, "stop": stop,
            "strand": strand, "type": feat_type,
            "gene": attr_dict.get("gene", ""), "product": product,
        })
    return matches

# ─── Endpoints ────────────────────────────────────────────────────────────────

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
    best = hits[0]
    bid = best["id"]
    return jsonify({
        "found": True,
        "bacdive_id": bid,
        "bacdive_url": f"{BACDIVE_WEB}/{bid}",
        "strain_name": best["name"],
        "total_hits": len(hits),
        "_strain": best["raw"],
    })


@app.route("/search-product", methods=["POST"])
def search_product():
    data = request.get_json()
    bid = (data or {}).get("bacdive_id")
    product_q = (data or {}).get("product", "").strip()
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
        return jsonify({
            "found": False, "error_code": "NO_ASSEMBLY",
            "message": "Bu BacDive kaydinda genome assembly accession bulunamadi.",
        })

    # 1. DSMZ CDN'den GBFF indir (BacDive'ın kendi Bakta annotation'ı)
    print(f"[INFO] DSMZ CDN GBFF deneniyor: {accession}, product: {product_q}")
    matches, err = fetch_gbff_features(accession, product_q)

    if matches is not None:
        if not matches:
            return jsonify({
                "found": False, "error_code": "NO_PRODUCT",
                "message": f"'{product_q}' BacDive Bakta feature table'da bulunamadi.",
                "accession": accession, "source": "BacDive Bakta (DSMZ CDN)"
            })
        return jsonify({
            "found": True, "accession": accession, "bacdive_id": bid,
            "product_query": product_q, "total": len(matches),
            "source": "BacDive Bakta annotation",
            "results": matches,
        })

    # 2. NCBI GFF fallback
    print(f"[INFO] GBFF basarisiz ({err}), NCBI GFF deneniyor...")
    gff_url = find_ncbi_gff(accession)
    if not gff_url:
        return jsonify({
            "found": False, "error_code": "NO_GFF_URL",
            "message": f"Ne DSMZ CDN ne de NCBI GFF erisilebilir. Accession: {accession}",
            "accession": accession,
            "bacdive_url": f"{BACDIVE_WEB}/{bid}",
        })

    try:
        matches = search_ncbi_gff(gff_url, product_q)
    except Exception as e:
        return jsonify({
            "found": False, "error_code": "DOWNLOAD_ERROR",
            "message": f"Annotation indirilemedi: {str(e)}",
            "accession": accession,
        })

    if not matches:
        return jsonify({
            "found": False, "error_code": "NO_PRODUCT",
            "message": f"'{product_q}' NCBI feature table'da bulunamadi.",
            "accession": accession,
        })

    return jsonify({
        "found": True, "accession": accession, "bacdive_id": bid,
        "product_query": product_q, "total": len(matches),
        "source": "NCBI GFF annotation",
        "results": matches,
    })


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5050))
    print(f"BacDive backend http://localhost:{port} adresinde calisiyor...")
    app.run(host="0.0.0.0", port=port, debug=False)
