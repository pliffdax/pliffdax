#!/usr/bin/env bash
set -euo pipefail

revision=${1:?Usage: deploy.sh COMMIT_SHA}
[[ $revision =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
: "${DEPLOY_HOST:?Set DEPLOY_HOST}"
: "${DEPLOY_USER:?Set DEPLOY_USER}"
: "${DEPLOY_KEY_FILE:?Set DEPLOY_KEY_FILE}"
: "${DEPLOY_KNOWN_HOSTS_FILE:?Set DEPLOY_KNOWN_HOSTS_FILE}"
test -s dist/index.html
printf '%s\n' "$revision" > dist/revision.txt

# Use a wrapper so rsync receives exactly the same host verification options.
ssh_dir=$(mktemp -d)
trap 'rm -rf "$ssh_dir"' EXIT
cat > "$ssh_dir/ssh" <<'SSH'
#!/usr/bin/env bash
exec ssh -i "$DEPLOY_KEY_FILE" \
  -o "UserKnownHostsFile=$DEPLOY_KNOWN_HOSTS_FILE" \
  -o StrictHostKeyChecking=yes -o BatchMode=yes -o IdentitiesOnly=yes \
  -o ConnectTimeout=15 "$@"
SSH
chmod 700 "$ssh_dir/ssh"
target="$DEPLOY_USER@$DEPLOY_HOST"
previous=$("$ssh_dir/ssh" "$target" current)
rsync -rltz --chmod=D755,F644 --safe-links -e "$ssh_dir/ssh" \
  dist/ "$target:$revision/"
"$ssh_dir/ssh" "$target" "activate $revision"

verify() {
  local published code route
  published=$(curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
    --retry 4 --retry-delay 2 --retry-all-errors \
    "https://pliffdax.dev/revision.txt?revision=$revision") || return 1
  [[ $published == "$revision" ]] || return 1
  for route in / /notes /projects /notes/starting-with-an-empty-readme /projects/pliffdax-dev; do
    curl --fail --silent --show-error --connect-timeout 10 --max-time 30 \
      "https://pliffdax.dev$route" -o /dev/null || return 1
  done
  code=$(curl --silent --show-error --connect-timeout 10 --max-time 30 \
    -o /dev/null -w '%{http_code}' https://pliffdax.dev/ci-missing-page) || return 1
  [[ $code == 404 ]]
}

if ! verify; then
  echo 'Production verification failed.' >&2
  if [[ $previous =~ ^[a-f0-9]{40}$ ]]; then
    "$ssh_dir/ssh" "$target" "activate $previous"
    echo "Restored $previous" >&2
  fi
  exit 1
fi
echo "Published $revision to https://pliffdax.dev"
