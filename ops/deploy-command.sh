#!/usr/bin/env bash
# Installed by root as /usr/local/libexec/pliffdax-deploy (root-owned, mode 755).
# authorized_keys: restrict,command="/usr/local/libexec/pliffdax-deploy" ssh-ed25519 ...
set -euo pipefail
base=/var/www/pliffdax.dev
command=${SSH_ORIGINAL_COMMAND:-}

if [[ $command == rsync\ --server\ * ]]; then
  exec /usr/bin/rrsync -wo -munge "$base/releases"
elif [[ $command == current ]]; then
  if [[ -L $base/current ]]; then
    basename "$(readlink "$base/current")"
  fi
elif [[ $command =~ ^activate\ ([a-f0-9]{40})$ ]]; then
  revision=${BASH_REMATCH[1]}
  release="$base/releases/$revision"
  # Never let uploaded links make Caddy serve files outside this release.
  test -d "$release"
  test -z "$(find "$release" -type l -print -quit)"
  test -s "$release/index.html"
  test -s "$release/404.html"
  test -d "$release/_astro"
  grep -Fxq "$revision" "$release/revision.txt"
  ln -s "releases/$revision" "$base/.current-$revision"
  mv -Tf "$base/.current-$revision" "$base/current"
  echo "Activated $revision"
else
  echo 'Only site upload, current and activate commands are allowed.' >&2
  exit 1
fi
