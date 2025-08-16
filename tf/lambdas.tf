#############################################
# Lambda (container image) for transcription
#############################################

resource "aws_iam_role" "transcribe" {
  name               = "${var.transcribe_function_name}-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Principal = { Service = "lambda.amazonaws.com" },
      Action   = "sts:AssumeRole"
    }]
  })
}

# Minimal, managed policy for CloudWatch logs
resource "aws_iam_role_policy_attachment" "lambda_logs" {
  role       = aws_iam_role.transcribe.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Inline policy for S3 read/write only under guild/ prefix
resource "aws_iam_role_policy" "s3_rw" {
  name = "${var.transcribe_function_name}-s3-rw"
  role = aws_iam_role.transcribe.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Sid    = "S3ReadWriteGuildPrefix",
        Effect = "Allow",
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:HeadObject",
          "s3:DeleteObject",
          "s3:CopyObject"
        ],
        Resource = "arn:aws:s3:::${var.bucket_name}/guild/*"
      }
    ]
  })
}

resource "aws_lambda_function" "transcribe" {
  function_name = var.transcribe_function_name
  package_type  = "Image"
  image_uri     = var.transcribe_image_uri
  role          = aws_iam_role.transcribe.arn

  timeout     = 480
  memory_size = 3008
  ephemeral_storage { size = 4096 }
}

# Allow S3 bucket to invoke the Lambda
resource "aws_lambda_permission" "allow_s3_invoke" {
  statement_id  = "AllowS3Invoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transcribe.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = "arn:aws:s3:::${var.bucket_name}"
}