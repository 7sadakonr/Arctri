_ad_dir="${ZDOTDIR}"
ZDOTDIR="${USER_ZDOTDIR:-$HOME}"
[[ -f "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"
source "${_ad_dir}/../agentdock.zsh"
unset _ad_dir
