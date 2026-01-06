#!/bin/bash
# Script to generate remaining collection JSON files

# This script creates placeholder collections - to be populated with actual book IDs

collections=(
  "adam-smith-foundations"
  "classical-political-economy"
  "american-system-economics"
  "austrian-school"
  "arabic-alchemy-magic"
  "paracelsian-medicine"
  "rosicrucian-circle"
  "alchemical-emblems"
  "ficino-neoplatonic-sources"
  "pico-della-mirandola"
  "florentine-humanists"
  "cappadocian-fathers"
  "byzantine-mystical-theology"
  "desert-fathers-monasticism"
  "robert-hooke-experimental"
  "taoist-inner-alchemy"
  "sanskrit-tantra-yoga"
  "kabbalah-jewish-mysticism"
  "non-canonical-ancient-texts"
  "rudolf-ii-prague-court"
)

echo "Collections to create: ${#collections[@]}"
