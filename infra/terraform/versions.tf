terraform {
  required_version = ">= 1.8.0, < 2.0.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.23"
    }
  }

  # Configure this backend with infra/environments/<environment>.s3.tfbackend.
  # R2 credentials are supplied through AWS_ACCESS_KEY_ID,
  # AWS_SECRET_ACCESS_KEY, and AWS_ENDPOINT_URL_S3 at runtime.
  backend "s3" {}
}

provider "cloudflare" {
  # The provider reads CLOUDFLARE_API_TOKEN from the environment. Deliberately
  # keep credentials out of configuration and Terraform state.
}
