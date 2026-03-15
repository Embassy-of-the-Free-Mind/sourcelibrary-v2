#!/usr/bin/env python3
"""
Name sub-clusters by analyzing book titles, authors, years, and languages.
Uses Gemini to propose concise names for each sub-cluster.
"""

import json
import os
import time
from pathlib import Path

OUTPUT_DIR = Path(__file__).parent.parent / "output"

# Load API key
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent / ".env.production.local")

from google import genai

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def format_subcluster_for_prompt(sc):
    """Format a sub-cluster's books into a concise string for the LLM."""
    books = sc["books"]
    lines = []
    for b in books:
        title = b.get("title", "?")[:80]
        author = b.get("author", "")[:40]
        year = b.get("year", "")
        lang = b.get("lang", "")
        lines.append(f"  - {title} ({author}, {year}, {lang})")
    return "\n".join(lines)


def name_cluster_subclusters(cluster):
    """Use Gemini to name all subclusters in a cluster at once."""
    if not cluster.get("split") or len(cluster["subclusters"]) < 2:
        return None

    parent = cluster["name"]
    parts = []
    for i, sc in enumerate(cluster["subclusters"]):
        book_list = format_subcluster_for_prompt(sc)
        parts.append(f"## Sub-cluster {i} ({sc['size']} books)\n{book_list}")

    prompt = f"""You are a historian of ideas cataloging a digital rare book library.

The parent cluster is "{parent}" ({cluster['total']} books total).
It has been split into {len(cluster['subclusters'])} sub-clusters by embedding similarity.

For each sub-cluster below, propose a SHORT name (2-5 words) that captures what distinguishes it from the others. The name should be specific enough to be useful as a library category. Do NOT use "&" to combine two topics — if the cluster seems to contain two things, name the dominant one.

{chr(10).join(parts)}

Respond with ONLY a JSON array of strings, one name per sub-cluster, in order.
Example: ["Paracelsian Medicine", "Chrysopoeia Manuals", "Arabic Alchemy"]"""

    response = client.models.generate_content(
        model="gemini-2.0-flash",
        contents=prompt,
    )
    text = response.text.strip()

    # Parse JSON from response
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    try:
        names = json.loads(text)
        if isinstance(names, list) and len(names) == len(cluster["subclusters"]):
            return names
    except json.JSONDecodeError:
        pass

    print(f"  WARNING: Failed to parse names for {parent}: {text[:100]}")
    return None


def main():
    with open(OUTPUT_DIR / "sub-cluster-v2.json") as f:
        data = json.load(f)

    results = []
    for cluster in data:
        if not cluster.get("split") or len(cluster["subclusters"]) < 2:
            results.append({
                "cluster_id": cluster["cluster_id"],
                "parent": cluster["name"],
                "total": cluster["total"],
                "split": False,
                "subclusters": [{"name": cluster["name"], "size": cluster["total"]}],
            })
            continue

        print(f"Naming: {cluster['name']} ({len(cluster['subclusters'])} sub-clusters)...")
        names = name_cluster_subclusters(cluster)

        if names:
            scs = []
            for i, (name, sc) in enumerate(zip(names, cluster["subclusters"])):
                scs.append({
                    "name": name,
                    "size": sc["size"],
                    "languages": sc.get("languages", {}),
                })
            results.append({
                "cluster_id": cluster["cluster_id"],
                "parent": cluster["name"],
                "total": cluster["total"],
                "split": True,
                "noise_count": cluster.get("noise_count", 0),
                "subclusters": scs,
            })
            sizes = [f"{n} ({sc['size']})" for n, sc in zip(names, cluster["subclusters"])]
            print(f"  → {', '.join(sizes)}")
        else:
            # Fallback: generic names
            scs = []
            for i, sc in enumerate(cluster["subclusters"]):
                scs.append({
                    "name": f"{cluster['name']} ({chr(65 + i)})",
                    "size": sc["size"],
                })
            results.append({
                "cluster_id": cluster["cluster_id"],
                "parent": cluster["name"],
                "total": cluster["total"],
                "split": True,
                "subclusters": scs,
            })

        time.sleep(0.3)  # Rate limit

    # Save
    out_path = OUTPUT_DIR / "named-subclusters.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out_path}")

    # Print summary
    total_named = sum(len(r["subclusters"]) for r in results if r["split"])
    print(f"Named {total_named} sub-clusters across {sum(1 for r in results if r['split'])} clusters")


if __name__ == "__main__":
    main()
