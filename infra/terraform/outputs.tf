output "environment" {
  value       = var.environment
  description = "Environment represented by this Terraform state."
}

output "d1_database_id" {
  value       = cloudflare_d1_database.app.id
  description = "D1 database UUID consumed by the Wrangler renderer."
}

output "d1_database_name" {
  value       = cloudflare_d1_database.app.name
  description = "D1 database name."
}

output "r2_uploads_bucket_name" {
  value       = cloudflare_r2_bucket.uploads.name
  description = "Private upload bucket name."
}

output "jobs_queue_name" {
  value       = cloudflare_queue.jobs.queue_name
  description = "Queue consumed by the Jobs Worker."
}

output "jobs_dlq_name" {
  value       = cloudflare_queue.jobs_dlq.queue_name
  description = "Dead-letter queue for exhausted jobs."
}

output "worker_names" {
  value       = local.worker_names
  description = "Worker service names used by Wrangler and service bindings."
}

output "preview_access_application_id" {
  value       = try(cloudflare_zero_trust_access_application.preview[0].id, null)
  description = "Access application ID when preview protection is enabled."
}

output "wrangler_bindings" {
  value = {
    d1_database_id = cloudflare_d1_database.app.id
    d1_name        = cloudflare_d1_database.app.name
    r2_bucket      = cloudflare_r2_bucket.uploads.name
    jobs_queue     = cloudflare_queue.jobs.queue_name
    jobs_dlq       = cloudflare_queue.jobs_dlq.queue_name
    workers        = local.worker_names
  }
  description = "Non-secret values used to render deployable Wrangler configuration."
}
