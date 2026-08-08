locals {
  resource_prefix = "conference-ops-${var.environment}"

  worker_names = {
    app      = "${local.resource_prefix}-app"
    jobs     = "${local.resource_prefix}-jobs"
    realtime = "${local.resource_prefix}-realtime"
  }
}

resource "terraform_data" "configuration_guard" {
  lifecycle {
    precondition {
      condition     = !var.enable_preview_access || (var.environment == "staging" && var.preview_access_hostname != null && length(var.preview_access_allowed_emails) > 0 && length(var.preview_access_service_token_ids) > 0)
      error_message = "Access protection requires staging, preview_access_hostname, at least one reviewer email, and at least one CI health-check service-token ID."
    }

    precondition {
      condition     = length(var.dns_records) == 0 || var.cloudflare_zone_id != null
      error_message = "cloudflare_zone_id is required when dns_records is non-empty."
    }
  }
}
