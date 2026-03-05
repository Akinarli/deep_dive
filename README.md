# deep_dive
# 🧬 DeepDive — Bacterial Genomic Feature Search Tool

> Search any bacterial organism's genomic feature table by product name — powered by BacDive API, DSMZ Bakta annotation, and NCBI databases.

**Live Demo:** [deep-dive-five.vercel.app](https://deep-dive-five.vercel.app)

---

## What is DeepDive?

DeepDive is a web-based genomic search tool designed for researchers working with bacterial genomes. It bridges the gap between **strain-level metadata** (BacDive) and **genomic feature annotation** (DSMZ/NCBI), enabling fast, targeted queries on bacterial genome feature tables without requiring any bioinformatics software or command-line expertise.

Simply type an organism name and a product keyword — DeepDive finds the relevant genes across the entire genome annotation and returns a structured feature table with direct links to NCBI Nucleotide.

---

## Key Features

### 🔍 Multi-Strain Organism Search
- Queries the **BacDive API v2** (DSMZ) to retrieve all registered strains for a given organism
- Displays all strains with clear classification:
  - ✅ **Genome Assembly Available** — strains with a linked GCA/GCF accession number
  - ⚠️ **No Genome Assembly** — strains registered in BacDive without a sequenced genome
- Users can freely select any strain to query, regardless of assembly availability

### 🧫 Bakta Annotation Priority
- For strains with genome data in the DSMZ CDN, DeepDive fetches the **Bakta-annotated GBFF file** directly from `cdn.dsmz.de`
- Bakta is a modern bacterial genome annotation tool (2021+) that outperforms NCBI PGAP for:
  - Small open reading frames (sORFs)
  - Non-coding RNAs (ncRNAs)
  - Functional product descriptions
  - Poorly characterized or understudied species
- In practice, DeepDive returns **more complete results than BacDive's own feature table viewer** — for example, retrieving genes that BacDive's interface omits due to display filtering

### 🔄 Intelligent NCBI Fallback
When DSMZ Bakta annotation is unavailable, DeepDive automatically falls back through a cascade of NCBI sources:
1. **NCBI eSearch + eSummary** — searches the NCBI Assembly database by accession to find the FTP path
2. **NCBI Datasets API v2** — retrieves assembly links programmatically
3. **NCBI FTP directory traversal** — scans the GenBank/RefSeq FTP for the genomic GFF file
4. **NCBI Taxonomy Search** — if BacDive has no accession for a strain, searches NCBI Assembly by organism name to find a genome

This means DeepDive can retrieve genomic feature data even for organisms that **have no genome assembly listed in BacDive** — as long as a genome exists in NCBI.

### 🔗 Clickable Locus Tags → NCBI Nucleotide
Every locus tag in the result table is a direct link to **NCBI Nucleotide**, opening the exact genomic coordinates of that feature on the contig. This provides immediate visual and sequence-level context for every search result.

### 📊 Structured Feature Table Output
Results are displayed in a clean, sortable table with:
- Locus Tag (clickable → NCBI)
- Contig
- Start / Stop coordinates
- Strand orientation (+ / −)
- Feature type (CDS, rRNA, tRNA, etc.)
- Gene name
- Product description

---

## How It Works

```
User Input
    │
    ▼
[1] BacDive API v2
    └─ Search organism by taxonomy name
    └─ Retrieve all registered strains
    └─ Sort: strains with genome assembly first
    │
    ▼
[2] User selects a strain
    │
    ▼
[3] Annotation retrieval (cascading fallback)
    ├─ Try: DSMZ CDN Bakta GBFF
    │       cdn.dsmz.de/genomes/{accession}.gbff
    ├─ Try: NCBI eSearch → FTP path → genomic.gff.gz
    ├─ Try: NCBI Datasets API v2
    ├─ Try: NCBI FTP directory traversal
    └─ Try: NCBI Taxonomy search (if no accession in BacDive)
    │
    ▼
[4] Parse annotation file
    └─ GBFF: parse FEATURES block, extract /product, /locus_tag, /gene
    └─ GFF3: parse tab-delimited format, extract attributes column
    │
    ▼
[5] Filter by product keyword (case-insensitive substring match)
    │
    ▼
[6] Return structured feature table to frontend
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Create React App) |
| Backend | Python 3, Flask, Flask-CORS |
| Organism Search | BacDive Python API client v2 |
| Annotation Sources | DSMZ CDN (Bakta GBFF), NCBI FTP (GFF3) |
| Deployment (Frontend) | Vercel |
| Deployment (Backend) | Render |
| Version Control | GitHub |

---

## Why DeepDive is Better Than BacDive's Built-in Feature Table

| Feature | BacDive Web Interface | DeepDive |
|---------|----------------------|----------|
| Annotation source | Bakta (when available) | Bakta (primary) + NCBI (fallback) |
| Organisms without BacDive feature table | ❌ Not searchable | ✅ Falls back to NCBI |
| Multi-strain selection | ❌ One strain at a time | ✅ All strains listed, user selects |
| Assembly status visibility | ❌ Not shown | ✅ Clearly labeled |
| NCBI direct link | ❌ No | ✅ Every locus tag links to NCBI Nucleotide |
| Completeness | Sometimes filters results | Returns all matching features |

**Real-world example:** For *Halomonas borealis* ATF 5.2, BacDive's feature table shows 6 cellulose-related features. DeepDive returns 7 — including `bcsB` (cellulose biosynthesis cyclic di-GMP-binding regulatory protein), which BacDive omits.

---

## Installation & Local Development

### Prerequisites
- Python 3.8+
- Node.js 16+
- BacDive API credentials ([register here](https://api.bacdive.dsmz.de/login))

### Backend

```bash
# Clone the repository
git clone https://github.com/Akinarli/deep_dive.git
cd deep_dive

# Install dependencies
pip install flask flask-cors bacdive requests

# Run backend
python backend.py
# → Running on http://localhost:5050
```

### Frontend

```bash
# Install dependencies
npm install

# Set API URL in src/App.js
const API_BASE = "http://localhost:5050";
const DEMO_MODE = false;

# Start development server
npm start
# → Running on http://localhost:3000
```

---

## API Endpoints

### `POST /check-organism`
Search BacDive for an organism and return all registered strains.

**Request:**
```json
{ "name": "Halomonas smyrnensis" }
```

**Response:**
```json
{
  "found": true,
  "total_hits": 5,
  "strains": [
    {
      "bacdive_id": 23064,
      "strain_name": "Halomonas smyrnensis",
      "accession": "GCA_000265245",
      "has_assembly": true,
      "bacdive_url": "https://bacdive.dsmz.de/strain/23064"
    }
  ]
}
```

### `POST /search-product`
Search the genomic feature table of a strain for a product keyword.

**Request:**
```json
{
  "bacdive_id": 23064,
  "product": "levansucrase",
  "_strain": { ... }
}
```

**Response:**
```json
{
  "found": true,
  "accession": "GCA_000265245",
  "source": "NCBI GFF annotation",
  "total": 1,
  "results": [
    {
      "locus_tag": "GCA000265245_02754",
      "contig": "AJKS02000002.1",
      "start": "272822",
      "stop": "274072",
      "strand": "-",
      "type": "CDS",
      "gene": "",
      "product": "levansucrase"
    }
  ]
}
```

---

## Use Cases

- **Genomic analysis of bacterial species** — rapidly find all genes encoding a specific protein function
- **Comparative genomics** — search the same product across multiple strains of the same species
- **Literature research support** — verify gene presence/absence in sequenced strains
- **Teaching and education** — accessible interface for students learning bacterial genomics

---

## Roadmap

- [ ] Mobile application (React Native / Expo)
- [ ] Multi-organism batch search
- [ ] CSV/Excel export of feature table results
- [ ] Protein sequence retrieval for matched features
- [ ] Custom domain deployment

---

## Data Sources

- **BacDive** — Leibniz Institute DSMZ. The Bacterial Diversity Metadatabase. [bacdive.dsmz.de](https://bacdive.dsmz.de)
- **Bakta** — Schwengers et al. (2021). Bakta: rapid and standardized annotation of bacterial genomes via a comprehensive database. *Microbial Genomics*. DOI: 10.1099/mgen.0.000685
- **NCBI** — National Center for Biotechnology Information. [ncbi.nlm.nih.gov](https://www.ncbi.nlm.nih.gov)

---

## License

All rights reserved. © 2026 Akinarli. This software may not be copied, modified, distributed, or used without explicit written permission from the author.

---

## Author

**Akinarli**  
GitHub: [@Akinarli](https://github.com/Akinarli)
