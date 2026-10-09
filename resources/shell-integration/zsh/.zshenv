# AgentDock ZDOTDIR shim. zsh reads this file first (ZDOTDIR points here). It runs the user's own .zshenv,
# gives ZDOTDIR back to the user so every other startup file, and everything zsh writes (.zcompdump, history),
# stays in the user's own folder, and loads the integration at the first prompt, after the user's configuration.
[[ -f "${USER_ZDOTDIR:-$HOME}/.zshenv" ]] && source "${USER_ZDOTDIR:-$HOME}/.zshenv"
__AD_SCRIPT="${ZDOTDIR}/../agentdock.zsh"
# a .zshenv of the user's that moved ZDOTDIR itself wins
[[ "$ZDOTDIR" == "${__AD_SCRIPT%/../agentdock.zsh}" ]] && ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[[ "$ZDOTDIR" == "$HOME" ]] && unset ZDOTDIR
autoload -Uz add-zsh-hook
__ad_boot() {
  add-zsh-hook -d precmd __ad_boot
  unfunction __ad_boot
  source "$__AD_SCRIPT"
  unset __AD_SCRIPT
  # this prompt's precmd round already started, so run the integration's own precmd once by hand
  (( $+functions[__ad_precmd] )) && __ad_precmd
}
add-zsh-hook precmd __ad_boot
