# Reference Env

**Role:** compact runtime and secret lookup guide  
**Audience:** implementers touching deployment, auth, providers, or secret wiring  
**When to read:** only when environment or deployment details matter  
**Authority:** reference-only; core truth lives in `01-core/engineering-core.md` and `01-core/system-core.md`

## Summary

- Deployment hosting is operational context, not product architecture.
- Secrets stay backend-only.
- Runtime headers, CSP, and edge protections may live outside app code and require runtime confirmation.

## High-Risk Secret Families

- Google auth/session secrets
- provider API credentials
- webhook verification secrets
- database and service-role credentials
- OpenAI credentials

## Runtime Rules

- no secrets in browser code, docs, fixtures, or examples
- environment values exposed to the browser must be intentionally non-secret
- runtime-specific security headers still need explicit verification even if the hosting edge provides defaults

## Deep References

- full donor lookup: [`../../restart-prd/env-and-secrets-matrix.md`](../../restart-prd/env-and-secrets-matrix.md)
- security model: [`../01-core/system-core.md`](../01-core/system-core.md)
