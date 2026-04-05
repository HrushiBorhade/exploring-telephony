# DNS & Domain Guide — Exploring Telephony

> Domain: `annoteapp.com` (Squarespace DNS, Google Workspace email)
> API subdomain: `asr-api.annoteapp.com`
> Frontend subdomain: `asr.annoteapp.com` (Vercel)

---

## Table of Contents

1. [DNS Fundamentals](#1-dns-fundamentals)
2. [Your Current Setup (From Screenshot)](#2-your-current-setup)
3. [Two Approaches: Keep Squarespace DNS vs Move to Route53](#3-two-approaches)
4. [Recommended Approach: Keep Squarespace DNS](#4-recommended-approach)
5. [Updated Terraform Plan for DNS](#5-updated-terraform-plan)
6. [Step-by-Step Instructions](#6-step-by-step-instructions)

---

## 1. DNS Fundamentals

### What Is DNS?

DNS (Domain Name System) is the phone book of the internet. When someone types `api.yourdomain.com`, DNS converts that into an IP address like `13.235.47.123` so the browser knows where to send the request.

### The Chain

```
User types: api.yourdomain.com
    │
    ▼
Browser asks: "Who manages .com?"
    → Root DNS servers → ".com is managed by Verisign"
    │
    ▼
Browser asks: "Who manages yourdomain.com?"
    → Verisign → "yourdomain.com nameservers are ns1.squarespace.com"
    │                                                     ↑
    │                                    This is what your domain registrar sets.
    │                                    Currently pointing to Squarespace DNS.
    ▼
Browser asks Squarespace DNS: "What is api.yourdomain.com?"
    → Squarespace DNS → "It's a CNAME pointing to annote-web-ec2-....ap-south-..."
    │
    ▼
Browser resolves that hostname to an IP → connects → gets response
```

### Nameservers (NS records)

Nameservers are the **authority** for your domain. Whoever controls the nameservers controls ALL DNS records. Your domain's nameservers are currently Squarespace's servers.

**Changing nameservers = moving ALL your DNS to a different provider.** This is a big deal because:
- Google Workspace email records would need to be recreated
- Vercel records would need to be recreated
- Twilio verification would need to be recreated
- Any misconfiguration = email goes down, website goes down

### DNS Record Types

| Type | What It Does | Example |
|------|-------------|---------|
| **A** | Points a name to an IPv4 address | `api.yourdomain.com → 13.235.47.123` |
| **AAAA** | Points a name to an IPv6 address | `api.yourdomain.com → 2600:1f18:...` |
| **CNAME** | Points a name to another name (alias) | `api → annote-web-ec2-....ap-south-...` |
| **MX** | Mail server for receiving email | `@ → smtp.google.com` (priority 1) |
| **TXT** | Text data — used for verification and email security | `@ → v=spf1 include:_spf.google.com ~all` |
| **NS** | Nameserver delegation | `yourdomain.com → ns1.squarespace.com` |
| **ALIAS/ANAME** | Like CNAME but works at root domain (@) | Not all providers support this |

### Key Rules

1. **CNAME cannot coexist with other records at the same name.** You can't have both a CNAME and an MX record for `@` (root domain).
2. **A records need an IP address.** ALB IPs change, so you need an ALIAS/CNAME — not a static A record.
3. **TTL (Time To Live)** = how long DNS resolvers cache the answer. `4 hrs` means changes take up to 4 hours to propagate worldwide. Lower TTL = faster changes but more DNS queries.

---

## 2. Your Current Setup

From the screenshot, your Squarespace DNS has:

### Squarespace Domain Connect
| Type | Name | Data | Purpose |
|------|------|------|---------|
| CNAME | `_domainconnect` | `_domainconnect.domains.squarespace.com` | Squarespace's auto-config protocol |

### Google Workspace (Email)
| Type | Name | Data | Purpose |
|------|------|------|---------|
| TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=MIIBij...` | **DKIM email signing** — proves emails from your domain aren't forged |
| MX | `@` | `smtp.google.com` (priority 1) | **Mail delivery** — all email to @yourdomain.com goes to Google |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | **SPF** — tells receivers which servers can send email for your domain |

**DO NOT touch these.** If you delete or misconfigure them, your email breaks.

### Twilio
| Type | Name | Data | Purpose |
|------|------|------|---------|
| TXT | `_twilio` | `twilio-domain-verification=be60e4...` | Twilio verifying you own this domain |

### ACM Certificate Validation (Existing!)
| Type | Name | Data | Purpose |
|------|------|------|---------|
| CNAME | `_e89f74f252c4b0de9d...` | `_966207a4252e1ccf29239c3483cfc14a.jkddz...` | **AWS ACM DNS validation** — you already have an ACM cert! |

### Your Services
| Type | Name | Data | Purpose |
|------|------|------|---------|
| CNAME | `api` | `annote-web-ec2-1553733304.ap-so...` | **Your current API** — points to an EC2 load balancer in ap-south-1 |
| CNAME | `worker` | `d718400800cff7b5.vercel-dns-017.com` | **Vercel deployment** — some worker/frontend on Vercel |

---

## 3. Two Approaches

### Option A: Move Nameservers to Route53 (NOT recommended for you)

```
Squarespace (registrar) → change NS records → Route53 nameservers
```

**What happens:**
- Route53 becomes the authority for ALL DNS records
- You must recreate EVERY record (Google Workspace, Vercel, Twilio, ACM) in Route53
- If you miss one, that service breaks
- Email could go down during migration

**When to do this:** When you have a dedicated DevOps person and want Terraform to manage ALL DNS.

### Option B: Keep Squarespace DNS, Add Records There (RECOMMENDED)

```
Squarespace DNS stays as-is
Just update the existing 'api' CNAME to point to your new ALB
```

**What happens:**
- Nothing existing breaks
- You just change one record: `api` CNAME → ALB DNS name
- Google Workspace email: untouched
- Vercel worker: untouched
- Twilio: untouched
- Takes 5 minutes

---

## 4. Recommended Approach: Keep Squarespace DNS

Since you already have `api` as a CNAME pointing to an EC2 load balancer, you just need to **update that CNAME** to point to the new ALB after Terraform creates it.

### What Changes

```
BEFORE:
  api  CNAME  annote-web-ec2-1553733304.ap-south-...  (old EC2 ALB)

AFTER:
  api  CNAME  telephony-alb-123456789.ap-south-1.elb.amazonaws.com  (new ALB)
```

### What Stays the Same

Everything else. Google email, Vercel worker, Twilio, Squarespace — all untouched.

### ACM Certificate Validation

You already have an ACM validation CNAME (`_e89f74f252c4b0de9d...`). This means you've previously requested an ACM certificate for this domain. When Terraform creates a new ACM cert, it will output a new validation CNAME that you'll need to add in Squarespace DNS. ACM checks this CNAME to prove you own the domain, then issues the SSL certificate.

---

## 5. How ACM SSL Works (Step by Step)

### What Is ACM?

AWS Certificate Manager gives you **free SSL certificates** for use with AWS services (ALB, CloudFront, API Gateway). The certificate enables HTTPS — without it, browsers show "Not Secure" and refuse to connect.

### The Problem

Your ALB needs an SSL certificate for `asr-api.annoteapp.com`. But AWS needs to prove you actually own `annoteapp.com` before issuing a cert. How?

### DNS Validation — How It Works

```
Step 1: Terraform tells ACM "I want a cert for asr-api.annoteapp.com"

Step 2: ACM says "Prove you own this domain. Add this CNAME record:"
        Name:  _abc123.asr-api.annoteapp.com
        Value: _xyz789.acm-validations.aws.

Step 3: You add that CNAME in Squarespace DNS

Step 4: ACM checks DNS, finds the CNAME → "Domain ownership verified!"

Step 5: ACM issues the certificate (free, auto-renews every 13 months)

Step 6: ALB uses this cert to serve HTTPS on asr-api.annoteapp.com
```

**Why DNS validation (not email)?** Email validation sends an email to admin@annoteapp.com — you'd need to check Google Workspace. DNS validation is automated and works with Terraform. You add one CNAME, done forever.

### The Complete SSL Chain

```
User browser                   ALB                        ECS (your API)
    │                           │                              │
    │──── HTTPS request ──────→│                              │
    │     (encrypted with       │                              │
    │      ACM certificate)     │                              │
    │                           │── HTTP (plain) on :8080 ──→│
    │                           │   (inside VPC, safe)         │
    │                           │                              │
    │←── encrypted response ───│←── response ────────────────│
```

SSL terminates at the ALB. Traffic between ALB and ECS is plain HTTP inside the VPC — this is standard practice because:
- VPC traffic is isolated (can't be sniffed from outside)
- No CPU overhead of TLS on your containers
- Simpler container config (no cert management in Node.js)

### Important: You Already Have an ACM Validation CNAME

From your screenshot, this record exists:
```
CNAME  _e89f74f252c4b0de9d...  →  _966207a4252e1ccf29239c3483cfc14a.jkddz...
```

This is from a **previous ACM certificate request**. Our new Terraform ACM cert will generate a **different** validation CNAME. The old one can stay — it doesn't conflict.

---

## 6. Updated Terraform Plan for DNS

Since we're keeping Squarespace DNS, the Terraform plan changes:

### What We REMOVE from Terraform
- Route53 hosted zone creation (Squarespace is the DNS authority)
- Route53 A/CNAME records (we set CNAMEs in Squarespace manually)

### What We KEEP in Terraform
- ACM certificate request (Terraform requests the cert)
- ACM outputs the validation CNAME (you add it in Squarespace)

### What We DO Manually (One-Time, ~5 Minutes)
1. Run `terraform apply` → note the ACM validation CNAME from output
2. Add that CNAME in Squarespace DNS
3. Wait for Terraform to detect validation (~2-5 minutes)
4. After first deploy, add `asr-api` CNAME in Squarespace pointing to the ALB

### Terraform Code

```hcl
# NO Route53 zone — Squarespace manages DNS for annoteapp.com

# ACM certificate for asr-api.annoteapp.com
resource "aws_acm_certificate" "api" {
  domain_name       = "asr-api.annoteapp.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Output the validation record — you add this in Squarespace
output "acm_validation_record" {
  description = "Add this CNAME in Squarespace DNS to validate the ACM certificate"
  value = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

# This blocks until you add the CNAME in Squarespace and ACM validates
resource "aws_acm_certificate_validation" "api" {
  certificate_arn = aws_acm_certificate.api.arn
}

# Output the ALB DNS name — you add asr-api CNAME in Squarespace pointing to this
output "alb_dns_name" {
  description = "Add CNAME in Squarespace: asr-api → this value"
  value       = module.alb.dns_name
}
```

### ALB Uses the Certificate

```hcl
# In the ALB module
listeners = {
  https = {
    port            = 443
    protocol        = "HTTPS"
    ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-Res-2021-06"
    certificate_arn = aws_acm_certificate.api.arn  # ← the cert we just created

    forward = {
      target_group_key = "ecs-api"
    }
  }
}
```

When a user hits `https://asr-api.annoteapp.com`, the ALB presents this certificate. The browser verifies it's valid for `asr-api.annoteapp.com`, the TLS handshake completes, and the connection is encrypted.

---

## 7. Step-by-Step Instructions

### After `terraform apply`

**Step 1: Add ACM Validation CNAME**

Terraform will output something like:
```
acm_validation_record = {
  "asr-api.annoteapp.com" = {
    name  = "_abc123def456.asr-api.annoteapp.com."
    type  = "CNAME"
    value = "_xyz789.acm-validations.aws."
  }
}
```

In Squarespace DNS:
1. Go to Domains → annoteapp.com → DNS Settings
2. Custom Records → Add Record
3. Type: **CNAME**
4. Name: `_abc123def456.asr-api` (remove `.annoteapp.com.` — Squarespace appends it)
5. Data: `_xyz789.acm-validations.aws.`
6. Save

Wait 2-5 minutes. Terraform (still running) will detect the validation and proceed.

**Step 2: Add `asr-api` CNAME**

After everything is deployed and health checks pass, Terraform outputs:
```
alb_dns_name = "telephony-alb-123456789.ap-south-1.elb.amazonaws.com"
```

In Squarespace DNS:
1. Custom Records → Add Record
2. Type: **CNAME**
3. Name: `asr-api`
4. Data: `telephony-alb-123456789.ap-south-1.elb.amazonaws.com`
5. Save

> Note: This is a NEW record — not editing the existing `api` CNAME. Your old `api` record pointing to `annote-web-ec2-...` stays untouched.

**Step 3: Add `asr` CNAME for Vercel Frontend**

When you deploy the frontend on Vercel:
1. In Vercel dashboard → Project Settings → Domains → Add `asr.annoteapp.com`
2. Vercel will give you a CNAME value like `cname.vercel-dns.com`
3. In Squarespace DNS → Add Record → CNAME → Name: `asr` → Data: `cname.vercel-dns.com`

**Step 4: Verify**

```bash
# Check DNS resolution
dig asr-api.annoteapp.com

# Should show:
# asr-api.annoteapp.com.  CNAME  telephony-alb-xxx.ap-south-1.elb.amazonaws.com.
# telephony-alb-xxx...    A      13.235.x.x

# Test HTTPS
curl https://asr-api.annoteapp.com/health
# {"status":"ok","uptime":42,"activeCaptures":0}

# Test the frontend
curl -I https://asr.annoteapp.com
# HTTP/2 200 (served by Vercel)
```

### If Something Goes Wrong

Delete the `asr-api` CNAME in Squarespace. Traffic stops going to the new ALB. Your old `api` subdomain is completely unaffected.

---

## 8. Final DNS State in Squarespace

After everything is deployed, your Squarespace DNS will look like:

| Type | Name | Data | Status |
|------|------|------|--------|
| CNAME | `_domainconnect` | `_domainconnect.domains.squarespace.com` | Existing — don't touch |
| TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=MIIBij...` | Existing — don't touch (email) |
| MX | `@` | `smtp.google.com` | Existing — don't touch (email) |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | Existing — don't touch (email) |
| TXT | `_twilio` | `twilio-domain-verification=...` | Existing — don't touch |
| CNAME | `_e89f74f252c4b...` | `_966207a4252e1ccf...` | Existing — old ACM cert |
| CNAME | `api` | `annote-web-ec2-...` | Existing — old API (keep as-is) |
| CNAME | `worker` | `d71840...vercel-dns-017.com` | Existing — don't touch |
| CNAME | **`_newACMhash.asr-api`** | **`_newACMhash.acm-validations.aws.`** | **NEW — ACM validation** |
| CNAME | **`asr-api`** | **`telephony-alb-xxx.ap-south-1.elb.amazonaws.com`** | **NEW — your API** |
| CNAME | **`asr`** | **`cname.vercel-dns.com`** | **NEW — Vercel frontend** |

Three new records. Everything else untouched.

---

## Summary

| Question | Answer |
|----------|--------|
| Do I change nameservers? | **No.** Squarespace DNS stays. |
| Will email break? | **No.** MX, SPF, DKIM untouched. |
| Will old `api` subdomain break? | **No.** It stays pointing to the old EC2 ALB. |
| Will `worker` (Vercel) break? | **No.** Untouched. |
| What do I add? | 3 new CNAME records (ACM validation, `asr-api`, `asr`) |
| Do I need Route53? | **No.** Removed from Terraform. |
| How long for DNS to work? | TTL is 4 hours max, usually faster. |
| Can I roll back? | **Yes.** Delete the `asr-api` CNAME. |
| Is SSL free? | **Yes.** ACM certs are free and auto-renew. |
| Does the old API keep working? | **Yes.** `api.annoteapp.com` is a separate CNAME. |
