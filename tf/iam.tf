resource "aws_iam_role" "ecs_task_execution_role" {
  name = "ecsTaskExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole",
      Effect = "Allow",
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

# IAM role that the Lambda function will assume
resource "aws_iam_role" "lambda_exec" {
  name = "debate-bro-transcribe-lambda-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

# + Create a Task Role your app will assume inside the container
resource "aws_iam_role" "bot_task_role" {
  name = "${var.app_name}-task-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Effect = "Allow",
      Action = "sts:AssumeRole",
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# IAM to get secrets
resource "aws_iam_role_policy" "ecs_exec_ssm" {
  name = "ecs-exec-ssm"
  role = aws_iam_role.ecs_task_execution_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      { Effect = "Allow", Action = ["ssm:GetParameter","ssm:GetParameters"], Resource = "*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = "*" }
    ]
  })
}

# + Allow writes to your recordings bucket
resource "aws_iam_role_policy" "bot_task_s3" {
  name = "discord-echo-bot-s3"
  role = aws_iam_role.bot_task_role.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.recordings.arn },
      { Effect = "Allow", Action = ["s3:PutObject","s3:PutObjectAcl"], Resource = "${aws_s3_bucket.recordings.arn}/*" }
    ]
  })
}

resource "aws_iam_policy" "transcribe_lambda_s3" {
  name        = "debate-bro-transcribe-s3"
  description = "Allow transcription Lambda to read/write recordings bucket"

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect   = "Allow",
        Action   = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ],
        Resource = [
          aws_s3_bucket.recordings.arn,
          "${aws_s3_bucket.recordings.arn}/*"
        ]
      }
    ]
  })
}

resource "aws_lambda_permission" "allow_s3_invoke_transcription" {
  statement_id  = "AllowS3InvokeTranscription"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.transcription_lambda.function_name
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.recordings.arn
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "transcribe_lambda_attach" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = aws_iam_policy.transcribe_lambda_s3.arn
}

resource "aws_iam_role_policy_attachment" "transcribe_basic_logs" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}