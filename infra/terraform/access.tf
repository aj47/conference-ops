resource "cloudflare_zero_trust_access_policy" "preview_reviewers" {
  count = var.enable_preview_access ? 1 : 0

  account_id       = var.cloudflare_account_id
  name             = "${local.resource_prefix} preview reviewers"
  decision         = "allow"
  session_duration = "12h"
  include = [
    for email in sort(tolist(var.preview_access_allowed_emails)) : {
      email = {
        email = email
      }
    }
  ]
}

resource "cloudflare_zero_trust_access_policy" "preview_automation" {
  count = var.enable_preview_access && length(var.preview_access_service_token_ids) > 0 ? 1 : 0

  account_id       = var.cloudflare_account_id
  name             = "${local.resource_prefix} preview automation"
  decision         = "non_identity"
  session_duration = "12h"
  include = [
    for token_id in sort(tolist(var.preview_access_service_token_ids)) : {
      service_token = {
        token_id = token_id
      }
    }
  ]
}

resource "cloudflare_zero_trust_access_application" "preview" {
  count = var.enable_preview_access ? 1 : 0

  account_id                 = var.cloudflare_account_id
  name                       = "${local.resource_prefix} preview"
  type                       = "self_hosted"
  domain                     = var.preview_access_hostname
  session_duration           = "12h"
  app_launcher_visible       = false
  allow_iframe               = false
  http_only_cookie_attribute = true
  same_site_cookie_attribute = "lax"
  allowed_idps               = length(var.preview_access_allowed_idps) == 0 ? null : var.preview_access_allowed_idps
  destinations = [{
    type = "public"
    uri  = var.preview_access_hostname
  }]
  policies = concat(
    [{
      id         = cloudflare_zero_trust_access_policy.preview_reviewers[0].id
      precedence = 1
    }],
    [for policy in cloudflare_zero_trust_access_policy.preview_automation : {
      id         = policy.id
      precedence = 2
    }],
  )

  depends_on = [terraform_data.configuration_guard]
}
