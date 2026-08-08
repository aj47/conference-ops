# Cloudflare infrastructure

Terraform owns long-lived Cloudflare resources; Wrangler owns deployable Worker services. This split keeps D1, R2, and queue lifecycle reviewable while allowing Worker bindings, routes, and Durable Object migrations to ship with compatible code.

## Layout

- `bootstrap/`: one-time R2 Terraform-state bucket, using local state
- `terraform/`: D1, uploads R2 bucket, jobs queue, DLQ, optional DNS, and staging Access
- `environments/`: separate backend keys and example variables for staging/production
- `OPERATIONS.md`: bootstrap, deploy, recovery, and incident procedures
- `DEPLOYMENT_CHECKLIST.md`: first deploy and promotion gate
- `ACCELEVENTS.md`: API preflight and manual fallback

Terraform resource names and Wrangler Worker names derive from the same `conference-ops-<environment>` prefix. Do not rename a stateful resource without an import/move plan.

Secret values are intentionally absent from every `.tf` and `.tfvars.example` file. Use environment variables and protected GitHub Environments.
