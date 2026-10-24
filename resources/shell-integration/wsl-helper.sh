# Arctri WSL helper: a long-lived POSIX sh that answers a fixed set of read-only queries.
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
# milliseconds since the epoch; %3N is not honoured by every `date`, so divide nanoseconds ourselves
mtime_ms() { echo $(( $(date -r "$1" +%s%N) / 1000000 )); }
# true when $1 (absolute, may not exist yet) lies below the resolved root $2 (never the root itself)
inside_root() {
  case "$1" in /*) ;; *) return 1 ;; esac
  case "/$1/" in */../*) return 1 ;; esac
  _real=$(readlink -f -- "$1" 2>/dev/null)
  if [ -z "$_real" ]; then
    _par=$(readlink -f -- "$(dirname "$1")" 2>/dev/null)
    [ -n "$_par" ] || return 1
    _real="$_par/$(basename "$1")"
  fi
  case "$_real" in "$2"/*) return 0 ;; *) return 1 ;; esac
}
TAB=$(printf '\t')
while IFS="$TAB" read -r id op a1 a2 a3; do
  out=""
  case "$op" in
    ls)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && ls -1Ap 2>/dev/null | head -n 500)
      ;;
    lsd)
      d=$(expand_home "$(dec "$a1")")
      # one `ls`, its exit status tells an unreadable folder from an empty one; the caller truncates
      if out=$(cd "$d" 2>/dev/null && ls -1Ap . 2>/dev/null); then
        out="OK
$out"
      else
        out="ERR"
      fi
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
    gitstat)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && git -c core.quotepath=off --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
        printf '##STATUS\n'
        git -c core.quotepath=off --no-optional-locks status -s
        printf '##NUMSTAT\n'
        git -c core.quotepath=off --no-optional-locks diff --relative --numstat HEAD 2>/dev/null
      })
      ;;
    headtext)
      # a1 = folder, a2 = path relative to it, a3 = revision (default HEAD): the file as committed ("x" keeps the trailing newline through $(...))
      d=$(expand_home "$(dec "$a1")")
      r=$(dec "$a2")
      rev=$(dec "$a3")
      case "$rev" in ""|"=") rev=HEAD ;; esac
      case "$rev" in HEAD|HEAD^|[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;; *) rev="" ;; esac
      case "$rev" in *[!0-9a-fHEAD^]*) rev="" ;; esac
      if [ -n "$rev" ]; then
        out=$(cd "$d" 2>/dev/null && t=$(git -c core.quotepath=off --no-optional-locks show "$rev:./$r" 2>/dev/null && printf x) && printf 'OK\n%s' "${t%x}")
      fi
      ;;
    refs)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && git --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
        printf 'OK\n'
        git --no-optional-locks for-each-ref --format='%(refname)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)' refs/heads refs/remotes 2>/dev/null
      })
      ;;
    gitlog)
      d=$(expand_home "$(dec "$a1")")
      n=$(dec "$a2")
      case "$n" in ""|*[!0-9]*) n=100 ;; esac
      out=$(cd "$d" 2>/dev/null && git --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
        printf 'OK\n'
        git -c core.quotepath=off --no-optional-locks log -n "$n" --format='%H%x09%h%x09%an%x09%at%x09%D%x09%s' 2>/dev/null
      })
      ;;
    gitshow)
      d=$(expand_home "$(dec "$a1")")
      h=$(dec "$a2")
      case "$h" in ""|*[!0-9a-f]*) h="" ;; esac
      if [ -n "$h" ]; then
        out=$(cd "$d" 2>/dev/null && git --no-optional-locks rev-parse --is-inside-work-tree >/dev/null 2>&1 && {
          printf '##STATUS\n'
          git -c core.quotepath=off --no-optional-locks show --format= --relative --name-status -M "$h" 2>/dev/null
          printf '##NUMSTAT\n'
          git -c core.quotepath=off --no-optional-locks show --format= --relative --numstat -M "$h" 2>/dev/null
        })
      fi
      ;;
    gitall)
      d=$(expand_home "$(dec "$a1")")
      out=$(cd "$d" 2>/dev/null && git -c core.quotepath=off --no-optional-locks status -s --ignored=matching 2>/dev/null)
      ;;
    codexcfg)
      # the only file this helper may read besides the ones named in a request: Codex's own config
      f="${CODEX_HOME:-$HOME/.codex}/config.toml"
      if [ -f "$f" ]; then out="EXISTS
$(cat "$f")"; else out="MISSING"; fi
      ;;
    codexcfgw)
      # the only file this helper writes: Codex's config, after copying the old one to a backup name (a2)
      dir="${CODEX_HOME:-$HOME/.codex}"
      f="$dir/config.toml"
      bk=$(dec "$a2" | tr -cd 'A-Za-z0-9._-')
      mkdir -p "$dir" 2>/dev/null
      [ -f "$f" ] && [ -n "$bk" ] && cp "$f" "$dir/$bk" 2>/dev/null
      if dec "$a1" > "$f.arctri-tmp" 2>/dev/null && mv "$f.arctri-tmp" "$f" 2>/dev/null; then out=OK; else rm -f "$f.arctri-tmp"; out=FAIL; fi
      ;;
    statfile|readfile|writefile)
      # a1 = absolute path, a2 = max bytes (read) or base64 content (write), a3 = "<root>|<expected mtime ms>"
      f=$(dec "$a1")
      ra=$(dec "$a3")
      root=${ra%%|*}
      exp=${ra#*|}
      real=$(readlink -f -- "$f" 2>/dev/null)
      case "$f" in /*) ;; *) f="" ;; esac
      case "/$f/" in */../*) f="" ;; esac
      # the file (after resolving symlinks) must stay inside the working folder of the tab
      if [ -z "$f" ] || [ -z "$root" ]; then out="ERR denied"
      elif [ -z "$(readlink -f -- "$root" 2>/dev/null)" ]; then out="ERR denied"   # unresolvable root: fail closed
      else
        rr=$(readlink -f -- "$root" 2>/dev/null)
        [ -n "$rr" ] || f=""
        pr=$(readlink -f -- "$(dirname "$f")" 2>/dev/null)
        [ -n "$real" ] || real="$pr/$(basename "$f")"
        case "$real/" in "$rr"/*) inside=1 ;; *) inside=0 ;; esac
        if [ "$inside" != 1 ]; then out="ERR denied"
        elif [ "$op" = statfile ]; then
          if [ -e "$f" ]; then out="OK $(mtime_ms "$f") $(wc -c <"$f")"; else out="ERR notfound"; fi
        elif [ "$op" = readfile ]; then
          max=$(dec "$a2")
          if [ ! -f "$f" ]; then out="ERR notfound"
          elif [ "$(wc -c <"$f")" -gt "${max:-5242880}" ]; then out="ERR toolarge"
          else out="OK $(mtime_ms "$f") $(wc -c <"$f")
$(base64 -w0 <"$f")"; fi
        else
          cur=""; [ -e "$f" ] && cur=$(mtime_ms "$f")
          if [ -n "$exp" ] && [ -n "$cur" ] && [ "$cur" != "$exp" ]; then out="CONFLICT $cur"
          else
            tmp="$f.arctri-tmp"
            { if [ -e "$f" ]; then cp -p -- "$f" "$tmp"; fi; dec "$a2" | base64 -d > "$tmp" && mv -- "$tmp" "$f"; } 2>/dev/null \
              && out="OK $(mtime_ms "$f")" || { rm -f -- "$tmp"; out="ERR failed"; }
          fi
        fi
      fi
      ;;
    mkfile|mkdir|mv|rm|cp)
      # a1 = path, a2 = target path (mv, cp), a3 = "<root>|"; every path must stay below the tab's working folder
      p=$(dec "$a1")
      ra=$(dec "$a3")
      rr=$(readlink -f -- "${ra%%|*}" 2>/dev/null)
      if [ -z "$rr" ] || ! inside_root "$p" "$rr"; then out="ERR denied"
      else
        case "$op" in
          mkfile|mkdir)
            if [ -e "$p" ] || [ -L "$p" ]; then out="ERR exists"
            elif { [ "$op" = mkdir ] && mkdir -- "$p" || [ "$op" = mkfile ] && : > "$p"; } 2>/dev/null; then out="OK"
            else out="ERR failed"; fi ;;
          mv|cp)
            q=$(dec "$a2")
            if ! inside_root "$q" "$rr"; then out="ERR denied"
            elif case "$q/" in "$p"/*) true ;; *) false ;; esac; then out="ERR denied"   # into itself
            elif [ ! -e "$p" ] && [ ! -L "$p" ]; then out="ERR notfound"
            elif [ -e "$q" ] || [ -L "$q" ]; then out="ERR exists"
            elif { [ "$op" = mv ] && mv -- "$p" "$q" || [ "$op" = cp ] && cp -R -P -- "$p" "$q"; } 2>/dev/null; then out="OK"
            else out="ERR failed"; fi ;;
          rm)
            if [ ! -e "$p" ] && [ ! -L "$p" ]; then out="ERR notfound"
            elif rm -rf -- "$p" 2>/dev/null; then out="OK"
            else out="ERR failed"; fi ;;
        esac
      fi
      ;;
    home) out=$HOME ;;
    ping) out=pong ;;
  esac
  printf '%s\t%s\n' "$id" "$(printf %s "$out" | enc)"
done
