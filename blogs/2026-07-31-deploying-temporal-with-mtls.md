---
slug: deploying-temporal-with-mtls
title: "Deploying a Self-Hosted Temporal Cluster with mTLS, Auto-Renewing Certs and an SSO-Protected UI"
date: 2026-07-31
description: "Standing up Temporal on a single EC2 box: workers authenticated over mutual TLS with self-renewing certs, an SSO-protected dashboard and exactly one inbound port open."
tags: [temporal, mtls, infrastructure, security, devops]
---

This is the story of standing up a production-ish [Temporal](https://temporal.io) cluster on a single EC2 box — where the workers authenticate over mutual TLS with certificates that renew themselves and the web dashboard sits behind single sign-on, all with exactly **one** inbound port open to the internet.

It's also a story about the wrong turns, because the wrong turns are where the actual learning is. If you're setting up something similar, the dead-ends below will save you an afternoon.

{/* truncate */}

## What I set out to build

Three machines already sit on a Tailscale mesh for unrelated reasons. The goal was narrow:

- Run a Temporal cluster on **one** of those nodes.
- Let workers connect from the other nodes — or from anywhere off the mesh entirely.
- Keep it secure without a lot of moving parts.

The workers being able to live *anywhere*, mesh or not, turned out to be the constraint that drove every subsequent decision.

## Understanding what "Temporal server" actually is

Before any of this made sense, I had to fix a mental model. I thought "server," "frontend" and "Postgres" were three separate components. They're not.

The **Temporal Server** is a single program containing four internal roles: Frontend, History, Matching and an internal Worker. Of those, **only the Frontend is reachable from outside** — it's the gRPC API on port `7233`. The other three are internal plumbing.

And crucially: **"Frontend" does not mean the web UI.** That naming collision trips everyone up. In Temporal-speak, the Frontend is the API door. The dashboard you look at in a browser is a *separate* program (the **Web UI**, port `8080`) that is itself just another client of the Frontend.

So the real component list is:

1. **Temporal Server** — one program; its only external door is the Frontend (gRPC, `7233`).
2. **Web UI** — a separate program (HTTP, `8080`) that also talks to the Frontend behind the scenes.
3. **PostgreSQL** — the database (`5432`).

The payoff of understanding this: there's really only **one door to secure** — the Frontend on `7233`. Everything else is either internal or a browser app.

## Dead end #1: exposing gRPC through a Cloudflare Tunnel

My first instinct for the "workers from anywhere" problem was a Cloudflare Tunnel with an Access login policy. It seemed clean: no open ports, SSO in front.

It doesn't work for the Frontend, for two independent reasons:

1. **"Application with login" is interactive browser SSO.** Workers are headless processes — they can't complete an OAuth redirect. For non-interactive clients Cloudflare uses *service tokens*, not login.
2. **Cloudflare doesn't proxy gRPC over a public hostname.** Per their own docs, gRPC over Tunnel is only supported via private-network routing, not public-hostname ingress.

The workable Cloudflare paths for gRPC (`cloudflared access tcp` with a service token on each worker, or WARP + private routing) all boil down to *"install a Cloudflare client on every worker."* Which is the same operational footprint as just putting the worker on Tailscale — except it's a second overlay to manage.

**Lesson:** Cloudflare Tunnel + Access login is perfect for the *browser UI*. It's the wrong tool for a gRPC API consumed by machines.

## The worker connectivity decision: mTLS for everyone

That left two real options for worker → Frontend:

- **Tailscale:** workers join the mesh, connect in plaintext, encryption and access control handled by WireGuard. Simplest — *for me*. But it costs the worker operator more: they have to install a daemon and become a node on my private network.
- **mTLS:** hand each worker a certificate. Works from anywhere on the internet, no network entanglement. Costs *me* more: I run a small certificate authority.

I chose **mTLS for all workers** and the reasoning is the useful part: *a cert is just a file; network membership is a relationship.* For third parties running workers, a cert is the more professional, decoupled interface. And one uniform path beats maintaining "mesh workers here, cert workers there."

The honest catch: mTLS doesn't remove overhead, it moves it to you. You're now responsible for issuing certs, **rotating them before they expire** (the 2am outage waiting to happen) and exposing the Frontend port (mTLS-gated, but reachable). The rotation problem is the one that bites — which is why the CA choice mattered.

### mTLS in one paragraph

Normal TLS: the server proves its identity (the padlock). Mutual TLS: *both* sides prove identity. The worker proves it's a legit worker; the server proves it's the real server. Since Temporal's Frontend has no password, the **certificate is the password** — the server only admits connections presenting a cert signed by a CA it trusts. Think keycard system: the **CA** is the keycard printer, the server checks cards at the door, each worker carries a card.

## Infisical as the certificate authority

Rather than hand-rolling a CA with `openssl` (fine to learn once, miserable to operate), I used [Infisical](https://infisical.com), which has a full private-PKI product: private CA hierarchies, lifecycle management and — the important bit — **automated renewal with expiry alerts**. It's open-source and has a free cloud tier.

The setup order in Infisical's Certificate Manager is layered and the UI does not make this obvious:

1. **Certificate Authority** — the thing that signs. (I created a single Root CA; for a small deployment you don't need the textbook root + intermediate split, especially since Infisical holds the keys either way.)
2. **Certificate Policy** — the rules (I left it permissive).
3. **Certificate Profile** — bundles a CA + policy into a reusable template.
4. **Application** — a workload that issues certs through a profile.

The gotcha: an "Application" is *not* a CA and it's the *last* step, not the first. I created one first (out of order) and left it empty until the end.

### The one profile trick

A certificate can carry `serverAuth`, `clientAuth` or both. Instead of two profiles, I made **one mTLS profile with both** extended key usages. That single template issues my server cert *and* my worker certs — they differ only by the name on them.

### The SAN gotcha

This is the single most common thing that breaks Temporal mTLS. The server certificate's Subject Alternative Names must match what clients dial. Temporal also does IP-to-IP internal comms, so you pin a logical `serverName` and put it in the cert as a SAN. My server cert ended up with four SANs:

- `temporal.kaplabs.dev` — what external workers dial
- `temporal-frontend` — the internal name for the local UI/services
- `localhost`
- `127.0.0.1`

Get this wrong and you get `x509: certificate is valid for X, not Y`.

## Dead end #2 (avoided): native mTLS in the all-in-one image

Temporal's `auto-setup` Docker image *can* do mTLS via `TEMPORAL_TLS_*` environment variables. But turning on `requireClientAuth` means the image's **own internal health checks and namespace setup** also have to speak TLS and getting that right is genuinely fiddly.

So I sidestepped it entirely with a cleaner architecture:

> **Temporal runs plaintext, locked to the internal Docker network. A tiny nginx sits in front doing the mTLS.**

nginx terminates the worker's mutual-TLS handshake using the Infisical certs, then forwards plain gRPC to Temporal over the private network. Workers get full mTLS; Temporal stays vanilla and boots cleanly; the local UI talks to it with zero cert config. The only publicly exposed thing is nginx on `7233` and it rejects anyone without a valid client cert at the handshake.

### The stack

`docker-compose.yml`:

```yaml
services:
  postgresql:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: temporal
      POSTGRES_PASSWORD: temporal   # change this
      POSTGRES_DB: temporal
    volumes:
      - temporal-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U temporal"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  temporal:
    image: temporalio/auto-setup:1.27.2
    depends_on:
      postgresql:
        condition: service_healthy
    environment:
      - DB=postgres12
      - DB_PORT=5432
      - POSTGRES_SEEDS=postgresql
      - POSTGRES_USER=temporal
      - POSTGRES_PWD=temporal
      - NUM_HISTORY_SHARDS=512
      - BIND_ON_IP=0.0.0.0
      - TEMPORAL_BROADCAST_ADDRESS=127.0.0.1
      - SKIP_ADD_CUSTOM_SEARCH_ATTRIBUTES=true
    # No ports published. Reachable only inside the network as temporal:7233.
    restart: unless-stopped

  temporal-ui:
    image: temporalio/ui:2.34.0
    depends_on:
      - temporal
    environment:
      - TEMPORAL_ADDRESS=temporal:7233
      - TEMPORAL_UI_PORT=8080
    ports:
      - "127.0.0.1:8080:8080"   # localhost only; cloudflared picks this up
    restart: unless-stopped

  nginx:
    image: nginx:1.27-alpine
    depends_on:
      - temporal
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/temporal/certs:/certs:ro
    ports:
      - "7233:7233"   # the ONLY public port; mTLS-gated
    restart: unless-stopped

volumes:
  temporal-pgdata:
```

`nginx.conf` — the mTLS terminator:

```nginx
worker_processes auto;
events { worker_connections 1024; }

http {
    server {
        listen 7233 ssl;
        http2 on;
        server_name temporal.kaplabs.dev;

        ssl_certificate     /certs/server.pem;
        ssl_certificate_key /certs/server.key;

        # The "m" in mTLS: require + verify client certs against our CA.
        ssl_client_certificate /certs/ca.pem;
        ssl_verify_client on;
        ssl_verify_depth 2;

        ssl_protocols TLSv1.2 TLSv1.3;

        # Temporal workers hold long-poll gRPC streams open. Let them.
        grpc_read_timeout 3600s;
        grpc_send_timeout 3600s;

        location / {
            grpc_pass grpc://temporal:7233;
        }
    }
}
```

Three files on the host under `/etc/temporal/certs/`: `server.pem`, `server.key`, `ca.pem`.

## The gotchas that actually cost time

The configs above are clean in hindsight. Getting there involved a gauntlet:

**The Cloudflare orange-cloud trap.** After adding the `temporal.kaplabs.dev` A record, `nc` timed out — and the resolved IP was `172.67.x.x`, a Cloudflare proxy address. The record was **proxied (orange cloud)**, so gRPC traffic was hitting Cloudflare's proxy, which doesn't handle it. Fix: flip it to **grey cloud (DNS only)** so it resolves to the real EC2 IP. (Note the contrast with the UI later, which *should* be orange.)

**The OOM freeze.** First `docker compose up` on a 1 GB instance exhausted memory, thrashed and froze the entire OS — which took Tailscale SSH down with it. The box looked dead but wasn't; a Stop/Start from the EC2 console recovered it. **This stack wants at least 2 GB** (`t3.small` floor, `t3.medium` comfortable). A stop/start also changes the public IP unless you attach an Elastic IP — worth doing to avoid re-chasing DNS.

**The scary-but-harmless errors.** During startup, the logs spat `context deadline exceeded` and `shard status unknown`. These *look* like failures but are startup churn — Temporal acquiring its 512 shards while Postgres warms up. If they taper off within a couple minutes, ignore them. If they never stop, the box is still starved.

**Docker permissions.** `permission denied ... docker.sock` — the user wasn't in the `docker` group. `usermod -aG docker $USER` fixes it, but **only in a new login session**; the current shell keeps the old groups until you reconnect.

**Certs weren't on the box.** nginx crash-looped with `cannot load certificate "/certs/server.pem"` — the files had been downloaded to a laptop, not copied to the server. Over Tailscale, `tailscale file cp` moved them across without needing the public IP or any open port. (Also: Infisical hands you the private key as a `.txt` — the extension is cosmetic; what matters is the `-----BEGIN PRIVATE KEY-----` inside.)

**cloudflared install is two steps, not one.** The dashboard shows three commands. Step 1 installs the binary; step 2 registers the service with a token. I ran step 2 without step 1, so no service got created (`Unit cloudflared.service could not be found`). They're sequential, not alternatives.

## DNS and the firewall: one port

DNS: `temporal.kaplabs.dev` → EC2 public IP, **grey cloud** (direct, for gRPC).

AWS security group **inbound rules**:

| Type | Port | Source | Why |
|---|---|---|---|
| Custom TCP | 7233 | 0.0.0.0/0 | Workers (mTLS-gated) |

That's the entire inbound surface. `0.0.0.0/0` is acceptable *because of mTLS* — an open port just means "anyone can attempt a handshake and fail." No SSH rule (Tailscale SSH is outbound), no 8080 rule (the UI goes out through a tunnel), no 5432 (Postgres is internal). Keep **outbound** allow-all, since Tailscale, cloudflared and image pulls all dial out.

## Auto-renewal: the Infisical agent

The whole reason for choosing Infisical. A small daemon runs on the VM, watches the server cert and ~30 days before the 90-day cert expires, reissues a fresh one, writes it to disk and **gracefully reloads nginx** via a post-hook. You never touch a cert again.

Key design decision: the agent manages **only** `server.pem` and `server.key` (the rotating pieces). It leaves `ca.pem` alone, because the Root CA doesn't rotate (10-year validity) — which also sidesteps any chain-format guesswork.

`agent.yaml` (the parts that matter):

```yaml
version: v1
infisical:
  address: "https://app.infisical.com"
auth:
  type: "universal-auth"
  config:
    client-id: "REPLACE"
    client-secret: "REPLACE"
certificates:
  - profile-name: "temporal-mtls"
    project-slug: "REPLACE"
    attributes:
      common-name: "temporal.kaplabs.dev"
      alt-names: ["temporal.kaplabs.dev", "temporal-frontend", "localhost", "127.0.0.1"]
      key-algorithm: "RSA_2048"
      signature-algorithm: "RSA-SHA256"
      key-usages: ["digital_signature", "key_encipherment"]
      extended-key-usages: ["server_auth", "client_auth"]
      ttl: "90d"
    lifecycle:
      renew-before-expiry: "30d"
      status-check-interval: "6h"
    file-output:
      private-key: { path: "/etc/temporal/certs/server.key", permission: "0600" }
      certificate: { path: "/etc/temporal/certs/server.pem", permission: "0644" }
    post-hooks:
      on-issuance: { command: "docker exec temporal-onprem-stack-nginx-1 nginx -s reload", timeout: 30 }
      on-renewal:  { command: "docker exec temporal-onprem-stack-nginx-1 nginx -s reload", timeout: 30 }
```

Run it as a systemd service (`infisical cert-manager agent --config /etc/infisical/agent.yaml`) so it survives reboots. On EC2 you can swap Universal Auth for `aws-iam` and hold no secret at all — the agent authenticates via the instance's IAM role.

## The UI: Cloudflare Tunnel + Access (the *right* use)

For the dashboard, the tunnel finally earns its keep — because it's a browser/HTTP app, exactly what Access login is designed for.

Modern Cloudflare steers you to **remotely-managed tunnels**: create the tunnel at `one.dash.cloudflare.com → Networks → Tunnels` and run a single `cloudflared service install <token>` on the box. The connection is **outbound only** — which is why 8080 never needs a firewall rule.

Then:

- **Public Hostname:** `temporal-ui.kaplabs.dev` → `HTTP` → `localhost:8080`. This DNS record is **proxied (orange cloud)** — correct here, the opposite of the gRPC record.
- **Access application:** self-hosted, hostname `temporal-ui.kaplabs.dev`, with an Allow policy (your email, or a domain). Built-in one-time-PIN works with zero setup. **Create the Access policy immediately**, or the URL is briefly open to the world.

Two gotchas here mirror earlier ones: `Error 1033` means the tunnel is routed but no connector is running (`Active replicas: 0`); `502 Bad Gateway` means the connector is up but can't reach the service URL — almost always `https://` instead of `http://`, or a wrong port. And you do **not** open 8080 in AWS: cloudflared reaches the UI over `localhost`, which never touches the firewall.

## The final architecture

```mermaid
flowchart TB
  workers["Workers<br/>(anywhere)"]
  browser["Browser"]
  access["Cloudflare Access<br/>(SSO login)"]

  subgraph ec2 ["EC2 instance"]
    nginx["nginx :7233<br/>verifies client cert"]
    temporal["temporal server<br/>plaintext, internal only"]
    postgres[("postgres")]
    ui["temporal-ui :8080"]
    cloudflared["cloudflared"]
    infisical["Infisical agent"]
  end

  workers -- "mTLS / gRPC" --> nginx
  nginx -- "plain gRPC" --> temporal
  temporal --> postgres
  browser --> access
  access -. "tunnel (outbound)" .-> cloudflared
  cloudflared -- "localhost" --> ui
  ui -- "plain gRPC" --> temporal
  infisical -- "renews cert, reloads" --> nginx
```

The result:

- A Temporal cluster on a single EC2 box.
- Workers authenticating over **real mutual TLS** from anywhere, no mesh membership required.
- Certificates that **rotate themselves** and reload nginx without intervention.
- A dashboard behind **SSO**, exposed with no inbound port.
- Exactly **one** inbound port open to the internet, gated by client certs. Everything else is internal or outbound-only.

## Takeaways

- **Learn what "Frontend" means in Temporal** before anything else. There's only one door to secure.
- **Cloudflare Tunnel + Access is for browser apps, not gRPC APIs.** Don't fight the protocol.
- **A cert is a file; network membership is a relationship.** For external workers, mTLS is the cleaner interface — but the cost is running a CA and the cost of a CA is rotation. Automate it from day one.
- **Terminate mTLS in nginx**, keep Temporal vanilla. The all-in-one image + `requireClientAuth` is a headache you can skip.
- **Grey-cloud gRPC records, orange-cloud browser records.** Same domain, opposite settings.
- **Give it 2 GB.** 1 GB freezes the whole box on first boot.
- Most of the "scary" errors were startup churn or a misplaced file — not real failures. Read the logs before assuming the worst.
