variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the Terraform state bucket."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character hexadecimal Cloudflare account ID."
  }
}

variable "state_bucket_name" {
  description = "R2 bucket used as the S3-compatible Terraform backend."
  type        = string
  default     = "conference-ops-terraform-state"
}

variable "state_bucket_location" {
  description = "Best-effort R2 state-bucket location."
  type        = string
  default     = "wnam"
}

resource "cloudflare_r2_bucket" "terraform_state" {
  account_id    = var.cloudflare_account_id
  name          = var.state_bucket_name
  location      = var.state_bucket_location
  storage_class = "Standard"

  lifecycle {
    prevent_destroy = true
  }
}

output "state_bucket_name" {
  value = cloudflare_r2_bucket.terraform_state.name
}

output "s3_endpoint" {
  value = "https://${var.cloudflare_account_id}.r2.cloudflarestorage.com"
}
