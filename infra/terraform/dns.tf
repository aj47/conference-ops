resource "cloudflare_dns_record" "managed" {
  for_each = var.cloudflare_zone_id == null ? {} : var.dns_records

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.content
  ttl     = each.value.ttl
  proxied = each.value.proxied
  comment = each.value.comment

  depends_on = [terraform_data.configuration_guard]
}
