# Arctri shell integration for bash (>= 4.4, uses PS0).
# Loaded with `bash --rcfile`. Inert unless ARCTRI_NONCE is set.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
[ -n "$ARCTRI_NONCE" ] || return 0 2>/dev/null
[ -z "$__AD_LOADED" ] || return 0 2>/dev/null
__AD_LOADED=1

__ad_b64() { if base64 -w0 </dev/null >/dev/null 2>&1; then base64 -w0; else base64 | tr -d '\n'; fi; }

# Multi-line commands arrive as one line: eval "$(printf %s 'BASE64' | base64 -d)". The original text is what
# gets reported (and what ends up in history).
__ad_original() {
  local line b
  line=$(HISTTIMEFORMAT= builtin history 1 2>/dev/null | sed -e 's/^ *[0-9]* *//')
  b=$(printf '%s' "$line" | sed -n "s/^eval \"\$(printf %s '\([A-Za-z0-9+\/=]*\)' | base64 -d)\"\$/\1/p")
  if [ -n "$b" ]; then printf '%s' "$b" | base64 -d 2>/dev/null; else printf '%s' "$line"; fi
}

__ad_ps0() {
  local text
  text=$(__ad_original)
  printf '\033]6973;%s;cmd;%s;%s\007' "$ARCTRI_NONCE" "$1" "$(printf '%s' "$text" | __ad_b64)"
  # Block mode: wipe the echoed command so the output always starts at row 0. Terminal resizes (ConPTY
  # re-wraps the echo) can then never shift where the output begins. Only for the first command of an
  # input buffer: later ones (a multi-line paste) must not wipe the output of the earlier ones.
  if [ -z "$__ad_ran" ] && [ "$ARCTRI_BLOCKS" = 1 ]; then printf '\033[H\033[2J\033[3J'; fi
  printf '\033]133;C;aid=%s\007' "$ARCTRI_NONCE"
}

__ad_prompt() {
  local ec=$?
  if [ -n "$__ad_ran" ]; then
    printf '\033]133;D;%s;aid=%s\007' "$ec" "$ARCTRI_NONCE"
    __ad_ran=
    # keep the base64 wrapper out of history; store the command the user actually wrote
    local orig wrapped
    wrapped=$(HISTTIMEFORMAT= builtin history 1 2>/dev/null | sed -e 's/^ *[0-9]* *//')
    case "$wrapped" in
      'eval "$(printf %s '*) orig=$(__ad_original); builtin history -d -1 2>/dev/null; [ -n "$orig" ] && builtin history -s -- "$orig" ;;
    esac
    [ "$ARCTRI_BLOCKS" = 1 ] && printf '\033[H\033[2J\033[3J'
  fi
  printf '\033]6973;%s;cwd;%s\007' "$ARCTRI_NONCE" "$(printf '%s' "$PWD" | __ad_b64)"
  printf '\033]133;A;aid=%s\007\033]133;B;aid=%s\007' "$ARCTRI_NONCE" "$ARCTRI_NONCE"
  return "$ec"
}

# The arithmetic in the offset of a zero-length substring runs in the main shell (not a subshell)
# and expands to nothing, so it records that a command ran without printing anything.
# The command substitution must come first: it forks, so it sees __ad_ran as it was before this command.
PS0="${PS0}"'$(__ad_ps0 \#)${BASH:$((__ad_ran=1)):0}'
case "$(declare -p PROMPT_COMMAND 2>/dev/null)" in
  "declare -a"*) PROMPT_COMMAND=(__ad_prompt "${PROMPT_COMMAND[@]}") ;;
  *) PROMPT_COMMAND="__ad_prompt${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
# The last field says command boundaries are reported (always true here); ARCTRI_BLOCKS only decides whether
# the screen is cleared between commands.
printf '\033]6973;%s;hello;bash;%s;1\007' "$ARCTRI_NONCE" "${BASH_VERSION%%[^0-9.]*}"
