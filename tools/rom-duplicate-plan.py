"""Create a compact, review-only duplicate plan for a folder of CHD games."""

import csv
import json
import re
import sys
import tempfile
from collections import defaultdict
from datetime import datetime
from pathlib import Path


TAG = re.compile(r"\s*\(([^()]*)\)$")
DISC = re.compile(r"^Disc\s+(\d+)$", re.I)
REVISION = re.compile(r"^Rev(?:ision)?\s+([A-Z]|\d+)$", re.I)
VERSION_SUFFIX = re.compile(r"\s+(?:Version|Ver\.)\s*\d+(?:\.\d+)*$", re.I)
REGIONS = ("USA", "Europe", "UK", "Japan", "Australia", "Canada", "Spain",
           "France", "Germany", "Italy", "Brazil", "Korea", "China", "World")
REGION_RANK = {region: rank for rank, region in enumerate(REGIONS)}
LANGUAGE = re.compile(r"^(?:En|Ja|Fr|De|Es|It|Pt|Nl|Sv|No|Da|Fi|Ko|Zh)(?:,(?:En|Ja|Fr|De|Es|It|Pt|Nl|Sv|No|Da|Fi|Ko|Zh))*$", re.I)
PRERELEASE = re.compile(r"^(?:Beta|Proto|Demo|Sample|Preview)(?:\b|$)", re.I)
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_name(name):
    stem = Path(name).stem
    tags = []
    while match := TAG.search(stem):
        tags.append(match.group(1))
        stem = stem[:match.start()]
    tags.reverse()
    regions = [region for tag in tags for region in tag.split(",")
               if region.strip() in REGION_RANK for region in [region.strip()]]
    discs = [int(match.group(1)) for tag in tags if (match := DISC.fullmatch(tag))]
    revisions = [match.group(1).upper() for tag in tags if (match := REVISION.fullmatch(tag))]
    unknown = [tag for tag in tags if not any(region in tag.split(", ") for region in REGIONS)
               and not DISC.fullmatch(tag) and not REVISION.fullmatch(tag)
               and not LANGUAGE.fullmatch(tag) and not PRERELEASE.match(tag) and not DATE.fullmatch(tag)]
    return {"name": name, "title": stem.strip(), "tags": tags, "regions": regions,
            "disc": discs[0] if len(discs) == 1 else None,
            "revision": revisions[-1] if revisions else None,
            "prerelease": any(PRERELEASE.match(tag) for tag in tags), "unknown": unknown}


def revision_rank(value):
    if value is None:
        return 0
    return int(value) if value.isdigit() else ord(value) - ord("A") + 1


def complete_release(items):
    discs = [item["disc"] for item in items]
    if all(disc is None for disc in discs):
        return len(items) == 1
    if any(disc is None for disc in discs):
        return False
    return sorted(discs) == list(range(1, max(discs) + 1))


def plan(directory):
    source = Path(directory)
    if not source.is_dir():
        raise ValueError(f"Folder not found: {source}")
    files = sorted((p for p in source.iterdir() if p.is_file() and p.suffix.lower() == ".chd"),
                   key=lambda p: p.name.casefold())
    if not files:
        raise ValueError("No CHD files directly inside the folder")
    games = defaultdict(list)
    for path in files:
        item = parse_name(path.name)
        games[item["title"].casefold()].append(item)

    rows = []
    examples = []
    ambiguous = []
    for title_key, items in sorted(games.items()):
        title = items[0]["title"]
        releases = defaultdict(list)
        for item in items:
            release_tags = tuple(tag for tag in item["tags"] if not DISC.fullmatch(tag))
            releases[release_tags].append(item)
        issue = None
        if any(not item["regions"] for item in items) and len(releases) > 1:
            issue = "Region tag missing in a multiple-release game"
        if len({tuple(item["unknown"]) for item in items}) > 1:
            issue = "Different editions or unknown version tags"
        if any(not complete_release(group) for group in releases.values()):
            issue = "Possible incomplete or mixed multi-disc release"
        if len(releases) > 1 and not issue:
            ranked = []
            for tags, group in releases.items():
                region_rank = min(REGION_RANK.get(region, 999)
                                  for item in group for region in item["regions"])
                ranked.append(((group[0]["prerelease"], region_rank,
                                -revision_rank(group[0]["revision"]), str(tags).casefold()), tags))
            ranked.sort()
            chosen = ranked[0][1]
            if len(ranked) > 1 and ranked[0][0][:3] == ranked[1][0][:3]:
                issue = "Equal-priority releases need a human choice"
            elif not complete_release(releases[chosen]):
                issue = "Preferred release is missing discs"
        else:
            chosen = next(iter(releases))
        if issue:
            ambiguous.append({"game": title, "reason": issue, "files": len(items)})
        elif len(releases) > 1 and len(examples) < 12:
            examples.append({"game": title, "keep": [item["name"] for item in releases[chosen]],
                             "moveCount": len(items) - len(releases[chosen])})
        for tags, group in releases.items():
            for item in group:
                decision = "REVIEW" if issue else ("KEEP" if tags == chosen else "MOVE")
                reason = issue or ("Preferred release" if decision == "KEEP" else
                                   "Alternative region or revision")
                rows.append({"Game": title, "File": item["name"], "Decision": decision,
                             "Reason": reason, "Release": " | ".join(tags),
                             "Disc": item["disc"] or ""})

    # Similar title strings can be genuine sequels or different editions. Flag them,
    # but never merge them automatically.
    families = defaultdict(set)
    for items in games.values():
        title = items[0]["title"]
        families[VERSION_SUFFIX.sub("", title).casefold()].add(title)
    for titles in families.values():
        if len(titles) > 1:
            ambiguous.append({"game": " / ".join(sorted(titles)),
                              "reason": "Possible title-level version; kept as separate games", "files": 0})

    output_dir = Path(tempfile.gettempdir()) / "PS5-Pro-Operator"
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = output_dir / f"dreamcast-duplicate-plan-{datetime.now():%Y%m%d-%H%M%S}.csv"
    with manifest.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["Game", "File", "Decision", "Reason", "Release", "Disc"])
        writer.writeheader()
        writer.writerows(rows)
    counts = {decision: sum(row["Decision"] == decision for row in rows)
              for decision in ("KEEP", "MOVE", "REVIEW")}
    return {"source": str(source), "destinationAfterApproval": str(source / "duplicates"),
            "manifest": str(manifest), "gameTitles": len(games), "chdFiles": len(files),
            "counts": counts, "reviewGroups": len(ambiguous), "ambiguous": ambiguous[:20],
            "examples": examples, "note": "Review-only plan. No CHD files moved or deleted; no duplicates folder created."}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        print(json.dumps(plan(request["path"]), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
