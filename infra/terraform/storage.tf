resource "cloudflare_d1_database" "app" {
  account_id            = var.cloudflare_account_id
  name                  = local.resource_prefix
  primary_location_hint = var.d1_primary_location_hint
  read_replication = {
    mode = var.enable_d1_read_replication ? "auto" : "disabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_r2_bucket" "uploads" {
  account_id    = var.cloudflare_account_id
  name          = "${local.resource_prefix}-uploads"
  location      = var.r2_location
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}
