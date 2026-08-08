variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns Workers, D1, R2, Queues, and Access."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-fA-F]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be a 32-character hexadecimal Cloudflare account ID."
  }
}

variable "cloudflare_zone_id" {
  description = "Optional Cloudflare zone ID. Required only for managed DNS records."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.cloudflare_zone_id == null || can(regex("^[0-9a-fA-F]{32}$", var.cloudflare_zone_id))
    error_message = "cloudflare_zone_id must be null or a 32-character hexadecimal zone ID."
  }
}

variable "environment" {
  description = "Deployment environment. Each environment has its own state and Cloudflare resources."
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "d1_primary_location_hint" {
  description = "Best-effort D1 primary location."
  type        = string
  default     = "wnam"
  nullable    = true

  validation {
    condition     = var.d1_primary_location_hint == null || contains(["wnam", "enam", "weur", "eeur", "apac", "oc"], var.d1_primary_location_hint)
    error_message = "d1_primary_location_hint must be null or a supported D1 region."
  }
}

variable "enable_d1_read_replication" {
  description = "Enable D1 automatic read replicas. Keep disabled for the pilot unless measured traffic requires it."
  type        = bool
  default     = false
}

variable "r2_location" {
  description = "Best-effort R2 upload-bucket location."
  type        = string
  default     = "wnam"
  nullable    = true

  validation {
    condition     = var.r2_location == null || contains(["wnam", "enam", "weur", "eeur", "apac", "oc"], var.r2_location)
    error_message = "r2_location must be null or a supported R2 location."
  }
}

variable "jobs_queue_retention_seconds" {
  description = "Jobs queue retention. The 86400 default works on the Cloudflare Free plan; paid plans may opt up after verification."
  type        = number
  default     = 86400

  validation {
    condition     = var.jobs_queue_retention_seconds >= 60 && var.jobs_queue_retention_seconds <= 1209600
    error_message = "jobs_queue_retention_seconds must be between 60 and 1209600 seconds."
  }
}

variable "jobs_dlq_retention_seconds" {
  description = "DLQ retention. The 86400 default works on the Cloudflare Free plan; paid plans may opt up after verification."
  type        = number
  default     = 86400

  validation {
    condition     = var.jobs_dlq_retention_seconds >= 60 && var.jobs_dlq_retention_seconds <= 1209600
    error_message = "jobs_dlq_retention_seconds must be between 60 and 1209600 seconds."
  }
}

variable "enable_preview_access" {
  description = "Protect the staging/preview hostname with Cloudflare Access."
  type        = bool
  default     = false
}

variable "preview_access_hostname" {
  description = "Hostname protected by Access, without a scheme or path."
  type        = string
  default     = null
  nullable    = true
}

variable "preview_access_allowed_emails" {
  description = "Exact reviewer emails allowed into the protected preview."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for email in var.preview_access_allowed_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", email))])
    error_message = "Every preview Access principal must be an email address."
  }
}

variable "preview_access_allowed_idps" {
  description = "Optional Access identity-provider IDs. Empty means all configured account IdPs."
  type        = set(string)
  default     = []
}

variable "preview_access_service_token_ids" {
  description = "Optional Access service-token IDs allowed to run preview health checks; client secrets remain outside Terraform."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for id in var.preview_access_service_token_ids : length(trimspace(id)) > 0])
    error_message = "Every preview Access service-token ID must be non-empty."
  }
}

variable "dns_records" {
  description = "Optional non-Worker DNS records. Worker custom domains remain Wrangler-owned to avoid split ownership."
  type = map(object({
    name    = string
    type    = string
    content = string
    ttl     = optional(number, 1)
    proxied = optional(bool, false)
    comment = optional(string, "Managed by Conference Ops Terraform")
  }))
  default = {}
}
