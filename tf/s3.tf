resource "aws_s3_bucket" "recordings" {
  bucket = var.bucket_name

  # Good hygiene: protect from accidental destroys
  lifecycle {
    prevent_destroy = false
  }

  tags = {
    Name        = "discord-voice-logger-recordings"
    Environment = var.environment
  }
}

# Replace deprecated `acl` with explicit public access blocks
resource "aws_s3_bucket_public_access_block" "recordings" {
  bucket                  = aws_s3_bucket.recordings.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Enforce bucket owner for all objects (no ACLs)
resource "aws_s3_bucket_ownership_controls" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

# (Optional but recommended)
resource "aws_s3_bucket_versioning" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  bucket = aws_s3_bucket.recordings.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
