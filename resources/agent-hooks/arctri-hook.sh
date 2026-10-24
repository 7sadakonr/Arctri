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
# The model in use, for the agent bar: only its name leaves this script, never any transcript text.
clean() { tr -cd 'A-Za-z0-9._:/@+-' | cut -c1-80; }
last_model() { tail -c "${2:-67108864}" "$1" 2>/dev/null | grep -o '"model":"[^"]*"' | grep -v '<synthetic>' | tail -1 | sed 's/^"model":"//; s/"$//' | clean; }
model=""
if [ "$agent" = claude ]; then
  # the transcript of the session: the whole of it (up to 64 MB) at the start and at the end of a turn, the last 2 MB after a tool
  # (not at UserPromptSubmit: no reply yet, so the transcript would still name the model from before a /model)
  size=67108864
  printf '%s' "$body" | grep -q '"hook_event_name" *: *"\(SessionStart\|Stop\)"' || size=2097152
  if printf '%s' "$body" | grep -q '"hook_event_name" *: *"\(SessionStart\|Stop\|PostToolUse\|PostToolUseFailure\)"'; then
    tp="$(printf '%s' "$body" | sed -n 's/.*"transcript_path" *: *"\([^"]*\)".*/\1/p' | head -1)"
    case "$tp" in /*) case "$tp" in *..*|*[!A-Za-z0-9._/@+\ -]*) tp="" ;; esac ;; *) tp="" ;; esac
    [ -n "$tp" ] && [ -f "$tp" ] && model="$(last_model "$tp" "$size")"
  fi
elif [ "$agent" = codex ]; then
  tid="$(printf '%s' "$body" | sed -n 's/.*"thread[-_]id" *: *"\([^"]*\)".*/\1/p' | head -1)"
  case "$tid" in *[!A-Za-z0-9-]*) tid="" ;; esac
  if [ "${#tid}" -ge 8 ] && [ "${#tid}" -le 64 ]; then
    for rollout in "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*-"$tid".jsonl; do
      [ -f "$rollout" ] && model="$(last_model "$rollout")"
      break
    done
  fi
fi
name="$(date +%s%N 2>/dev/null)"
case "$name" in *N*|"") name="$(date +%s)" ;; esac
f="$dir/$name-$$.json"
printf '{"nonce":"%s","ts":%s,"agent":"%s","model":"%s","payload":%s}' "$ARCTRI_EVENT_TOKEN" "$name" "$agent" "$model" "$body" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null
exit 0
