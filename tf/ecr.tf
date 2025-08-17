# ECR for debate-bro bot
resource "aws_ecr_repository" "bot_repo" {
  name = "discord-debate-bro"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "discord-debate-bro"
  }
}

# ECR for transcription lambda
resource "aws_ecr_repository" "transcribe_repo" {
  name = "discord-transcribe"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "discord-transcribe"
  }
}