#!/usr/bin/env bash
# Share of a Harvest file's non-blank lines (whitespace-trimmed) that are unchanged from its kit source, by longest common subsequence.
# Usage: scripts/ui-identical.sh <kit-file> <harvest-file>   (kit repo: bumbmatei-sys/admin-dashboard at the commit named in docs/ui-sources.md)
norm() { grep -v '^[[:space:]]*$' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'; }
total=$(norm "$2" | wc -l)
same=$(diff --unchanged-line-format='%L' --old-line-format='' --new-line-format='' <(norm "$1") <(norm "$2") | wc -l)
echo "$same of $total ($(( same * 100 / total ))%) $2"
