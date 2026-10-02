# Conference Ops shutdown landing

This binding-free Worker replaces the retired Conference Ops pilot application. It serves the project notice at `/` and `/index.html`, blocks indexing, and returns `410 Gone` for all former application and API paths.

The operational shutdown intentionally preserves Git history, D1 databases, and R2 buckets for recovery while removing application, scheduler, realtime, queue, and email-capable runtime services.
