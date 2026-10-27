# Deploy on the Oracle Cloud VM

The app runs on one Oracle Cloud "Always Free" VM. Caddy gives HTTPS, and Docker Compose runs the app and Caddy. The app runs the scheduled jobs itself (`RUN_JOBS=1`).

- `compose.yaml`: the app and Caddy.
- `Caddyfile`: HTTPS for `mail.samayo.me` and `mail.demo.samayo.me`, and the security headers.
- `cloud-init.yaml`: the first boot of the VM. It installs Docker, security updates, and fail2ban, and opens ports 80 and 443.
- `.github/workflows/deploy.yml`: builds the ARM image, pushes it to GHCR, and deploys it on each push to `main`.

## Create the VM

The account must be on Pay As You Go. Otherwise Oracle can reclaim an idle Always Free VM. The Always Free resources stay free.

1. Create a VM in the home region (US East, Ashburn):
   - Image: Canonical Ubuntu 24.04 (aarch64).
   - Shape: `VM.Standard.A1.Flex`, 2 OCPUs, 12 GB memory. This is the full Always Free amount.
   - A public subnet with a public IPv4 address. Use a reserved IP, so that the address stays the same.
   - Your SSH public key.
   - Advanced options › Initialization script: the content of `cloud-init.yaml`.
2. In the security list of the subnet, add ingress rules from `0.0.0.0/0` for TCP 80, TCP 443, and UDP 443.
3. Wait about 5 minutes for the first boot. Then make sure that `ssh ubuntu@<IP> docker compose version` works.

## Put the app secrets on the VM

The secrets are in `/opt/mail/app.env`. Only the `ubuntu` user can read the file. `APP_URL`, `PORT`, and `RUN_JOBS` are in `compose.yaml`, so leave them out.

```sh
ssh ubuntu@<IP> 'umask 077 && cat > /opt/mail/app.env' < app.env
```

The names are in `.env.example`, plus `HOSTED_MAILBOXES`, `HOSTED_MAIL_PASSWORD`, `RESEND_API_KEY`, and `RESEND_WEBHOOK_SECRET`.

## Connect GitHub Actions

1. Make an SSH key only for deploys: `ssh-keygen -t ed25519 -N '' -f deploy_key`. Add `deploy_key.pub` to `/home/ubuntu/.ssh/authorized_keys` on the VM.
2. In the repository settings:
   - Variable `DEPLOY_HOST`: the IP address of the VM.
   - Secret `DEPLOY_SSH_KEY`: the content of `deploy_key`.
   - Secret `DEPLOY_KNOWN_HOSTS`: the output of `ssh-keyscan <IP>`.
3. Delete `deploy_key` from your computer. Run the Deploy workflow (Actions › Deploy › Run workflow).
4. After the first push, set the `mail` package in GHCR to public, or keep it private. The deploy logs in with the job token, so both work.

## Move the domain

Before the DNS change, Caddy cannot get certificates. After the change, it gets them in less than a minute.

1. In Netlify DNS, change the `mail` and `mail.demo` records from CNAME to an A record with the IP address of the VM.
2. Make sure that `https://mail.samayo.me` shows the app, and that `docker compose logs caddy` shows the certificates.

## Commands on the VM

```sh
cd /opt/mail
docker compose ps                 # state and health
docker compose logs -f app        # app logs
docker compose restart app        # restart the app
```
