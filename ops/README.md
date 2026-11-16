# Publishing pliffdax.dev

Open a pull request into `main`. GitHub Actions installs dependencies from
`package-lock.json` on Node 24, runs `npm run check`, and builds the static site.
`Check and build` must pass before merging. `main` requires a pull request, an
up-to-date branch and resolved conversations; force pushes and deletion are
disabled, including for administrators. No second reviewer is required for this
personal repository.

After merging, Actions uploads the built artifact to the VPS and atomically
switches `/var/www/pliffdax.dev/current` to `releases/<commit SHA>`. It checks the
published revision, the home page, listing pages, example content pages, and a
missing page's 404 response. If verification fails, it restores the previous
release and fails the job. Releases remain on the server for manual rollback;
review disk use periodically. Build artifacts expire on GitHub after seven days.
Deployments run serially, and a queued revision is skipped if it is no longer
the head of `main`. The workflow's **Run workflow** button retries the current
`main` revision.

## GitHub configuration

The `production` environment allows deployments only from the `main` branch.
Its secrets are available only to the deployment job:

| Setting | Type | Value |
| --- | --- | --- |
| `DEPLOY_HOST` | Environment variable | `188.245.181.186` |
| `DEPLOY_SSH_KEY` | Environment secret | Dedicated Ed25519 deployment private key |
| `DEPLOY_KNOWN_HOSTS` | Environment secret | VPS Ed25519 host key, obtained over an already trusted connection |

The build job and pull requests receive no deployment secrets. The deployment
job runs on a separate GitHub-hosted runner and uses the build's artifact.
Actions are pinned to full commit SHAs; update these deliberately when upgrading.

## VPS configuration

`deploy-pliffdax` owns `/var/www/pliffdax.dev`, with a `releases` subdirectory.
It has no sudo privileges. Install [deploy-command.sh](deploy-command.sh) as
`/usr/local/libexec/pliffdax-deploy`, owned by root with mode 755. The account's
root-owned `~/.ssh/authorized_keys` entry is:

```text
restrict,command="/usr/local/libexec/pliffdax-deploy" ssh-ed25519 <deployment public key>
```

The key permits restricted rsync uploads under `releases`, reading the current
revision, and activating a validated release. It cannot open a shell, forward
ports or change Caddy. Uploaded symlinks are munged by `rrsync` and rejected
before activation. The server needs Bash, rsync (including `rrsync`) and Caddy.

Append [Caddyfile.site](Caddyfile.site) to the existing `/etc/caddy/Caddyfile`.
Back up the original as `Caddyfile.before-<timestamp>`, run `caddy validate`, then
reload Caddy. Existing host blocks must stay intact. Extensionless URLs resolve
to Astro's `.html` files; unknown paths serve the generated 404 with status 404.
Hashed `/_astro/` assets are cached for one year; other files revalidate.

Cloudflare has DNS-only records for the apex: A `188.245.181.186` and AAAA
`2a01:4f8:c2c:10bd::1`, plus a DNS-only CNAME from `www` to `pliffdax.dev`.
Caddy manages HTTPS and redirects `www` to the apex.

## Manual publication and rollback

Normally merge a PR or rerun Actions. For an emergency local publication, use a
clean, checked-out commit and provide `DEPLOY_HOST`, `DEPLOY_USER`,
`DEPLOY_KEY_FILE`, and `DEPLOY_KNOWN_HOSTS_FILE`, then run `npm ci` and
`npm run deploy`. Do not put the key in the repository.

For an immediate rollback, inspect the retained releases with the existing
administrator SSH account, then switch to a known-good SHA:

```sh
ssh hetzner-vps-root 'ls -lt /var/www/pliffdax.dev/releases'
ssh hetzner-vps-root 'sudo -u deploy-pliffdax env SSH_ORIGINAL_COMMAND="activate <40-character SHA>" /usr/local/libexec/pliffdax-deploy'
curl --fail https://pliffdax.dev/revision.txt
```

Then revert the bad commit through a PR so `main` reflects production. To rotate
the deployment key, install its new public half in `authorized_keys`, replace
the `DEPLOY_SSH_KEY` environment secret, verify a deployment, and remove the old
public key. A Caddy rollback restores the saved configuration, validates it, and
reloads the service.
