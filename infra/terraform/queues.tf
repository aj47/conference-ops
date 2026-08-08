resource "cloudflare_queue" "jobs" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.resource_prefix}-jobs"
  settings = {
    delivery_delay           = 0
    delivery_paused          = false
    message_retention_period = var.jobs_queue_retention_seconds
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "cloudflare_queue" "jobs_dlq" {
  account_id = var.cloudflare_account_id
  queue_name = "${local.resource_prefix}-jobs-dlq"
  settings = {
    delivery_delay           = 0
    delivery_paused          = false
    message_retention_period = var.jobs_dlq_retention_seconds
  }

  lifecycle {
    prevent_destroy = true
  }
}
