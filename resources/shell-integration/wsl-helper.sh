# AgentDock WSL helper: a long-lived POSIX sh that answers a fixed set of read-only queries.
# Request  (stdin):  <id> TAB <op> TAB <base64 arg1> TAB <base64 arg2>
# Response (stdout): <id> TAB <base64 output>
# Arguments are decoded and used only as data (never evaluated).
dec() { printf %s "$1" | base64 -d 2>/dev/null; }
enc() { base64 | tr -d '\n'; }
expand_home() {
  case "$1" in
    "~") printf %s "$HOME" ;;
    "~/"*) printf %s "$HOME/${1#"~/"}" ;;
    *) printf %s "$1" ;;
  esac
}
TAB=$(printf '\t')
while IFS="$TAB" read -r id op a1 a2; do
  out=""
  case "$op" in
    ls)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && ls -1Ap 2>/dev/null | head -n 500)
      ;;
    cmds)
      out=$(
        IFS=:
        for p in $PATH; do
          case "$p" in /mnt/*|"") continue ;; esac
          [ -d "$p" ] || continue
          find -L "$p" -maxdepth 1 -type f -perm /111 -printf '%f\n' 2>/dev/null || ls -1 "$p" 2>/dev/null
        done | sort -u
      )
      ;;
    branches)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && git for-each-ref --format='%(refname:short)' refs/heads refs/remotes 2>/dev/null)
      ;;
    cat)
      f=$(expand_home "$(dec "$a1")")
      max=$(dec "$a2")
      if [ -f "$f" ] && [ "$(wc -c <"$f" 2>/dev/null || echo 99999999)" -le "${max:-524288}" ]; then out=$(cat "$f" 2>/dev/null); fi
      ;;
    branch)
      d=$(dec "$a1")
      while :; do
        if [ -e "$d/.git" ]; then
          if [ -d "$d/.git" ]; then h=$(cat "$d/.git/HEAD" 2>/dev/null); else
            g=$(sed -n 's/^gitdir: //p' "$d/.git" 2>/dev/null); case "$g" in /*) ;; *) g="$d/$g" ;; esac; h=$(cat "$g/HEAD" 2>/dev/null)
          fi
          case "$h" in "ref: refs/heads/"*) out=${h#"ref: refs/heads/"} ;; *) out=$(printf %s "$h" | cut -c1-7) ;; esac
          break
        fi
        [ -z "$d" ] || [ "$d" = "/" ] && break
        d=${d%/*}
      done
      ;;
    home) out=$HOME ;;
    ping) out=pong ;;
  esac
  printf '%s\t%s\n' "$id" "$(printf %s "$out" | enc)"
done
