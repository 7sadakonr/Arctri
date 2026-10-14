#!/bin/sh
# Called by an agent CLI (Claude Code hook: JSON on stdin; Codex notify: JSON as the last argument).
# Writes one event file into the spool directory of the Arctri tab; Arctri validates it. Never blocks, never prints, always exits 0.
agent="$1"
dir="$ARCTRI_EVENTS_DIR"
[ -n "$dir" ] && [ -d "$dir" ] && [ -n "$ARCTRI_EVENT_TOKEN" ] || exit 0
if [ "$#" -ge 2 ]; then
  for last; do :; done
  body="$last"
else
  body="$(head -c 65536)"
fi
[ -n "$body" ] || exit 0
name="$(date +%s%N 2>/dev/null)"
case "$name" in *N*|"") name="$(date +%s)" ;; esac
f="$dir/$name-$$.json"
printf '{"nonce":"%s","ts":%s,"agent":"%s","payload":%s}' "$ARCTRI_EVENT_TOKEN" "$name" "$agent" "$body" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null
exit 0
