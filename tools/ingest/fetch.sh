#!/usr/bin/env bash
# Download the source databases the ingest pipeline reads. Both are CC-BY.
# The raw tables are ~60MB and are NOT committed — they are reproducible inputs,
# not project data. What IS committed is everything derived from them: the
# pathway modules, their layouts, and data/ingest/sheets.json.
set -euo pipefail
cd "$(dirname "$0")/../../data/ingest"

echo "Rhea: curated, mass- and charge-balanced reactions with ChEBI participants"
curl -sS --fail --max-time 600 -o rhea.tsv \
  "https://www.rhea-db.org/rhea?query=*&columns=rhea-id,equation,chebi-id,ec&format=tsv&limit=100000"

echo "ChEBI: names, formulae, charges, and the microspecies relations"
for f in compounds chemical_data relation; do
  curl -sS --fail --max-time 600 -o "$f.tsv.gz" \
    "https://ftp.ebi.ac.uk/pub/databases/chebi/flat_files/$f.tsv.gz"
  gunzip -f "$f.tsv.gz"
done

echo "ExPASy ENZYME: accepted enzyme names per EC number"
curl -sS --fail --max-time 600 -o enzyme.dat "https://ftp.expasy.org/databases/enzyme/enzyme.dat"

echo "Done. Now: node tools/ingest/build-modules.mjs"
