#!/usr/bin/env bash
# memory-health.sh — Check memory freshness across all repos and hive_mind activity
# Run as a scheduled task in ClaudeClaw

set -euo pipefail

DB_PATH="${1:-$(dirname "$0")/../store/claudeclaw.db}"
STALE_HOURS=72  # Alert if repo memory hasn't been updated in 3 days

echo "=== Memory Health Check ==="
echo ""

# 1. Check hive_mind activity per agent (last 24h)
echo "Hive Mind Activity (last 24h):"
sqlite3 "$DB_PATH" "
  SELECT agent_id,
         COUNT(*) as entries,
         datetime(MAX(created_at), 'unixepoch', 'localtime') as last_entry
  FROM hive_mind
  WHERE created_at >= unixepoch('now', '-1 day')
  GROUP BY agent_id
  ORDER BY entries DESC;
" 2>/dev/null | while IFS='|' read -r agent count last; do
  echo "  $agent: $count entries (last: $last)"
done

# Check for agents with NO activity
INACTIVE=$(sqlite3 "$DB_PATH" "
  SELECT DISTINCT agent_id FROM hive_mind
  EXCEPT
  SELECT DISTINCT agent_id FROM hive_mind WHERE created_at >= unixepoch('now', '-1 day');
" 2>/dev/null)

if [[ -n "$INACTIVE" ]]; then
  echo "  INACTIVE (no activity in 24h): $INACTIVE"
fi

echo ""

# 2. Check repo memory file freshness
echo "Repo Memory Freshness:"
STALE_REPOS=""

check_memory() {
  local repo_path="$1"
  local repo_name="$2"
  local memory_file=""

  # Find the memory file
  if [[ -f "$repo_path/memory/MEMORY.md" ]]; then
    memory_file="$repo_path/memory/MEMORY.md"
  elif [[ -f "$repo_path/.claude/memory/MEMORY.md" ]]; then
    memory_file="$repo_path/.claude/memory/MEMORY.md"
  fi

  if [[ -z "$memory_file" || ! -f "$memory_file" ]]; then
    echo "  $repo_name: NO MEMORY FILE"
    return
  fi

  # Get age in hours (macOS stat)
  local mod_time
  mod_time=$(stat -f %m "$memory_file" 2>/dev/null || stat -c %Y "$memory_file" 2>/dev/null || echo 0)
  local now
  now=$(date +%s)
  local age_hours=$(( (now - mod_time) / 3600 ))
  local mod_date
  mod_date=$(date -r "$mod_time" '+%Y-%m-%d %H:%M' 2>/dev/null || date -d "@$mod_time" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")

  if [[ $age_hours -gt $STALE_HOURS ]]; then
    echo "  $repo_name: STALE (${age_hours}h old, last: $mod_date)"
    STALE_REPOS="${STALE_REPOS}${repo_name} "
  else
    echo "  $repo_name: OK (${age_hours}h old, last: $mod_date)"
  fi
}

# Check each repo
for repo in "$HOME/reef-os" "$HOME/business-os" "$HOME/content-creation-os" "$HOME/sage-os"; do
  if [[ -d "$repo" ]]; then
    check_memory "$repo" "$(basename "$repo")"
  fi
done

# Check PAI shared memory
PAI_MEMORY="$HOME/PAI-environments/production/memory/MEMORY.md"
if [[ -f "$PAI_MEMORY" ]]; then
  mod_time=$(stat -f %m "$PAI_MEMORY" 2>/dev/null || echo 0)
  now=$(date +%s)
  age_hours=$(( (now - mod_time) / 3600 ))
  mod_date=$(date -r "$mod_time" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "unknown")
  echo "  PAI (shared): ${age_hours}h old (last: $mod_date)"
fi

echo ""

# 3. Summary
TOTAL_HIVE=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM hive_mind;" 2>/dev/null || echo 0)
LAST_24H=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM hive_mind WHERE created_at >= unixepoch('now', '-1 day');" 2>/dev/null || echo 0)

echo "Summary: $TOTAL_HIVE total hive entries, $LAST_24H in last 24h"

if [[ -n "$STALE_REPOS" ]]; then
  echo "WARNING: Stale repos: $STALE_REPOS"
  echo "Consider running memory updates for these repos."
fi

echo ""
echo "=== Done ==="
