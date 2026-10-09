for i in $(seq 1 300); do
  printf '\033]6973;seq=%s\007' "$i"
  echo "line $i"
  if [ $((i % 50)) -eq 0 ]; then printf '\033]133;D;0\007'; fi
done
