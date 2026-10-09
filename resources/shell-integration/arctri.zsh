# Arctri shell integration for zsh. Sourced from the ZDOTDIR shim.
[[ -n "$ARCTRI_NONCE" ]] || return 0
[[ -z "$__AD_LOADED" ]] || return 0
__AD_LOADED=1
typeset -g __ad_ran= __ad_id=0

__ad_b64() { base64 | tr -d '\n' }

__ad_preexec() {
  __ad_ran=1
  (( __ad_id++ ))
  printf '\033]6973;%s;cmd;%s;%s\007' "$ARCTRI_NONCE" "$__ad_id" "$(printf '%s' "$1" | __ad_b64)"
  # Block mode: wipe the echoed command so the output always starts at row 0 (see arctri.bash).
  [[ "$ARCTRI_BLOCKS" == 1 ]] && printf '\033[H\033[2J\033[3J'
  printf '\033]133;C;aid=%s\007' "$ARCTRI_NONCE"
}

__ad_precmd() {
  local ec=$?
  if [[ -n "$__ad_ran" ]]; then
    printf '\033]133;D;%s;aid=%s\007' "$ec" "$ARCTRI_NONCE"
    __ad_ran=
    [[ "$ARCTRI_BLOCKS" == 1 ]] && printf '\033[H\033[2J\033[3J'
  fi
  printf '\033]6973;%s;cwd;%s\007' "$ARCTRI_NONCE" "$(printf '%s' "$PWD" | __ad_b64)"
  printf '\033]133;A;aid=%s\007\033]133;B;aid=%s\007' "$ARCTRI_NONCE" "$ARCTRI_NONCE"
  return $ec
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec __ad_preexec
precmd_functions=(__ad_precmd ${precmd_functions:#__ad_precmd})
printf '\033]6973;%s;hello;zsh;%s;1\007' "$ARCTRI_NONCE" "$ZSH_VERSION"
