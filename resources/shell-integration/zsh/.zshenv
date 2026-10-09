# AgentDock ZDOTDIR shim: run the user's own startup files.
[[ -f "${USER_ZDOTDIR:-$HOME}/.zshenv" ]] && source "${USER_ZDOTDIR:-$HOME}/.zshenv"
